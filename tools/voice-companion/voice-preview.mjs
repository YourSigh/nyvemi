import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

export const PREVIEW_LIMIT = 2 * 1024 * 1024;
export class PreviewError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
/** A deliberately narrow public audition resolver, never a general URL proxy.
 * A Chinese voice-over index maps to a conventional first archive clip candidate.
 * Availability is proved only by the CDN response, not by resolving the name.
 * No crawling, cookies, credentials, model input or reference-audio assignment.
 */
export function resolveVoicePreview(input) {
  const invalid = () => {
    throw new PreviewError(400, '仅支持指定原神或星穹铁道公开语音页，不能代理任意网址');
  };
  if (typeof input !== 'string' || input.length > 512 || /[\s\\\u0000-\u001f]/.test(input))
    return invalid();
  let url;
  try {
    url = new URL(input);
  } catch {
    return invalid();
  }
  if (
    url.protocol !== 'https:' ||
    !['honkai-star-rail.fandom.com', 'genshin-impact.fandom.com'].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return invalid();
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return invalid();
  }
  const genshin = url.hostname === 'genshin-impact.fandom.com';
  // Decode once; normalize MediaWiki title spaces, never accept encoded slashes,
  // traversal, arbitrary suffixes or double-encoded payloads.
  const index = /^\/wiki\/([A-Za-z][A-Za-z0-9 _-]{0,100})\/Voice-Overs\/Chinese$/.exec(path);
  if (index) {
    const name = index[1].replace(/ /g, '_');
    if (/__|[_-]$/.test(name)) return invalid();
    path = genshin
      ? `/wiki/File:VO_ZH_${name}_Hello.ogg`
      : `/wiki/File:VO_ZH_Archive_${name}_1.ogg`;
  }
  // Genshin uses VO_ZH_<character>_<line>.ogg; index pages propose Hello only.
  // Exact published filenames may select another short line. No recursive discovery.
  const pattern = genshin
    ? /^\/wiki\/File:(VO_ZH_[A-Za-z][A-Za-z0-9_-]{0,100}_[A-Za-z0-9][A-Za-z0-9_-]{0,60}\.ogg)$/
    : /^\/wiki\/File:(VO_(?:ZH|JP|EN|KR)_Archive_[A-Za-z][A-Za-z0-9_-]{0,100}_[A-Za-z0-9][A-Za-z0-9_-]{0,60}\.ogg)$/;
  const match = pattern.exec(path);
  if (!match) return invalid();
  // MediaWiki's canonical file namespace hash is UTF-8 MD5 of the filename.
  const filename = match[1],
    hash = createHash('md5').update(filename, 'utf8').digest('hex');
  return {
    filename,
    sourceUrl: `https://${url.hostname}/wiki/File:${filename}`,
    audioUrl: `https://static.wikia.nocookie.net/${genshin ? 'gensin-impact' : 'houkai-star-rail'}/images/${hash[0]}/${hash.slice(0, 2)}/${filename}/revision/latest`,
  };
}
export async function fetchVoicePreview(input, { transport = fetch, signal } = {}) {
  const resolved = resolveVoicePreview(input);
  const response = await transport(resolved.audioUrl, {
    method: 'GET',
    redirect: 'error',
    credentials: 'omit',
    signal,
    headers: { Accept: 'audio/ogg, audio/*;q=0.8' },
  });
  if (response.status === 404)
    throw new PreviewError(
      404,
      '该角色页面的首条公开试听样本不存在；未替换为其他角色，也没有自动重试',
    );
  if (!response.ok) throw new PreviewError(502, `公开试听源返回 ${response.status}；没有自动重试`);
  const type = response.headers.get('content-type') || '';
  if (!/^(?:audio\/[a-z0-9.+-]+|application\/(?:ogg|octet-stream))(?:\s*;|$)/i.test(type))
    throw new PreviewError(502, '试听源没有返回音频');
  const declared = Number(response.headers.get('content-length'));
  if (declared > PREVIEW_LIMIT) {
    await response.body?.cancel();
    throw new PreviewError(413, '试听音频超过 2 MiB 限制');
  }
  if (!response.body) throw new PreviewError(502, '试听源返回空音频');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > PREVIEW_LIMIT) throw new PreviewError(413, '试听音频超过 2 MiB 限制');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  // Ogg page version 0 with a complete segment table and first-page body.
  if (
    bytes.length < 28 ||
    bytes.toString('ascii', 0, 4) !== 'OggS' ||
    bytes[4] !== 0 ||
    bytes[26] === 0 ||
    bytes.length < 27 + bytes[26]
  )
    throw new PreviewError(502, '试听音频不是有效 Ogg');
  let firstPageSize = 27 + bytes[26];
  for (let i = 27; i < 27 + bytes[26]; i++) firstPageSize += bytes[i];
  if (bytes.length < firstPageSize) throw new PreviewError(502, '试听音频传输不完整');
  if (Number.isFinite(declared) && declared > 0 && declared !== bytes.length)
    throw new PreviewError(502, '试听音频传输不完整');
  return { bytes, ...resolved };
}
