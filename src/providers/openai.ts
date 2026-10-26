import type { z } from 'zod';
import { id } from '../domain/models';
import { normalizeUsage } from '../usage/ledger';
import type { ProviderConfig } from '../domain/models';
import {
  validateProviderConfig,
  type ApiMetric,
  type ChatTurn,
  type LLMProvider,
  type LLMResult,
  type SecretStore,
} from './provider';
interface ResponseBody {
  choices?: { message?: { content?: string }; delta?: { content?: string } }[];
  usage?: unknown;
}
export class OpenAICompatibleProvider implements LLMProvider {
  private config: ProviderConfig;
  constructor(
    config: ProviderConfig,
    private secrets: SecretStore,
    private metric: (metric: ApiMetric) => Promise<void>,
    private request: typeof fetch = fetch,
  ) {
    this.config = validateProviderConfig(config);
  }
  private async call(
    messages: ChatTurn[],
    purpose: string,
    stream: boolean,
    onDelta?: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<LLMResult> {
    const start = Date.now();
    const requestId = id();
    let success = false;
    let safeError: string | undefined;
    const key = await this.secrets.get();
    if (!key) throw new Error('请先在 Provider 设置中填写 API Key');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, 90000);
    let result: LLMResult = { content: '', usage: {} };
    try {
      const response = await this.request(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          stream,
          max_tokens:
            purpose === 'theme_interpretation'
              ? 400
              : purpose === 'proactive_generation'
                ? 350
                : purpose === 'chat'
                  ? 1536
                  : 2500,
          ...(stream ? { stream_options: { include_usage: true } } : {}),
          ...(new URL(this.config.baseUrl).hostname === 'api.deepseek.com'
            ? { thinking: { type: this.config.thinking ? 'enabled' : 'disabled' } }
            : {}),
        }),
      });
      if (!response.ok) throw new Error(`模型请求失败（HTTP ${response.status}）`);
      if (stream && response.body?.getReader) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const consume = (line: string) => {
          if (!line.startsWith('data:')) return;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') return;
          const chunk = JSON.parse(data) as ResponseBody;
          const delta = chunk.choices?.[0]?.delta?.content ?? '';
          result.content += delta;
          if (delta) onDelta?.(delta);
          if (chunk.usage) result.usage = { ...result.usage, ...normalizeUsage(chunk.usage) };
        };
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            lines.forEach(consume);
          }
          buffer += decoder.decode();
          if (buffer.trim()) consume(buffer);
        } finally {
          reader.releaseLock();
        }
      } else {
        const body = (await response.json()) as ResponseBody;
        result = {
          content: body.choices?.[0]?.message?.content ?? '',
          usage: normalizeUsage(body.usage),
        };
        if (stream && !result.content)
          throw new Error('Provider 未提供可读取的流，请使用支持流式响应的 Development Build');
        if (stream) onDelta?.(result.content);
      }
      if (!result.content.trim()) throw new Error('模型返回了空回复');
      success = true;
      return result;
    } catch (error) {
      const safe =
        error instanceof Error && /^模型请求失败|^模型返回|^Provider/.test(error.message)
          ? error.message
          : controller.signal.aborted
            ? '请求已取消或超时'
            : '模型连接或响应解析失败';
      safeError = safe;
      throw new Error(safe);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      // Record once, including usage already received before a truncated stream or cancellation.
      await this.metric({
        requestId,
        startedAt: start,
        endpoint: this.config.baseUrl,
        model: this.config.model,
        duration: Date.now() - start,
        purpose,
        success,
        error: safeError,
        ...result.usage,
      }).catch(() => undefined);
    }
  }
  chat(messages: ChatTurn[], purpose: string, signal?: AbortSignal): Promise<LLMResult> {
    return this.call(messages, purpose, false, undefined, signal);
  }
  streamChat(
    messages: ChatTurn[],
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<LLMResult> {
    return this.call(messages, 'chat', true, onDelta, signal);
  }
  async structuredOutput<T>(
    messages: ChatTurn[],
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    purpose: string,
  ): Promise<T> {
    const result = await this.chat(
      [...messages, { role: 'system', content: '只返回严格 JSON，不要 Markdown 代码围栏。' }],
      purpose,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      throw new Error('模型未返回合法 JSON，请重试');
    }
    const checked = schema.safeParse(parsed);
    if (!checked.success) throw new Error('模型结构化输出不符合格式，请重试');
    return checked.data;
  }
}
