import { expect, it, vi } from 'vitest';
import { BilibiliContentProvider } from '../src/exploration/content';
import { DeepSeekBilibiliSearch } from '../src/exploration/deepseek-search';
import { deepSeekPreset } from '../src/providers/provider';

const entry = {
  title: '机器人 <b>平衡</b>_哔哩哔哩_bilibili',
  url: 'https://www.bilibili.com/video/BV1234567890/?spm_id_from=track#1',
  snippet: '平衡实验',
};
const key = 'fixture-only';
const credentials = async () => ({ config: deepSeekPreset, key });

it('uses the official key only on the search API, accepts canonical video results and bills once', async () => {
  const guest = vi.fn<typeof fetch>();
  const indexed = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      results: [
        entry,
        { ...entry, url: 'https://www.bilibili.com/video/BV1234567890' },
        { ...entry, url: 'https://www.bilibili.com.evil.invalid/video/BV1234567890' },
        { ...entry, url: 'https://b23.tv/BV1234567890' },
        { ...entry, url: 'https://www.bilibili.com/video/BV1234567890/extra' },
      ],
    }),
  );
  const metric = vi.fn(async () => {});
  const provider = new BilibiliContentProvider(
    guest,
    undefined,
    new DeepSeekBilibiliSearch(credentials, indexed, metric),
  );
  expect(await provider.candidates({ topics: ['机器人', '备选'], indexedSearch: true })).toEqual([
    {
      id: 'BV1234567890',
      url: 'https://www.bilibili.com/video/BV1234567890',
      title: '机器人 平衡',
      description: '平衡实验',
      author: '',
      category: '',
      discovery: 'deepseek_search',
    },
  ]);
  expect(indexed).toHaveBeenCalledExactlyOnceWith(
    'https://api.deepseek.com/v1/tools/search',
    expect.objectContaining({
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      body: JSON.stringify({
        query: '机器人 site:www.bilibili.com',
        count: 16,
        need_content: false,
      }),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    }),
  );
  expect(guest).not.toHaveBeenCalled();
  expect(metric).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ success: true, purpose: 'bilibili_discovery' }),
    true,
  );
  expect(JSON.stringify(metric.mock.calls)).not.toContain(key);
});

it('does not call paid search without opt-in or with a third-party provider configuration', async () => {
  const guest = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({ code: 0, data: { list: [] } }));
  const indexed = vi.fn<typeof fetch>();
  const thirdParty = async () => ({
    config: { ...deepSeekPreset, baseUrl: 'https://api.deepseek.com.example.org' },
    key,
  });
  await new BilibiliContentProvider(
    guest,
    undefined,
    new DeepSeekBilibiliSearch(credentials, indexed),
  ).candidates();
  await new BilibiliContentProvider(
    guest,
    undefined,
    new DeepSeekBilibiliSearch(thirdParty, indexed),
  ).candidates({ topics: ['机器人'], indexedSearch: true });
  expect(indexed).not.toHaveBeenCalled();
  expect(guest).toHaveBeenCalled();
});

it('returns empty results without billing or silently requesting another source', async () => {
  const indexed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [] }));
  const metric = vi.fn(async () => {});
  const guest = vi.fn<typeof fetch>();
  const provider = new BilibiliContentProvider(
    guest,
    undefined,
    new DeepSeekBilibiliSearch(credentials, indexed, metric),
  );
  await expect(provider.candidates({ topics: ['猫'], indexedSearch: true })).resolves.toEqual([]);
  expect(metric).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ success: true }), false);
  expect(guest).not.toHaveBeenCalled();
});
