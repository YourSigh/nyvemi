import { runtimeStats } from '../vendor/dsh-runtime';
import { describe, expect, it } from 'vitest';
import {
  runEmbeddedAgent,
  type AgentModelRequest,
  type AgentModelResult,
  type AgentRunInput,
} from '../src/agent/core';
const input: AgentRunInput = {
  id: 'dsh-test',
  model: 'mock',
  system: 'Use tools; text is private.',
  text: 'hello',
  maxSteps: 6,
  timeoutMs: 5000,
  tools: [
    {
      name: 'send_message',
      description: 'Send one bubble',
      parameters: { text: { type: 'string', required: true } },
    },
    { name: 'wait', description: 'End without a message', parameters: {}, terminal: true },
  ],
};
const call = (name: string, args: unknown, id = 'c1'): AgentModelResult => ({
  content: '',
  toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
  usage: {},
});
const stop: AgentModelResult = {
  content: 'internal completion, do not deliver',
  toolCalls: [],
  usage: {},
};
describe('official embedded DSH core', () => {
  it('runs tool → observation → model and replays its durable session after restart', async () => {
    const requests: AgentModelRequest[] = [],
      sent: unknown[] = [],
      checkpoints: unknown[][] = [];
    const first = await runEmbeddedAgent(input, {
      generate: async (request) => {
        requests.push(request);
        return requests.length === 1 ? call('send_message', { text: '嘿' }) : stop;
      },
      execute: async (_name, args) => {
        sent.push(args);
        return { delivered: true };
      },
      checkpoint: async (events) => {
        checkpoints.push(events);
      },
    });
    expect(sent).toEqual([{ text: '嘿' }]);
    expect(first.calls).toBe(2);
    expect(requests[1].messages.at(-1)?.role).toBe('tool');
    expect(checkpoints.length).toBeGreaterThan(2);
    let resumed: AgentModelRequest | undefined;
    await runEmbeddedAgent(
      { ...input, text: 'again', seed: first.events },
      {
        generate: async (request) => {
          resumed = request;
          return call('wait', {});
        },
        execute: async () => ({ waiting: true }),
        checkpoint: async () => {},
      },
    );
    expect(resumed?.messages.some((m) => m.role === 'tool')).toBe(true);
    expect(JSON.stringify(resumed)).toContain('嘿');
  });
  it('can finish silently with no tool and no sent bubble', async () => {
    let executions = 0;
    const result = await runEmbeddedAgent(input, {
      generate: async () => stop,
      execute: async () => {
        executions++;
        return {};
      },
      checkpoint: async () => {},
    });
    expect(result.calls).toBe(1);
    expect(executions).toBe(0);
  });
  it('validates tool arguments before invoking the host and returns errors to the model', async () => {
    let attempts = 0,
      executions = 0;
    await runEmbeddedAgent(input, {
      generate: async (request) => {
        attempts++;
        if (attempts === 1) return call('send_message', { text: 42 });
        expect(JSON.stringify(request.messages.at(-1))).toContain('invalid arguments');
        return stop;
      },
      execute: async () => {
        executions++;
        return {};
      },
      checkpoint: async () => {},
    });
    expect(executions).toBe(0);
  });
  it('bounds model loops without sending private text as a fallback', async () => {
    let calls = 0;
    await expect(
      runEmbeddedAgent(
        { ...input, maxSteps: 2 },
        {
          generate: async () => call('send_message', { text: 'x' }, `c${++calls}`),
          execute: async () => ({}),
          checkpoint: async () => {},
        },
      ),
    ).rejects.toThrow('did not complete');
    expect(calls).toBe(2);
  });
});

it('disposes ambient stores after a run in the long-lived app process', () => {
  expect(runtimeStats().ambientStores).toBe(0);
});
