import type { Message } from '../domain/models';
import type { Storage } from '../storage/store';
// Deliberately narrow: only direct requests to send the user a message after a relative delay.
// Merely mentioning a meeting, or quoting a request, must not arm a notification.
export function requestedDelay(text: string): number | undefined {
  const input = text.trim();
  if (/[“”「」"?？]/.test(input) || /不要|别发|不用|取消|如果|假如|能不能|可以吗/.test(input))
    return;
  const match =
    /^(?:请你?|你|那你|那|帮我)?\s*([\d]+|[一二两三四五六七八九十半]+)\s*(秒钟?|分钟|小时)(?:以)?后\s*(.{1,100})$/.exec(
      input,
    );
  if (!match || !/(?:发|给|找|联系|聊)/.test(match[3]) || !/(?:消息|来信|聊|联系我)/.test(match[3]))
    return;
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    半: 0.5,
  };
  const raw = match[1];
  let amount = Number(raw);
  if (!Number.isFinite(amount)) {
    const parts = raw.split('十');
    amount =
      parts.length === 2
        ? (parts[0] ? digits[parts[0]] : 1) * 10 + (parts[1] ? digits[parts[1]] : 0)
        : digits[raw];
  }
  const delay = amount * (match[2].startsWith('秒') ? 1000 : match[2] === '分钟' ? 60000 : 3600000);
  return Number.isFinite(delay) && delay >= 10000 && delay <= 86400000 ? delay : undefined;
}

export async function queueRequestedMessage(
  store: Storage,
  user: Message,
  delayMs: number,
  ensureDelivery: () => Promise<void>,
  now = Date.now(),
): Promise<string> {
  if (!Number.isFinite(delayMs) || delayMs < 10000 || delayMs > 86400000)
    throw new Error('暂时支持 10 秒至 24 小时后的来信');
  const taskId = `requested:${user.id}`;
  const existing = await store.get('intentions', taskId);
  if (existing && existing.status !== 'pending')
    throw new Error('这条来信任务已结束，请重新发送请求');
  const pending = (await store.list('intentions', user.characterId, 10000)).filter(
    (i) => i.type === 'requested' && i.status === 'pending' && i.latestAt > now,
  );
  if (!existing && pending.length >= 3) throw new Error('已经约好三次来信了，等她聊完再约吧');
  await ensureDelivery();
  const dueAt = existing?.earliestAt ?? now + delayMs;
  if (!existing)
    await store.put('intentions', {
      id: taskId,
      characterId: user.characterId,
      type: 'requested',
      sourceMessageId: user.id,
      topic: user.content,
      earliestAt: dueAt,
      latestAt: dueAt + 3600000,
      importance: 1,
      reason: '用户明确要求稍后来信',
      status: 'pending',
      createdAt: now,
    });
  const due = new Date(dueAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `好，记下了。大约 ${due} 再来找你聊。`;
}
