import { it, expect, vi } from 'vitest';
import { SpeechQueue } from '../src/speech/queue';
import { voiceProfile } from '../src/characters/hatching';
import type { Message } from '../src/domain/models';
const msg = (id: string, content = '嗨'): Message => ({
  id,
  characterId: 'c',
  role: 'assistant',
  content,
  createdAt: 100,
  status: 'complete',
  origin: 'chat',
});
it('does not read old history, reads new complete messages once and ignores silent turns', async () => {
  const driver = {
    play: vi.fn(async (_id: string, _text: string, _options: unknown) => true),
    stop: vi.fn(async () => {}),
  };
  const queue = new SpeechQueue(
    driver,
    () => {},
    () => 100,
  );
  queue.observe([msg('old')], voiceProfile());
  expect(driver.play).not.toHaveBeenCalled();
  queue.observe([msg('old'), msg('new'), msg('empty', '')], voiceProfile());
  queue.observe([msg('new')], voiceProfile());
  await vi.waitFor(() => expect(driver.play).toHaveBeenCalledOnce());
  expect(driver.play.mock.calls[0][1]).toBe('嗨');
});
it('speaks the first egg question and serializes separate bubbles', async () => {
  let done: (value: boolean) => void = () => {};
  const driver = {
    play: vi
      .fn<(...args: unknown[]) => Promise<boolean>>()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            done = r;
          }),
      )
      .mockResolvedValue(true),
    stop: vi.fn(async () => {}),
  };
  const queue = new SpeechQueue(
    driver,
    () => {},
    () => 100,
  );
  queue.observe([msg('hello'), msg('color', '你喜欢什么颜色？')], voiceProfile(), true);
  expect(driver.play).toHaveBeenCalledOnce();
  done(true);
  await vi.waitFor(() => expect(driver.play).toHaveBeenCalledTimes(2));
});
it('stops queued speech on interruption and never voices pending/error or disabled messages', async () => {
  const driver = {
    play: vi.fn(async (_id: string, _text: string, _options: unknown) => true),
    stop: vi.fn(async () => {}),
  };
  const queue = new SpeechQueue(
    driver,
    () => {},
    () => 100,
  );
  queue.observe(
    [{ ...msg('pending'), status: 'pending' }, { ...msg('error'), status: 'error' }, msg('muted')],
    { ...voiceProfile(), enabled: false },
    true,
  );
  expect(driver.play).not.toHaveBeenCalled();
  queue.stop();
  expect(driver.stop).toHaveBeenCalledOnce();
});
it('reports unavailable local voices once without retrying every queued bubble', async () => {
  const driver = {
    play: vi.fn(async () => {
      throw Error('no offline voice');
    }),
    stop: vi.fn(async () => {}),
  };
  const state = vi.fn();
  const queue = new SpeechQueue(driver, state, () => 100);
  queue.observe([msg('1'), msg('2')], voiceProfile(), true);
  await vi.waitFor(() => expect(state).toHaveBeenLastCalledWith({ error: '本机声音尚未就绪' }));
  queue.observe([msg('3')], voiceProfile());
  expect(driver.play).toHaveBeenCalledOnce();
});
