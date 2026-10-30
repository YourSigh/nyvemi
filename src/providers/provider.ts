import { z } from 'zod';
import { ProviderConfigSchema, type ProviderConfig } from '../domain/models';
export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}
export interface LLMResult {
  content: string;
  usage: Usage;
}
export interface LLMProvider {
  toolChat?(
    request: import('../agent/core').AgentModelRequest,
    signal?: AbortSignal,
  ): Promise<import('../agent/core').AgentModelResult>;
  chat(messages: ChatTurn[], purpose: string, signal?: AbortSignal): Promise<LLMResult>;
  streamChat(
    messages: ChatTurn[],
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<LLMResult>;
  structuredOutput<T>(
    messages: ChatTurn[],
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    purpose: string,
  ): Promise<T>;
}
export interface SecretStore {
  get(): Promise<string | null>;
  set(key: string): Promise<void>;
  remove(): Promise<void>;
}
export interface ApiMetric extends Usage {
  requestId: string;
  startedAt: number;
  endpoint: string;
  model: string;
  duration: number;
  inputTokens?: number;
  outputTokens?: number;
  purpose: string;
  success: boolean;
  error?: string;
}
export const deepSeekPreset: ProviderConfig = {
  id: 'provider',
  provider: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  thinking: false,
};
export function validateProviderConfig(value: unknown): ProviderConfig {
  const checked = ProviderConfigSchema.safeParse(value);
  if (!checked.success)
    throw new Error(
      '请检查 Base URL 和模型名称：地址需包含 http:// 或 https://，模型名称不能为空。',
    );
  const config = checked.data;
  const url = new URL(config.baseUrl);
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Base URL 不能包含凭据、查询参数或片段');
  const octets = url.hostname.split('.').map(Number);
  const ipv4 =
    octets.length === 4 &&
    octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    /^[0-9.]+$/.test(url.hostname);
  const local =
    url.hostname === 'localhost' ||
    (ipv4 &&
      (octets[0] === 127 ||
        octets[0] === 10 ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)));
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new Error('仅 HTTPS 或本地网络 HTTP 地址可用');
  return { ...config, baseUrl: config.baseUrl.replace(/\/+$/, '') };
}
export interface ImageProvider {
  generateAvatar(description: string): Promise<string>;
}
