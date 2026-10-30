import { z } from 'zod';
import { id, type ProviderConfig } from '../domain/models';
import type { AgentModelRequest, AgentModelResult } from '../agent/core';
import type { ApiMetric, SecretStore } from './provider';
import { normalizeUsage } from '../usage/ledger';
const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable().optional(),
          reasoning_content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().min(1).max(200),
                type: z.literal('function'),
                function: z.object({
                  name: z.string().min(1).max(100),
                  arguments: z.string().max(24000),
                }),
              }),
            )
            .max(16)
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z.unknown().optional(),
});
export function serializeAgentMessages(request: AgentModelRequest) {
  return request.messages.map((message) => {
    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n');
    if (message.role === 'tool')
      return { role: 'tool', content: text, tool_call_id: message.toolCallId };
    const calls = message.content
      .filter((b) => b.type === 'tool-call')
      .map((b) => ({
        id: b.id,
        type: 'function',
        function: { name: b.name, arguments: b.arguments },
      }));
    const reasoning = message.content
      .filter((b) => b.type === 'reasoning')
      .map((b) => b.text ?? '')
      .join('');
    return {
      role: message.role === 'developer' ? 'system' : message.role,
      content: text || (calls.length ? null : ''),
      ...(calls.length ? { tool_calls: calls } : {}),
      ...(message.role === 'assistant' && reasoning ? { reasoning_content: reasoning } : {}),
    };
  });
}
/** Credentials remain in the transport host; DSH receives only model results and tool declarations. */
export async function requestAgentChat(
  config: ProviderConfig,
  secrets: SecretStore,
  metric: (value: ApiMetric) => Promise<void>,
  request: typeof fetch,
  input: AgentModelRequest,
  signal?: AbortSignal,
): Promise<AgentModelResult> {
  const key = await secrets.get();
  if (!key) throw new Error('请先填写 API Key');
  const controller = new AbortController(),
    abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 90000),
    startedAt = Date.now();
  let success = false,
    result: AgentModelResult = { content: '', toolCalls: [], usage: {} };
  try {
    const response = await request(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: config.model,
        messages: serializeAgentMessages(input),
        tools: input.tools?.map((tool) => ({ type: 'function', function: tool })),
        tool_choice: 'auto',
        parallel_tool_calls: false,
        stream: false,
        max_tokens: config.thinking ? 4096 : 2048,
        ...(new URL(config.baseUrl).hostname === 'api.deepseek.com'
          ? { thinking: { type: config.thinking ? 'enabled' : 'disabled' } }
          : {}),
      }),
    });
    if (!response.ok) throw new Error(`模型请求失败（HTTP ${response.status}）`);
    const data = responseSchema.parse(await response.json()),
      choice = data.choices[0];
    result = {
      content: choice.message.content ?? '',
      reasoning: choice.message.reasoning_content ?? undefined,
      toolCalls:
        choice.message.tool_calls?.map((t) => ({
          id: t.id,
          name: t.function.name,
          arguments: t.function.arguments,
        })) ?? [],
      usage: normalizeUsage(data.usage),
      truncated: choice.finish_reason === 'length',
    };
    success = true;
    return result;
  } catch (error) {
    throw new Error(
      error instanceof Error && /^模型请求失败/.test(error.message)
        ? error.message
        : controller.signal.aborted
          ? '请求已取消或超时'
          : 'Agent 模型连接或响应解析失败',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    await metric({
      requestId: id(),
      startedAt,
      endpoint: config.baseUrl,
      model: config.model,
      duration: Date.now() - startedAt,
      purpose: 'agent_step',
      success,
      error: success ? undefined : 'agent_request_failed',
      ...result.usage,
    }).catch(() => undefined);
  }
}
