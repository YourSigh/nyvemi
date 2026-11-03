import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { StructuredOutputError } from '../src/providers/structured-error';
import { deepSeekPreset } from '../src/providers/provider';
function fixture(content: string, finish_reason = 'stop', baseUrl = deepSeekPreset.baseUrl) {
  const metric = vi.fn(async () => {});
  const http = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ finish_reason, message: { content } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      ),
  );
  const model = new OpenAICompatibleProvider(
    { ...deepSeekPreset, baseUrl },
    { get: async () => 'private-test-key', set: vi.fn(), remove: vi.fn() },
    metric,
    http,
  );
  return { model, metric, http };
}
it('enables official DS JSON mode for structured text/vision while preserving plain chat and custom endpoints', async () => {
  const { model, http } = fixture('{"ok":true}');
  await model.structuredOutput(
    [{ role: 'user', content: 'JSON' }],
    z.object({ ok: z.boolean() }),
    'visual_identity_planning',
  );
  await model.structuredVision(
    'JSON',
    ['data:image/png;base64,AAAA'],
    z.object({ ok: z.boolean() }),
    'visual_reference_review',
  );
  await model.chat([{ role: 'user', content: 'hello' }], 'chat');
  expect(http.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).response_format)).toEqual(
    [{ type: 'json_object' }, { type: 'json_object' }, undefined],
  );
  const custom = fixture('{"ok":true}', 'stop', 'https://custom.example/v1');
  await custom.model.structuredOutput(
    [],
    z.object({ ok: z.boolean() }),
    'visual_identity_planning',
  );
  expect(JSON.parse(String(custom.http.mock.calls[0][1]?.body)).response_format).toBeUndefined();
});
it('reports stage and field kinds without retaining values, prompts, schema messages or private record keys', async () => {
  const { model, metric, http } = fixture(
    '{"status":"private-test-key","features":["private-test-key"],"issues":[]}',
  );
  let failure: StructuredOutputError | undefined;
  try {
    await model.structuredVision(
      'JSON',
      ['data:image/png;base64,AAAA'],
      z.object({
        status: z.enum(['match', 'uncertain', 'mismatch']),
        features: z.array(z.string()),
        issues: z.array(z.string()),
      }),
      'visual_reference_review',
    );
  } catch (error) {
    expect(error).toBeInstanceOf(StructuredOutputError);
    failure = error as StructuredOutputError;
  }
  expect(failure?.message).toContain('参考图核对');
  expect(failure?.details).toMatchObject({
    reason: 'schema',
    issues: [{ path: ['status'], code: 'invalid_enum_value' }],
  });
  expect(JSON.stringify(failure)).not.toContain('private-test-key');
  expect(metric).toHaveBeenCalledWith(
    expect.objectContaining({ success: false, inputTokens: 10, outputTokens: 5 }),
  );
  expect(http).toHaveBeenCalledOnce();
  const issues = z.record(z.string()).safeParse({ 'private-test-key': 1 });
  if (!issues.success)
    expect(
      JSON.stringify(
        new StructuredOutputError('visual_reference_review', 'schema', issues.error.issues),
      ),
    ).not.toContain('private-test-key');
});
it('distinguishes invalid JSON, blank output and truncation without issuing automatic retries', async () => {
  for (const [content, finish, reason] of [
    ['not JSON', 'stop', 'json'],
    ['   ', 'stop', 'empty'],
    ['{"ok":', 'length', 'truncated'],
  ] as const) {
    const { model, metric, http } = fixture(content, finish);
    await expect(
      model.structuredOutput([], z.object({ ok: z.boolean() }), 'visual_prompt_composition'),
    ).rejects.toMatchObject({ details: { reason, stage: '绘图描述整理' } });
    expect(http).toHaveBeenCalledOnce();
    expect(metric).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, inputTokens: 10, outputTokens: 5 }),
    );
  }
});
it('accepts an entire fenced JSON response but does not extract a guessed object from prose', async () => {
  expect(
    await fixture(' \n```json\n{"ok":true}\n```\n').model.structuredOutput(
      [],
      z.object({ ok: z.boolean() }),
      'test',
    ),
  ).toEqual({ ok: true });
  await expect(
    fixture('explanation {"ok":true}').model.structuredOutput(
      [],
      z.object({ ok: z.boolean() }),
      'test',
    ),
  ).rejects.toBeInstanceOf(StructuredOutputError);
});
