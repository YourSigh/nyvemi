import { mobileAgentRunner } from './mobile-runtime';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import type { AgentRunInput } from '../src/agent/core';
import { agentFailure } from '../src/agent/errors';
const input: AgentRunInput = {
  id: 'mobile',
  model: 'mock',
  system: 'Use tools. Text is private.',
  text: '换成淡绿色主题',
  maxSteps: 4,
  timeoutMs: 5000,
  tools: [
    {
      name: 'change_theme',
      description: 'Change theme',
      parameters: { description: { type: 'string', required: true } },
    },
    { name: 'wait', description: 'End silently', parameters: {}, terminal: true },
  ],
};
it('runs theme change then silence with actual RN AbortController in a separate mobile-like runtime', async () => {
  const run = mobileAgentRunner(),
    applied: string[] = [];
  let requests = 0;
  const result = await run(input, {
    checkpoint: async () => {},
    generate: async () => ({
      content: '',
      usage: {},
      toolCalls: [
        {
          id: `c${++requests}`,
          name: requests === 1 ? 'change_theme' : 'wait',
          arguments: requests === 1 ? '{"description":"淡绿色"}' : '{}',
        },
      ],
    }),
    execute: async (name, args) => {
      if (name === 'change_theme') applied.push((args as { description: string }).description);
      return { success: true };
    },
  });
  expect(result.calls).toBe(2);
  expect(applied).toEqual(['淡绿色']);
});
it.each([400, 401, 402, 429, 503])(
  'retains the host HTTP %s cause while keeping user-facing errors safe',
  async (status) => {
    const run = mobileAgentRunner();
    try {
      await run(input, {
        checkpoint: async () => {},
        execute: async () => ({}),
        generate: async () => {
          throw Error(`模型请求失败（HTTP ${status}）`);
        },
      });
      throw Error('expected failure');
    } catch (error) {
      const failure = agentFailure(error);
      expect(failure.detail).toContain(`HTTP ${status}`);
      expect(failure.message).not.toContain('HTTP');
      expect(failure.message).not.toContain('DSH');
      expect(failure.code).toMatch(/^provider_/);
    }
  },
);
it('identifies an exhausted step budget instead of returning an undifferentiated DSH error', async () => {
  const run = mobileAgentRunner();
  let calls = 0;
  try {
    await run(
      { ...input, maxSteps: 1 },
      {
        checkpoint: async () => {},
        execute: async () => ({}),
        generate: async () => ({
          content: '',
          usage: {},
          toolCalls: [
            { id: `c${++calls}`, name: 'change_theme', arguments: '{"description":"淡绿色"}' },
          ],
        }),
      },
    );
    throw Error('expected limit');
  } catch (error) {
    expect(agentFailure(error).code).toBe('step_limit');
  }
});

it('preserves RN cancellation reasons and closes an interrupted turn without a secondary runtime failure', async () => {
  const run = mobileAgentRunner();
  const { AbortController } = createRequire(import.meta.url)(
    'abort-controller/dist/abort-controller',
  );
  const parent = new AbortController();
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = run(input, {
    signal: parent.signal,
    checkpoint: async () => {},
    execute: async () => ({}),
    generate: async (_request, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(Error('已取消')));
        started();
      }),
  }).catch((error) => agentFailure(error));
  await entered;
  parent.abort({ kind: 'user' });
  const result = await pending;
  expect(result).toMatchObject({ code: 'canceled', kind: 'aborted' });
  expect(parent.signal.reason).toEqual({ kind: 'user' });
});
