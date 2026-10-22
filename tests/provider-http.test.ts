import { createServer } from 'node:http';
import { once } from 'node:events';
import { it, expect } from 'vitest';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { deepSeekPreset } from '../src/providers/provider';
it('uses an OpenAI-compatible HTTP endpoint and decodes streamed Chinese text', async () => {
  let requestPath = '';
  let authorization = '';
  let received: Record<string, unknown> = {};
  const server = createServer(async (req, res) => {
    requestPath = req.url ?? '';
    authorization = req.headers.authorization ?? '';
    let text = '';
    for await (const chunk of req) text += chunk;
    received = JSON.parse(text) as Record<string, unknown>;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"诶，咋了"}}]}\n\n');
    res.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  try {
    const provider = new OpenAICompatibleProvider(
      { ...deepSeekPreset, baseUrl: `http://127.0.0.1:${address.port}/v1` },
      { get: async () => 'fixture-key', set: async () => {}, remove: async () => {} },
      async () => {},
    );
    const result = await provider.streamChat(
      [{ role: 'user', content: '今天上班烦死了' }],
      () => {},
    );
    expect(result.content).toBe('诶，咋了');
    expect(requestPath).toBe('/v1/chat/completions');
    expect(authorization).toBe('Bearer fixture-key');
    expect(received.stream).toBe(true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
