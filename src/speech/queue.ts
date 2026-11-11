import type { Message } from '../domain/models';
import type { VoiceOptions } from './preferences';
export interface SpeechDriver {
  play(id: string, text: string, options: VoiceOptions): Promise<boolean>;
  stop(): Promise<void>;
}
export class SpeechQueue {
  private seen = new Set<string>();
  private primed = false;
  private pending: { message: Message; options: VoiceOptions }[] = [];
  private draining = false;
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
      if (!options.enabled && (this.draining || this.pending.length)) this.stop();
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
        this.seen.has(message.id)
      )
        continue;
      this.seen.add(message.id);
      if (
        !options.enabled ||
        this.blocked ||
        initial ||
        message.createdAt < this.receivedSince ||
        this.now() - message.createdAt > 30000 ||
        !message.content.trim()
      )
        continue;
      this.pending.push({ message, options });
    }
    void this.drain();
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
    void this.drain();
  }
  reset() {
    this.stop();
    this.seen.clear();
    this.primed = false;
    this.resume();
  }
  resume() {
    this.receivedSince = this.now();
    this.blocked = false;
  }
  stop() {
    this.epoch++;
    this.pending = [];
    this.stopping = this.driver.stop().catch(() => {});
    this.state(this.blocked ? { error: '本机声音尚未就绪' } : {});
  }
  private async drain() {
    if (this.draining || this.blocked) return;
    this.draining = true;
    try {
      while (this.pending.length && !this.blocked) {
        const item = this.pending.shift()!,
          epoch = this.epoch;
        if (this.stopping) await this.stopping;
        if (epoch !== this.epoch) continue;
        this.state({ messageId: item.message.id });
        try {
          const text = item.message.content
            .replace(/```[\s\S]*?```/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/[*#_`]/g, '')
            .trim();
          for (let offset = 0; offset < text.length; offset += 1000) {
            if (epoch !== this.epoch) break;
            const completed = await this.driver.play(
              `${item.message.id}:${offset}`,
              text.slice(offset, offset + 1000),
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
