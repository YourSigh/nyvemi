import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { readImageFailure, ImageProviderError } from '../src/appearance/errors';
import { SeedreamImageProvider } from '../src/appearance/seedream';
import { defaultImageSettings } from '../src/appearance/model';
import { migrate, SQLiteStore } from '../src/storage/store';
import { TestDatabase } from './database';
it('distinguishes different 400 reasons without exposing the raw body, prompt, key or headers', async () => {
  for (const [code, category] of [
    ['InvalidParameter', 'parameters'],
    ['InputImageSensitiveContentDetected.PolicyViolation', 'content_review'],
    ['OutputImageSensitiveContentDetected', 'content_review'],
    ['ModelNotOpen', 'configuration'],
  ] as const) {
    const response = new Response(
      JSON.stringify({
        error: {
          code,
          param: 'image',
          message: 'private-test-key raw prompt Request ID: request-abc-123',
          extra: 'private-test-key',
        },
      }),
      {
        status: 400,
        headers: { 'x-request-id': 'request-abc-123', authorization: 'private-test-key' },
      },
    );
    const failure = await readImageFailure(response, 'private-test-key');
    expect(failure).toMatchObject({
      httpStatus: 400,
      code,
      category,
      requestId: 'request-abc-123',
      parameter: 'image',
    });
    expect(JSON.stringify(failure)).not.toMatch(/private-test-key|raw prompt|authorization/);
    expect(new ImageProviderError(failure).message).not.toContain('private-test-key');
  }
});
it('does not turn echoed credentials or arbitrary response strings into diagnostic tokens', async () => {
  const failure = await readImageFailure(
    new Response(
      JSON.stringify({
        request_id: 'abcSensitiveKey',
        error: {
          code: 'abcSensitiveKey',
          param: 'prompt abcSensitiveKey',
          message: 'Request ID: abcSensitiveKey',
        },
      }),
      { status: 400, headers: { 'x-request-id': 'abcSensitiveKey' } },
    ),
    'abcSensitiveKey',
  );
  expect(failure).toEqual({
    httpStatus: 400,
    category: 'unknown',
    code: undefined,
    parameter: undefined,
    requestId: undefined,
  });
});
it('retains client rejection metadata, permits an explicit retry, and blocks reissuing ambiguous server failures', async () => {
  const db = new TestDatabase();
  await migrate(db);
  const store = new SQLiteStore(db);
  const assets = {
    fingerprint: async () => 'ref',
    dataUrl: async () => 'data:image/png;base64,AA',
    download: async () => ({ uri: 'file://generated', width: 1024, height: 1024 }),
    exists: async () => true,
  };
  const request = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          error: { code: 'InvalidParameter', param: 'size', message: 'private-key' },
        }),
        { status: 400, headers: { 'x-request-id': 'safe-request-id' } },
      ),
  );
  const provider = new SeedreamImageProvider(
    defaultImageSettings,
    async () => 'private-key',
    store,
    assets,
    async (s) => createHash('sha256').update(s).digest('hex'),
    request,
  );
  const input = { description: '角色', mode: 'text' as const };
  await expect(provider.candidate(input, 0)).rejects.toMatchObject({
    failure: { code: 'InvalidParameter', parameter: 'size' },
  });
  const rejected = await store.list('imageRequests');
  expect(rejected[0]).toMatchObject({
    status: 'rejected',
    error: { code: 'InvalidParameter', requestId: 'safe-request-id' },
  });
  expect(JSON.stringify(rejected)).not.toContain('private-key');
  request.mockImplementation(async () => new Response('private-key', { status: 500 }));
  await expect(provider.candidate(input, 0)).rejects.toThrow('HTTP 500');
  expect((await store.list('imageRequests'))[0].status).toBe('started');
  await expect(provider.candidate(input, 0)).rejects.toThrow('结果不确定');
  expect(request).toHaveBeenCalledTimes(2);
});

it('distinguishes review of reference, prompt and generated output without blaming all input', () => {
  const message = (code: string) =>
    new ImageProviderError({ httpStatus: 400, code, category: 'content_review' }).message;
  expect(message('InputImageSensitiveContentDetected')).toContain('参考图未通过');
  expect(message('InputTextSensitiveContentDetected')).toContain('绘图文字未通过');
  expect(message('OutputImageSensitiveContentDetected')).toContain('生成的图片未通过审核');
  expect(message('SensitiveContentDetected')).toContain('调整描述或参考图');
});
it('classifies image-specific rejection reasons without retaining the raw provider message', async () => {
  for (const [message, reason] of [
    ['Failed to decode image base64 private-key', 'decode'],
    ['image aspect ratio exceeds range private-key', 'dimensions'],
    ['Unsupported image format private-key', 'format'],
    ['image file size too large private-key', 'size'],
    ['Failed to fetch image URL private-key', 'fetch'],
  ] as const) {
    const result = await readImageFailure(
      new Response(
        JSON.stringify({ error: { code: 'InvalidParameter', param: 'image', message } }),
        { status: 400 },
      ),
      'private-key',
    );
    expect(result.imageReason).toBe(reason);
    expect(JSON.stringify(result)).not.toContain('private-key');
    expect(JSON.stringify(result)).not.toContain(message);
  }
});
