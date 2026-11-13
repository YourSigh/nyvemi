import { expect, it, vi } from 'vitest';
import type { WebDocument } from '../src/agent/web';
import { findThemeReference } from '../src/theme/reference';

const document = (title: string, url: string, text = ''): WebDocument => ({
  title,
  url,
  text,
  source: 'web-search-snippet',
});

it('ranks directly relevant character sources, limits requests and retains snippets when a page fails', async () => {
  const unrelated = document('星穹铁道官方网站', 'https://publisher.example.com/main');
  const wrong = document('流萤（汉语词语）', 'https://dictionary.example.com/entry');
  const community = document(
    '流萤：崩坏星穹铁道 wiki',
    'https://wiki.example.com/characters/firefly',
    '流萤资料',
  );
  const official = document(
    '崩坏星穹铁道 流萤角色PV',
    'https://publisher.example.com/firefly',
    '角色介绍',
  );
  const invalid = document('流萤角色PV', 'https://192.168.1.2/firefly');
  const search = vi.fn().mockResolvedValue([unrelated, wrong, community, official, invalid]);
  const read = vi.fn(async (url: string) => {
    if (url !== official.url) throw Error('blocked');
    return {
      ...official,
      text:
        '开场介绍 '.repeat(150) +
        '目录：相貌衣着、角色介绍。' +
        '中间正文 '.repeat(150) +
        '流萤的银白色长发和青绿色服装。' +
        '结尾 '.repeat(500),
    };
  });
  const references = await findThemeReference(
    { search, read },
    ' 流萤 ',
    new AbortController().signal,
    '崩坏：星穹铁道',
  );
  expect(search.mock.calls.map(([query]) => query)).toEqual([
    '流萤 崩坏 星穹铁道',
    '流萤 角色 立绘 配色',
  ]);
  expect(read.mock.calls.map(([url]) => url)).toEqual([official.url, community.url]);
  expect(references.map(({ url }) => url)).toEqual([official.url, community.url]);
  expect(references[0].text).toContain('青绿色服装');
  expect(references[0].text.length).toBeLessThan(1300);
  expect(references[1].text).toBe('流萤资料');
});

it('falls back on a stalled search but propagates user cancellation', async () => {
  vi.useFakeTimers();
  try {
    const signals: AbortSignal[] = [];
    const search = vi.fn((_query: string, signal?: AbortSignal) => {
      if (signal) signals.push(signal);
      return new Promise<WebDocument[]>(() => {});
    });
    const read = vi.fn();
    const first = findThemeReference({ search, read }, '流萤', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(4001);
    expect(await first).toEqual([]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(read).not.toHaveBeenCalled();

    const controller = new AbortController();
    const second = findThemeReference({ search, read }, '流萤', controller.signal);
    const cancelled = expect(second).rejects.toThrow('取消');
    controller.abort();
    await cancelled;
  } finally {
    vi.useRealTimers();
  }
});
