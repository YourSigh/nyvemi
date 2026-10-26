export class CharacterMotionScheduler {
  private blinkAt?: number;
  constructor(private random: () => number = Math.random) {}
  start(now: number) {
    this.blinkAt = now + 2000 + Math.max(0, Math.min(1, this.random())) * 4000;
  }
  stop() {
    this.blinkAt = undefined;
  }
  nextAt() {
    return this.blinkAt;
  }
  tick(now: number): 'blink' | undefined {
    if (this.blinkAt === undefined || now < this.blinkAt) return;
    this.start(now);
    return 'blink';
  }
}
