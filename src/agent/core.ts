import { run } from '../../vendor/dsh-runtime';
import type { Usage } from '../providers/provider';
/** The embedded official runtime owns sessions, tool validation, dispatch and continuation. */
export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  terminal?: boolean;
}
export interface AgentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  arguments?: string;
}
export interface AgentModelRequest {
  messages: {
    role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
    content: AgentBlock[];
    toolCallId?: string;
  }[];
  tools?: { name: string; description: string; parameters: Record<string, unknown> }[];
  maxTokens?: number;
}
export interface AgentModelResult {
  content: string;
  reasoning?: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  usage: Usage;
  truncated?: boolean;
}
export interface AgentRunInput {
  id: string;
  model: string;
  system: string;
  text: string;
  seed?: unknown[];
  maxSteps: number;
  timeoutMs: number;
  tools: AgentTool[];
}
export interface AgentPorts {
  signal?: AbortSignal;
  generate(request: AgentModelRequest, signal?: AbortSignal): Promise<AgentModelResult>;
  checkpoint(events: unknown[]): Promise<void>;
  execute(
    name: string,
    args: unknown,
    execution: { signal: AbortSignal; callId: string; sequence: number },
  ): Promise<unknown>;
}
export type AgentRunner = (
  input: AgentRunInput,
  ports: AgentPorts,
) => Promise<{ events: unknown[]; calls: number }>;
export const runEmbeddedAgent: AgentRunner = run;
