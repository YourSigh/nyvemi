import { publicUrl, type AgentWeb, type WebDocument } from '../agent/web';
import { themeTask } from './task';

export interface ThemeReference {
  title: string;
  url: string;
  text: string;
}

const officialHint =
  /官方网站|官网|角色(?:PV|介绍|演示)|官方(?:立绘|角色)|official (?:site|website|channel|character)|character (?:trailer|teaser|profile)/i;
const unofficialHint = /同人|饭制|同好|导航|攻略|下载|VPN|cosplay|fan art|unofficial/i;
const unrelatedHint = /汉语词语|词典|\bdictionary\b/i;
const appearanceHint =
  /配色|外观|立绘|发色|瞳色|头发|服装|衣服|[金银红橙黄绿青蓝紫粉黑白灰]色|\b(?:palette|colou?r|outfit|hair|eyes|portrait)\b/i;
const colorDetail =
  /(?:头发|頭髮|髮色|发色|瞳色|瞳孔|服装|服裝|服饰|服飾|裙|外套|发饰|髮飾|[金银銀红紅橙黄黃绿綠青蓝藍紫粉黑白灰]色|\b(?:outfit|hair|eyes|palette)\b).{0,36}(?:[金银銀红紅橙黄黃绿綠青蓝藍紫粉黑白灰]色|色调|色調|\b(?:mint|silver|gold|black|white|green|red|blue|purple|pink|beige|cyan|teal|amber)\b)/i;

function searchWords(input: string) {
  return input
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);
}

function key(input: string) {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function excerpt(text: string, subject: string) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const first = clean.slice(0, 380);
  const appearance = clean.search(colorDetail);
  const name = clean.toLowerCase().indexOf(subject.toLowerCase());
  const offset = appearance >= 300 ? appearance : name;
  return offset >= 300
    ? `${first}\n${clean.slice(offset - 90, offset + 490)}`
    : clean.slice(0, 960);
}

function publicReference(doc: WebDocument): ThemeReference | undefined {
  try {
    const url = publicUrl(doc.url);
    if (url.href.length > 2048 || !doc.title.trim()) return;
    return { title: doc.title.trim().slice(0, 240), url: url.href, text: doc.text };
  } catch {
    return undefined;
  }
}

/** Gather a few public snippets and targeted page excerpts, without loading images or sending chat history. */
export async function findThemeReference(
  web: Pick<AgentWeb, 'search' | 'read'>,
  subject: string,
  signal: AbortSignal,
  work = '',
): Promise<ThemeReference[]> {
  const name = searchWords(subject);
  const nameKey = key(name);
  const workName = searchWords(work);
  const workKey = key(workName);
  const checkCancellation = () => {
    if (signal.aborted) throw new Error('换色已取消');
  };
  checkCancellation();
  if (!nameKey) return [];

  const queries = new Set([`${name} ${workName || '角色'}`, `${name} 角色 立绘 配色`]);
  const hits = await Promise.all(
    [...queries].map((query) =>
      themeTask((requestSignal) => web.search(query, requestSignal), 4_000, signal).catch(() => []),
    ),
  );
  checkCancellation();

  const relevance = (doc: ThemeReference) => {
    if (unrelatedHint.test(doc.title)) return 0;
    const title = key(doc.title);
    const body = key(doc.text.slice(0, 10_000));
    const inTitle = title.includes(nameKey);
    if (!inTitle && !body.includes(nameKey)) return 0;
    const full = `${doc.title} ${doc.text.slice(0, 1500)}`;
    return (
      1 +
      (inTitle ? 6 : 0) +
      (workKey && (title.includes(workKey) || body.includes(workKey)) ? 5 : 0) +
      (officialHint.test(doc.title) && !unofficialHint.test(doc.title) ? 4 : 0) +
      (appearanceHint.test(full) ? 2 : 0) -
      (unofficialHint.test(doc.title) ? 4 : 0)
    );
  };
  const candidates = new Map<string, ThemeReference>();
  for (const page of hits.flatMap((batch) => batch.slice(0, 6))) {
    const doc = publicReference(page);
    if (doc && relevance(doc) > 3 && !candidates.has(doc.url)) candidates.set(doc.url, doc);
  }
  const ranked = [...candidates.values()].sort((a, b) => relevance(b) - relevance(a)).slice(0, 4);
  const pages = await Promise.all(
    ranked.slice(0, 2).map(async (snippet) => {
      const page = await themeTask(
        (requestSignal) => web.read(snippet.url, requestSignal),
        4_000,
        signal,
      ).catch(() => undefined);
      const doc = page && publicReference(page);
      if (doc && relevance(doc) > 0 && doc.text.trim())
        return { ...doc, text: `${snippet.text.slice(0, 220)}\n${excerpt(doc.text, name)}`.trim() };
      return { ...snippet, text: excerpt(snippet.text, name) };
    }),
  );
  checkCancellation();
  return [...pages, ...ranked.slice(2).map((doc) => ({ ...doc, text: excerpt(doc.text, name) }))];
}
