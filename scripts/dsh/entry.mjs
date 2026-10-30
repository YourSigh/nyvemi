import './compat.mjs';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId, interruptedTurnClosers } from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools';
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
export async function run(input, ports) {
  const ctx = new Context();
  let calls = 0,
    agent;
  const abort = () => agent?.cancel({ kind: 'user' });
  ports.signal?.addEventListener('abort', abort);
  let idleTimer;
  class HostAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return { provider, id: model, name: model, defaultMaxTokens: 1536 };
    }
    async *stream(options) {
      if (++calls > input.maxSteps) throw Error('DSH step budget exceeded');
      await ports.checkpoint(agent.session.snapshotEvents());
      if (ports.signal?.aborted) throw Error('DSH canceled');
      const result = await ports.generate(options, ports.signal);
      if (result.reasoning) {
        yield { type: 'block-start', index: 0, blockType: 'reasoning' };
        yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: result.reasoning } };
      }
      let index = result.reasoning ? 1 : 0;
      if (result.content) {
        yield { type: 'block-start', index, blockType: 'text' };
        yield { type: 'block-end', index, block: { type: 'text', text: result.content } };
        index++;
      }
      for (const t of result.toolCalls ?? []) {
        yield { type: 'block-start', index, blockType: 'tool-call' };
        yield {
          type: 'block-end',
          index,
          block: { type: 'tool-call', id: ToolCallId(t.id), name: t.name, arguments: t.arguments },
        };
        index++;
      }
      yield { type: 'usage', usage: result.usage ?? { inputTokens: 0, outputTokens: 0 } };
      yield {
        type: 'finish',
        reason: {
          kind: result.truncated ? 'max-tokens' : result.toolCalls?.length ? 'tool-calls' : 'stop',
        },
      };
    }
  }
  try {
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(SessionProjectionRegistry);
    await ctx.plugin(SystemPrompt, { personaPrefix: input.system });
    await ctx.plugin(ToolRuntime);
    await ctx.plugin(NativeToolExecutor);
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 });
    ctx.llm.registerAdapter(['nyvemi'], new HostAdapter());
    for (const tool of input.tools)
      ctx.tools.register(
        defineTool({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          output: {
            schema: { type: 'json' },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          execute: async (args, exec) => {
            await ports.checkpoint(agent.session.snapshotEvents());
            const result = await ports.execute(tool.name, args, {
              signal: exec.signal,
              callId: exec.callId,
            });
            if (tool.terminal) exec.concludeTurn();
            return result;
          },
        }),
      );
    const handle = await ctx.agents.create({
      sessionId: SessionId(input.id),
      agentOptions: { provider: 'nyvemi', model: input.model },
      ...(input.seed?.length
        ? { seed: [...input.seed, ...interruptedTurnClosers(input.seed)] }
        : {}),
    });
    agent = handle.agent;
    const idle = new Promise((resolve, reject) => {
      ctx.on('agent/status', ({ status }) => {
        if (status === 'idle') resolve();
      });
      idleTimer = setTimeout(() => {
        abort();
        reject(Error('DSH run timed out'));
      }, input.timeoutMs);
    });
    agent.followup(
      createUserMessage({
        content: [{ type: 'text', text: input.text }],
        source: { kind: 'user' },
      }),
    );
    await idle;
    const events = agent.session.snapshotEvents();
    await ports.checkpoint(events);
    const end = events.findLast((e) => e.type === 'turn/end');
    if (end?.data.reason.kind !== 'completed') throw Error('DSH turn did not complete');
    return { events, calls };
  } finally {
    clearTimeout(idleTimer);
    ports.signal?.removeEventListener('abort', abort);
    await ctx.fiber.dispose();
    if (agent) await ports.checkpoint(agent.session.snapshotEvents());
  }
}
