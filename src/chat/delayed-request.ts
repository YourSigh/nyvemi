import type { Intention, Message } from '../domain/models';
import type { Storage } from '../storage/store';
// Relative, direct requests only. Polite questions are requests too; narration is not.
export function requestedDelay(text: string): number | undefined {
  const input = text
    .trim()
    .replace(
      /^(?:(?:芜湖|好呀|好啊|好吧|好的|好嘞|哈哈|诶|嗯|行|那行|嘿嘿|试一下|我们试试|我想测一下)[，,！!。\s]+)+/,
      '',
    );
  if (
    /[“”「」"]/.test(text) ||
    /不要|别发|别来|别联系|别提醒|别找|不用|取消|如果|假如|比如|假设|他说|她说|我说过/.test(text)
  )
    return;
  const match =
    /^(?:(?:请|麻烦|那|好)[，,\s]*)?(?:(?:你|帮我|能不能|可不可以|可以|能)[，,\s]*)*(过|等|在)?\s*(\d+(?:\.\d+)?|[一二两三四五六七八九十半]+)\s*(秒钟?|分钟|个?小时|分)(?:(?:以|之)?后|再)?\s*(.{1,100})$/.exec(
      input,
    );
  if (!match) return;
  const tail = match[4];
  // Without 后/再, only 过/等 introduces a future duration (e.g. 过一分钟来找我).
  const durationEnd = input.indexOf(match[3]) + match[3].length;
  if (!match[1] && !/^(?:以后|之后|后|再)/.test(input.slice(durationEnd).trim())) return;
  if (/^(?:我|给你|找你)/.test(tail)) return;
  if (!/(?:发|说|讲|聊|找我|联系我|提醒我|叫我)/.test(tail)) return;
  if (!/(?:消息|信息|来信|一句|句话|一段|聊天|聊聊|说话|找我|联系我|提醒我|叫我)/.test(tail))
    return;
  if (!/(?:给我|找我|跟我|和我|联系我|提醒我|叫我|说|讲|聊)/.test(tail)) return;
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
  const raw = match[2];
  let amount = Number(raw);
  if (!Number.isFinite(amount)) {
    const parts = raw.split('十');
    amount =
      parts.length === 2
        ? (parts[0] ? digits[parts[0]] : 1) * 10 + (parts[1] ? digits[parts[1]] : 0)
        : digits[raw];
  }
  const delay =
    amount * (match[3].startsWith('秒') ? 1000 : match[3].startsWith('分') ? 60000 : 3600000);
  return Number.isFinite(delay) && delay >= 10000 && delay <= 86400000 ? delay : undefined;
}

export async function queueRequestedMessage(
  store: Storage,
  user: Message,
  delayMs: number,
  ensureDelivery: (intention: Intention) => Promise<void>,
  now?: number,
): Promise<string> {
  if (!Number.isFinite(delayMs) || delayMs < 10000 || delayMs > 86400000)
    throw new Error('暂时支持 10 秒至 24 小时后的来信');
  const startedAt = now ?? Date.now();
  const taskId = `requested:${user.id}`;
  const existing = await store.get('intentions', taskId);
  if (existing && existing.status !== 'pending')
    throw new Error('这条来信任务已结束，请重新发送请求');
  const pending = (await store.list('intentions', user.characterId, 10000)).filter(
    (i) => i.type === 'requested' && i.status === 'pending' && i.latestAt > startedAt,
  );
  if (!existing && pending.length >= 3) throw new Error('已经约好三次来信了，等她聊完再约吧');
  const armedAt = now ?? Date.now();
  const dueAt = existing?.requestedDueAt ?? existing?.earliestAt ?? armedAt + delayMs;
  const intention: Intention = existing ?? {
    id: taskId,
    characterId: user.characterId,
    type: 'requested',
    sourceMessageId: user.id,
    topic: user.content,
    earliestAt: dueAt,
    requestedDueAt: dueAt,
    latestAt: dueAt + 3600000,
    importance: 1,
    reason: '用户明确要求稍后来信',
    status: 'pending',
    createdAt: armedAt,
  };
  if (!existing) await store.put('intentions', intention);
  try {
    await ensureDelivery(intention);
  } catch (error) {
    // Never leave a newly failed registration looking like a confirmed promise.
    if (!existing) await store.remove('intentions', taskId);
    throw error;
  }
  const due = new Date(dueAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `好，记下了。大约 ${due} 再来找你聊。`;
}
