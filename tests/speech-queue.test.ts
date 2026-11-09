import { it, expect, vi } from 'vitest';
import { SpeechQueue } from '../src/speech/queue';
import { voiceOptions, voiceProfile } from '../src/speech/preferences';
import type { Message } from '../src/domain/models';

const muted = voiceProfile();
const audible = { ...muted, enabled: true, playbackSet: true } as const;
const msg = (id: string, content = '嗨', createdAt = 100): Message => ({
  id,
  characterId: 'c',
  role: 'assistant',
  content,
  createdAt,
  status: 'complete',
  origin: 'chat',
});
const makeDriver = () => ({
  play: vi.fn(async (_id: string, _text: string, _options: unknown) => true),
  stop: vi.fn(async () => {}),
});

it('defaults to mute, including old preferences that could be enabled automatically', () => {
  expect(voiceOptions(undefined).enabled).toBe(false);
  expect(voiceOptions({ ...muted, enabled: true, voiceId: 'zh' })).toMatchObject({
    enabled: false,
    voiceId: 'zh',
  });
  expect(voiceOptions(audible).enabled).toBe(true);
});

it('skips history and pagination, then reads each new complete assistant message once', async () => {
  const driver = makeDriver();
  const queue = new SpeechQueue(driver, undefined, () => 100);
  queue.observe([msg('old')], audible);
  expect(driver.play).not.toHaveBeenCalled();
  queue.observe(
    [
      msg('old'),
      msg('earlier-page', '旧消息', 99),
      msg('new'),
      msg('empty', ''),
      { ...msg('pending'), status: 'pending' },
      { ...msg('error'), status: 'error' },
      { ...msg('user'), role: 'user' },
    ],
    audible,
  );
  queue.observe([msg('new')], audible);
  await vi.waitFor(() => expect(driver.play.mock.calls.map(([id]) => id)).toEqual(['new:0']));
});

it('reads only live arrivals after enabling speech or returning to chat', async () => {
  let now = 100;
  const driver = makeDriver();
  const queue = new SpeechQueue(driver, undefined, () => now);
  const mutedMessage = msg('muted');
  queue.observe([], muted);
  queue.observe([mutedMessage], muted);
  queue.replay(mutedMessage, muted);
  expect(driver.play).not.toHaveBeenCalled();

  now = 200;
  queue.resume();
  queue.observe(
    [mutedMessage, msg('before-enabling', '之前', 199), msg('live', '现在', 201)],
    audible,
  );
  await vi.waitFor(() => expect(driver.play.mock.calls.map(([id]) => id)).toEqual(['live:0']));

  queue.stop();
  now = 300;
  queue.resume();
  queue.observe([msg('background', '后台', 250), msg('after-return', '回来啦', 301)], audible);
  await vi.waitFor(() =>
    expect(driver.play.mock.calls.map(([id]) => id)).toEqual(['live:0', 'after-return:0']),
  );
});

it('serializes bubbles and discards pending speech immediately when muted', async () => {
  const driver = makeDriver();
  let finish: (value: boolean) => void = () => {};
  driver.play.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const queue = new SpeechQueue(driver, undefined, () => 100);
  const first = msg('hello');
  const second = msg('color', '你喜欢什么颜色？');
  queue.observe([], audible);
  queue.observe([first, second], audible);
  expect(driver.play.mock.calls.map(([id]) => id)).toEqual(['hello:0']);

  queue.observe([first, second], muted);
  expect(driver.stop).toHaveBeenCalledOnce();
  finish(false);
  queue.resume();
  queue.observe([first, second, msg('third')], audible);
  await vi.waitFor(() =>
    expect(driver.play.mock.calls.map(([id]) => id)).toEqual(['hello:0', 'third:0']),
  );
});

it('allows intentional replay and avoids autoplaying a bubble tapped before refresh', async () => {
  const driver = makeDriver();
  const queue = new SpeechQueue(driver, undefined, () => 100);
  const message = msg('manual');
  queue.observe([], audible);
  queue.replay(message, audible);
  queue.observe([message], audible);
  await vi.waitFor(() => expect(driver.play).toHaveBeenCalledOnce());
  queue.replay(message, audible);
  await vi.waitFor(() => expect(driver.play).toHaveBeenCalledTimes(2));
});

it('reports unavailable local voices once without retrying every queued bubble', async () => {
  const driver = makeDriver();
  driver.play.mockRejectedValue(Error('no offline voice'));
  const state = vi.fn();
  const queue = new SpeechQueue(driver, state, () => 100);
  queue.observe([], audible);
  queue.observe([msg('1'), msg('2')], audible);
  await vi.waitFor(() => expect(state).toHaveBeenLastCalledWith({ error: '本机声音尚未就绪' }));
  queue.observe([msg('3')], audible);
  expect(driver.play).toHaveBeenCalledOnce();
});
