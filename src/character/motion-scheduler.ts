import type { CharacterInteractionState } from './interaction';
export const characterMotions = [
  'blink',
  'thinkingTilt',
  'talking',
  'happyBounce',
  'angryShake',
  'shy',
  'sleepy',
  'wave',
  'lookAround',
  'smallTilt',
] as const;
export type CharacterMotion = (typeof characterMotions)[number];
export interface MotionCommand {
  id: number;
  name: CharacterMotion;
  intensity?: number;
}
export class CharacterMotionScheduler {
  private blinkAt?: number;
  private gestureAt?: number;
  private occupiedUntil = 0;
  constructor(private random: () => number = Math.random) {}
  start(now: number) {
    const sample = Math.max(0, Math.min(1, this.random()));
    this.blinkAt = now + 2000 + sample * 4000;
    this.gestureAt ??= now + 18000 + sample * 17000;
  }
  stop() {
    this.blinkAt = this.gestureAt = undefined;
    this.occupiedUntil = 0;
  }
  occupy(now: number, duration: number) {
    this.occupiedUntil = now + duration;
  }
  nextAt() {
    return this.blinkAt === undefined
      ? undefined
      : Math.max(this.occupiedUntil, Math.min(this.blinkAt, this.gestureAt ?? Infinity));
  }
  tick(now: number, state: CharacterInteractionState = 'idle'): CharacterMotion | undefined {
    if (this.blinkAt === undefined || now < this.occupiedUntil) return;
    if (this.blinkAt <= now) {
      this.start(now);
      this.occupy(now, 150);
      return 'blink';
    }
    if (this.gestureAt !== undefined && this.gestureAt <= now) {
      this.gestureAt = now + 18000 + this.random() * 17000;
      if (state !== 'idle') return;
      this.occupy(now, 1200);
      return this.random() < 0.5 ? 'smallTilt' : 'lookAround';
    }
  }
}
