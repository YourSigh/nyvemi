export type VoicePhase = 'idle' | 'starting' | 'holding' | 'canceling' | 'processing';
export interface HoldPorts {
  start(id: string): Promise<void>;
  finish(id: string, cancel: boolean): Promise<string | null>;
  abort(id: string): Promise<void>;
  state(phase: VoicePhase): void;
  text(text: string): void;
  error(message: string): void;
  now(): number;
}
interface Session {
  id: string;
  y: number;
  down: boolean;
  canceled: boolean;
  started: boolean;
  finishing: boolean;
  at: number;
  timer?: ReturnType<typeof setTimeout>;
}
/** Late native results cannot send after a canceled/replaced gesture. */
export class VoiceHold {
  private current?: Session;
  private sequence = 0;
  constructor(private ports: HoldPorts) {}
  async begin(y: number) {
    if (this.current) return;
    const s: Session = {
      id: `voice-${this.ports.now()}-${++this.sequence}`,
      y,
      down: true,
      canceled: false,
      started: false,
      finishing: false,
      at: this.ports.now(),
    };
    this.current = s;
    this.ports.state('starting');
    try {
      await this.ports.start(s.id);
      if (this.current !== s) {
        await this.ports.abort(s.id);
        return;
      }
      s.started = true;
      if (!s.down) {
        void this.finish(s);
        return;
      }
      this.ports.state(s.canceled ? 'canceling' : 'holding');
      s.timer = setTimeout(() => this.release(), 60_000);
    } catch (e) {
      if (this.current !== s) return;
      this.current = undefined;
      this.ports.state('idle');
      if (!s.canceled) this.ports.error(e instanceof Error ? e.message : '无法开始语音输入');
    }
  }
  move(y: number) {
    const s = this.current;
    if (!s || !s.down || s.finishing) return;
    s.canceled = s.y - y > 56;
    this.ports.state(s.canceled ? 'canceling' : s.started ? 'holding' : 'starting');
  }
  release() {
    const s = this.current;
    if (!s || s.finishing) return;
    s.down = false;
    if (this.ports.now() - s.at < 300) s.canceled = true;
    if (s.canceled) {
      this.cancel();
      return;
    }
    if (s.started) void this.finish(s);
  }
  private async finish(s: Session) {
    if (this.current !== s || s.finishing) return;
    s.finishing = true;
    clearTimeout(s.timer);
    this.ports.state('processing');
    try {
      const text = await this.ports.finish(s.id, false);
      if (this.current !== s || s.canceled) return;
      this.current = undefined;
      this.ports.state('idle');
      if (text?.trim()) this.ports.text(text.trim().slice(0, 6000));
      else this.ports.error('没有听清，请再说一次');
    } catch (e) {
      if (this.current !== s) return;
      this.current = undefined;
      this.ports.state('idle');
      if (!s.canceled) this.ports.error(e instanceof Error ? e.message : '语音识别失败，请重试');
    }
  }
  partial(id: string, text: string): string | undefined {
    return this.current?.id === id && !this.current.canceled ? text.slice(0, 6000) : undefined;
  }
  cancel() {
    const s = this.current;
    if (!s) return;
    s.canceled = true;
    clearTimeout(s.timer);
    this.current = undefined;
    this.ports.state('idle');
    void this.ports.abort(s.id).catch(() => {});
  }
}
