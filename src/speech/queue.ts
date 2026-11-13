import type { Message } from '../domain/models';
import { qwenSpeaker, type VoiceOptions } from './preferences';
export interface SpeechDriver {
  play(id: string, text: string, options: VoiceOptions): Promise<boolean>;
  stop(): Promise<void>;
  prepare?(id: string, text: string, options: VoiceOptions): Promise<boolean> | undefined;
  release?(): Promise<void>;
}
function speechParts(content: string, options: VoiceOptions): string[] {
  const text = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*#_`]/g, '')
    .trim();
  const limit = qwenSpeaker(options) ? 180 : 1000;
  const characters = Array.from(text);
  const parts: string[] = [];
  for (let start = 0; start < characters.length; ) {
    const cap = Math.min(start + limit, characters.length);
    let end = cap;
    if (cap < characters.length) {
      while (end > start + limit / 2 && !/[。！？；.!?;\s]/u.test(characters[end - 1])) end--;
      if (end <= start + limit / 2) end = cap;
    }
    parts.push(characters.slice(start, end).join('').trim());
    start = end;
  }
  return parts;
}

export class SpeechQueue {
  private seen = new Set<string>();
  private primed = false;
  private pending: { message: Message; options: VoiceOptions }[] = [];
  private draining = false;
  private drained?: Promise<void>;
  private epoch = 0;
  private blocked = false;
  private signature = '';
  private receivedSince: number;
  private stopping?: Promise<void>;
  constructor(
    private driver: SpeechDriver,
    private state: (value: { messageId?: string; error?: string }) => void = () => {},
    private now = () => Date.now(),
  ) {
    this.receivedSince = now();
  }
  observe(messages: Message[], options: VoiceOptions) {
    const signature = JSON.stringify(options);
    if (signature !== this.signature) {
      if (!options.enabled && (this.draining || this.pending.length)) this.stop(true);
      this.blocked = false;
      this.signature = signature;
      this.state({});
    }
    const initial = !this.primed;
    this.primed = true;
    for (const message of [...messages].sort((a, b) => a.createdAt - b.createdAt)) {
      if (
        message.role !== 'assistant' ||
        message.status !== 'complete' ||
        message.voiceSettings ||
        this.seen.has(message.id)
      )
        continue;
      this.seen.add(message.id);
      if (
        !options.enabled ||
        this.blocked ||
        (initial
          ? message.createdAt <= this.receivedSince
          : message.createdAt < this.receivedSince) ||
        !message.content.trim()
      )
        continue;
      this.pending.push({ message, options });
    }
    this.startDrain();
  }
  prepare(id: string, content: string, options: VoiceOptions) {
    if (!options.enabled || this.blocked || !this.driver.prepare) return undefined;
    const [text] = speechParts(content, options);
    const prepared = text ? this.driver.prepare(`${id}:0`, text, options) : undefined;
    const previous = this.drained;
    return prepared && previous
      ? prepared.then(async (ready) => {
          if (ready) await previous;
          return ready;
        })
      : prepared;
  }
  replay(message: Message, options: VoiceOptions) {
    if (
      !options.enabled ||
      message.role !== 'assistant' ||
      message.status !== 'complete' ||
      !message.content.trim()
    )
      return;
    this.seen.add(message.id);
    this.stop();
    this.blocked = false;
    this.pending.push({ message, options });
    this.startDrain();
  }
  reset() {
    this.stop();
    this.seen.clear();
    this.primed = false;
    this.resume();
  }
  resume() {
    this.receivedSince = this.now();
    this.unblock();
  }
  unblock() {
    if (this.blocked) {
      this.blocked = false;
      this.state({});
    }
  }
  stop(release = false) {
    this.epoch++;
    this.pending = [];
    this.stopping = (
      release && this.driver.release ? this.driver.release() : this.driver.stop()
    ).catch(() => {});
    this.state(this.blocked ? { error: '本机声音尚未就绪' } : {});
  }
  private startDrain() {
    if (this.draining || this.blocked || !this.pending.length) return;
    this.drained = this.drain();
  }
  private async drain() {
    this.draining = true;
    try {
      while (this.pending.length && !this.blocked) {
        const item = this.pending.shift()!,
          epoch = this.epoch;
        if (this.stopping) await this.stopping;
        if (epoch !== this.epoch) continue;
        this.state({ messageId: item.message.id });
        try {
          for (const [index, text] of speechParts(item.message.content, item.options).entries()) {
            if (epoch !== this.epoch) break;
            const completed = await this.driver.play(
              `${item.message.id}:${index}`,
              text,
              item.options,
            );
            if (!completed) break;
          }
          if (epoch === this.epoch) this.state({});
        } catch {
          if (epoch === this.epoch) {
            this.blocked = true;
            this.pending = [];
            this.state({ error: '本机声音尚未就绪' });
          }
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
