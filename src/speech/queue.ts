import type { Message, Settings } from '../domain/models';
export type VoiceOptions = NonNullable<Settings['voice']>;
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
  constructor(
    private driver: SpeechDriver,
    private state: (value: { messageId?: string; error?: string }) => void = () => {},
    private now = () => Date.now(),
  ) {}
  observe(messages: Message[], options: VoiceOptions | undefined, opening = false) {
    const signature = JSON.stringify(options);
    if (signature !== this.signature) {
      this.blocked = false;
      this.signature = signature;
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
        !options?.enabled ||
        this.blocked ||
        (initial && !opening) ||
        this.now() - message.createdAt > 30000 ||
        !message.content.trim()
      )
        continue;
      this.pending.push({ message, options });
    }
    void this.drain();
  }
  replay(message: Message, options: VoiceOptions) {
    this.stop();
    this.blocked = false;
    this.pending.push({ message, options: { ...options, enabled: true } });
    void this.drain();
  }
  reset() {
    this.stop();
    this.seen.clear();
    this.primed = false;
    this.blocked = false;
  }
  resume() {
    this.blocked = false;
  }
  stop() {
    this.epoch++;
    this.pending = [];
    void this.driver.stop().catch(() => {});
    this.state({});
  }
  private async drain() {
    if (this.draining || this.blocked) return;
    this.draining = true;
    try {
      while (this.pending.length && !this.blocked) {
        const item = this.pending.shift()!,
          epoch = this.epoch;
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
