import { expect, it } from 'vitest';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import type { ApiMetric } from '../src/providers/provider';
it('sends native tool declarations, keeps tool results and reasoning, and records actual usage', async () => {
  const metrics: ApiMetric[] = [];
  let body: Record<string, unknown> = {};
  const request = (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                { id: 'x', type: 'function', function: { name: 'wait', arguments: '{}' } },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 42, completion_tokens: 3 },
      }),
    );
  }) as typeof fetch;
  const p = new OpenAICompatibleProvider(
    {
      id: 'provider',
      provider: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      thinking: true,
    },
    { get: async () => 'test-only', set: async () => {}, remove: async () => {} },
    async (m) => {
      metrics.push(m);
    },
    request,
  );
  const result = await p.toolChat({
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'hidden' },
          { type: 'tool-call', id: 'prior', name: 'web_fetch', arguments: '{}' },
        ],
      },
      { role: 'tool', content: [{ type: 'text', text: 'observed' }], toolCallId: 'prior' },
    ],
    tools: [{ name: 'wait', description: 'wait', parameters: { type: 'object' } }],
  });
  expect(body.thinking).toEqual({ type: 'enabled' });
  expect(body.tool_choice).toBe('auto');
  expect(JSON.stringify(body.messages)).toContain('tool_call_id');
  expect(JSON.stringify(body.messages)).toContain('reasoning_content');
  expect(result.toolCalls[0].name).toBe('wait');
  expect(result.content).toBe('');
  expect(metrics[0].purpose).toBe('agent_step');
  expect(metrics[0].inputTokens).toBe(42);
  expect(JSON.stringify(metrics)).not.toContain('test-only');
});
