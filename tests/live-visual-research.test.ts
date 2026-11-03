import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
import { PublicAgentWeb, publicUrl } from '../src/agent/web';
import { MockContentProvider } from '../src/exploration/content';
import { DSVisualDirector } from '../src/appearance/research';
import { OpenAICompatibleProvider } from '../src/providers/openai';
import { deepSeekPreset, type ApiMetric } from '../src/providers/provider';
import type { ImageAssets } from '../src/appearance/service';
it.skipIf(process.env.NYVEMI_RUN_LIVE_VISUAL_RESEARCH !== '1')(
  'uses at most four real DS calls and public references, never any image-generation endpoint',
  async () => {
    mkdirSync('artifacts/visual-research', { recursive: true });
    const metrics: ApiMetric[] = [];
    const publicVisits: { host: string; status: number }[] = [];
    let modelRequests = 0;
    const responseShapes: unknown[] = [];
    const model = new OpenAICompatibleProvider(
      {
        ...deepSeekPreset,
        baseUrl: process.env.NYVEMI_TEST_BASE_URL!,
        model: process.env.NYVEMI_TEST_MODEL!,
      },
      {
        get: async () => process.env.NYVEMI_TEST_API_KEY!,
        set: async () => {},
        remove: async () => {},
      },
      async (m) => {
        metrics.push(m);
      },
      (async (...args: Parameters<typeof fetch>) => {
        const url = new URL(String(args[0]));
        if (
          url.origin !== 'https://api.deepseek.com' ||
          url.pathname !== '/chat/completions' ||
          ++modelRequests > 4
        )
          throw Error('live request boundary');
        const response = await fetch(...args);
        const body = (await response.clone().json()) as {
          choices?: { message?: { content?: string } }[];
        };
        try {
          const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? '') as Record<
            string,
            unknown
          >;
          responseShapes.push({
            keys: Object.keys(parsed),
            fieldTypes: Object.fromEntries(
              Object.entries(parsed).map(([k, v]) => [k, Array.isArray(v) ? 'array' : typeof v]),
            ),
          });
        } catch {
          responseShapes.push({ json: false });
        }
        return response;
      }) as typeof fetch,
    );
    const publicFetch = (async (...args: Parameters<typeof fetch>) => {
      const url = publicUrl(String(args[0]));
      if (args[1]?.headers && new Headers(args[1].headers).has('Authorization'))
        throw Error('public credential boundary');
      const response = await fetch(...args);
      publicVisits.push({ host: url.hostname, status: response.status });
      return response;
    }) as typeof fetch;
    const web = new PublicAgentWeb(new MockContentProvider([]), publicFetch);
    const dimensions = (file: string) => {
      const info = execFileSync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], {
        encoding: 'utf8',
      });
      return {
        width: Number(/pixelWidth:\s*(\d+)/.exec(info)?.[1]),
        height: Number(/pixelHeight:\s*(\d+)/.exec(info)?.[1]),
      };
    };
    const assets: ImageAssets = {
      fingerprint: async (a) => a.uri,
      exists: async () => true,
      dataUrl: async (a) => {
        const bytes = readFileSync(fileURLToPath(a.uri));
        return `data:image/${bytes[0] === 137 ? 'png' : bytes[0] === 255 ? 'jpeg' : 'webp'};base64,${bytes.toString('base64')}`;
      },
      download: async (input, key) => {
        let url = publicUrl(input);
        let response: Response | undefined;
        for (let n = 0; n < 4; n++) {
          response = await publicFetch(url.href, {
            redirect: 'manual',
            credentials: 'omit',
            signal: AbortSignal.timeout(15000),
          });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            url = publicUrl(new URL(response.headers.get('location')!, url).href);
            response = undefined;
            continue;
          }
          break;
        }
        if (
          !response?.ok ||
          response.redirected ||
          Number(response.headers.get('content-length')) > 12 * 1024 * 1024
        )
          throw Error('public image unavailable');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 12 * 1024 * 1024) throw Error('public image too large');
        const file = resolve(`artifacts/visual-research/${key}.bin`);
        writeFileSync(file, bytes);
        return { uri: pathToFileURL(file).href, ...dimensions(file) };
      },
    };
    const director = new DSVisualDirector(
      async () => model,
      web,
      assets,
      async (value) => createHash('sha256').update(value).digest('hex'),
    );
    const input = { description: 'q版的原神纳西妲，可爱一点', mode: 'text' as const };
    let outcome: unknown;
    try {
      const result = await director.research(input);
      expect(result.brief.namedCharacter).toBe(true);
      expect(result.brief.subject).toContain('纳西妲');
      const wrong = {
        uri: pathToFileURL(resolve('assets/nyvemi-icon.png')).href,
        width: 1024,
        height: 1024,
      };
      const review = result.references.length
        ? await director.review({ ...input, reference: result.references[0].asset }, wrong)
        : await model.structuredVision(
            '这是人物立绘吗？只返回JSON: isCharacter布尔。',
            [await assets.dataUrl(wrong)],
            z.object({ isCharacter: z.boolean() }),
            'visual_candidate_review',
          );
      if ('status' in review) expect(review.status).not.toBe('match');
      else expect(review.isCharacter).toBe(false);
      outcome = { result, wrongImageReview: review };
    } finally {
      writeFileSync(
        'artifacts/live-visual-research.json',
        JSON.stringify(
          {
            modelRequests,
            imageGenerationRequests: 0,
            publicVisits,
            responseShapes,
            metrics,
            outcome,
          },
          null,
          2,
        ),
      );
    }
  },
  240000,
);
