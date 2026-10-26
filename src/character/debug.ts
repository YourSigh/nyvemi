import type { CharacterInteractionState } from './interaction';
import type { CharacterMotion, MotionCommand } from './motion-scheduler';
export interface CharacterDebugSnapshot {
  state: CharacterInteractionState;
  command?: MotionCommand;
  expiresAt: number;
}
/** Session-only renderer controls. Never written to persona, memory, export or model prompts. */
export class CharacterDebugController {
  private states = new Map<string, CharacterDebugSnapshot>();
  private listeners = new Set<() => void>();
  private sequence = 0;
  constructor(private clock: () => number = Date.now) {}
  read(id: string, enabled: boolean) {
    const value = this.states.get(id);
    return enabled && value && value.expiresAt > this.clock() ? value : undefined;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  setState(id: string, state: CharacterInteractionState) {
    this.states.set(id, { state, expiresAt: this.clock() + 60000 });
    this.notify();
  }
  play(id: string, name: CharacterMotion) {
    const current = this.read(id, true);
    this.states.set(id, {
      state: current?.state ?? 'idle',
      command: { id: ++this.sequence, name },
      expiresAt: this.clock() + 60000,
    });
    this.notify();
  }
  clear(id: string) {
    this.states.delete(id);
    this.notify();
  }
  private notify() {
    for (const listener of this.listeners) listener();
  }
}
