import { fetchGenericPreview, fetchPublicResource } from './generic-preview.mjs';
import { fetchBwikiPreview } from './bwiki-preview.mjs';
import { resolveVoicePreview } from './voice-preview.mjs';
import { normalizeAudio, CompanionError } from './audio.mjs';
const seeds = [
  {
    names: ['流萤', 'firefly'],
    urls: [
      'https://honkai-star-rail.fandom.com/wiki/Firefly/Voice-Overs/Chinese',
      'https://wiki.biligame.com/sr/流萤/语音',
    ],
  },
  {
    names: ['卡芙卡', 'kafka'],
    urls: ['https://honkai-star-rail.fandom.com/wiki/Kafka/Voice-Overs/Chinese'],
  },
  { names: ['阿狸', 'ahri'], urls: ['https://wiki.leagueoflegends.com/en-us/Ahri/Audio'] },
  {
    names: ['纳西妲', 'nahida'],
    urls: [
      'https://wiki.biligame.com/ys/纳西妲语音',
      'https://genshin-impact.fandom.com/wiki/Nahida/Voice-Overs/Chinese',
    ],
  },
  {
    names: ['芙宁娜', 'furina'],
    urls: [
      'https://wiki.biligame.com/ys/芙宁娜语音',
      'https://genshin-impact.fandom.com/wiki/Furina/Voice-Overs/Chinese',
    ],
  },
  {
    names: ['刻晴', 'keqing'],
    urls: [
      'https://wiki.biligame.com/ys/刻晴语音',
      'https://genshin-impact.fandom.com/wiki/Keqing/Voice-Overs/Chinese',
    ],
  },
  { names: ['三月七', 'march 7th'], urls: ['https://wiki.biligame.com/sr/三月七/语音'] },
];
export function referenceCandidates(query, urls = []) {
  if (
    typeof query !== 'string' ||
    !query.trim() ||
    query.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(query) ||
    !Array.isArray(urls) ||
    urls.length > 6 ||
    urls.some((u) => typeof u !== 'string' || u.length > 2048)
  )
    throw new CompanionError(400, '请提供角色名称和最多6个公开来源链接');
  const label = query.trim(),
    key = label.toLowerCase();
  const matched = seeds.find((seed) => seed.names.some((n) => key === n || key.includes(n)));
  // Explicit candidates first; caller performs role search, no model/key in companion.
  return { label, urls: [...new Set([...urls, ...(matched?.urls || [])])].slice(0, 4) };
}
async function publicPreview(url, { signal }) {
  const host = new URL(url).hostname;
  if (host === 'wiki.biligame.com')
    return fetchBwikiPreview(url, {
      signal,
      transport: async (input, options) => {
        const result = await fetchPublicResource(input, { signal: options.signal });
        return new Response(result.bytes, {
          status: 200,
          headers: {
            'content-type': result.contentType,
            'content-length': String(result.bytes.length),
          },
        });
      },
    });
  if (['honkai-star-rail.fandom.com', 'genshin-impact.fandom.com'].includes(host)) {
    const resolved = resolveVoicePreview(url);
    const result = await fetchGenericPreview(resolved.audioUrl, { signal });
    return { ...result, sourceUrl: resolved.sourceUrl };
  }
  return fetchGenericPreview(url, { signal });
}
export async function resolveReference(
  input,
  { signal, preview = publicPreview, normalize = normalizeAudio } = {},
) {
  const candidates = referenceCandidates(input?.query, input?.urls);
  const controller = new AbortController(),
    stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const timer = setTimeout(stop, 45000);
  try {
    for (const url of candidates.urls) {
      controller.signal.throwIfAborted();
      try {
        const result = await preview(url, { signal: controller.signal });
        const wav = await normalize(result.bytes, { signal: controller.signal });
        controller.signal.throwIfAborted();
        // Public availability never implies permission for voice cloning.
        return {
          label: candidates.label,
          sourceUrl: result.sourceUrl,
          wavBase64: wav.toString('base64'),
          usage: 'preview',
        };
      } catch (error) {
        if (controller.signal.aborted) throw error;
      }
    }
    throw new CompanionError(422, '未找到可直接试听的公开音频，请提供公开语音页或音频链接');
  } catch (error) {
    if (signal?.aborted) throw new CompanionError(499, '请求已取消');
    if (controller.signal.aborted) throw new CompanionError(504, '公开语音查找超时');
    if (error instanceof CompanionError) throw error;
    throw new CompanionError(502, '无法读取公开语音');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    controller.abort();
  }
}
