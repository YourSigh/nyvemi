import type { CharacterInteractionState } from '../character/interaction';
export interface AvatarParameter {
  id: string;
  min: number;
  max: number;
  default: number;
}
export interface MeshPlayer {
  parameterRanges(): AvatarParameter[];
  setParameter(id: string, value: number): void;
  behaviors(flags: number): void;
  update(dt: number): void;
  draw(): void;
}
export interface AvatarInput {
  state: CharacterInteractionState;
  intensity: number;
  active: boolean;
  reducedMotion: boolean;
  eyesClosed?: boolean;
}
export const defaultAvatarInput: AvatarInput = {
  state: 'idle',
  intensity: 0.5,
  active: true,
  reducedMotion: false,
};
export function pose(
  state: CharacterInteractionState,
  time: number,
  intensity = 0.5,
  reducedMotion = false,
) {
  const sway = reducedMotion ? 0 : Math.sin(time * 0.57),
    drift = reducedMotion ? 0 : Math.sin(time * 0.33);
  const happy = state === 'happy' || state === 'excited',
    sleepy = state === 'sleepy',
    shy = state === 'shy';
  return {
    headX: state === 'thinking' ? -7 + drift * 2 : drift * 4,
    headY: state === 'thinking' ? 3 : shy ? -6 : sleepy ? -5 : sway * 1.8,
    headZ: state === 'thinking' ? -5 : shy ? 4 : sleepy ? 3 : sway * 1.5,
    eyeX: state === 'thinking' ? -0.35 : shy ? -0.15 : drift * 0.12,
    eyeY: state === 'thinking' ? 0.25 : shy ? -0.35 : sleepy ? -0.2 : sway * 0.07,
    eyeOpen: sleepy ? 0.18 : happy ? 0.78 : 1,
    mouth: state === 'talking' ? 0.12 + 0.62 * Math.pow(Math.sin(time * 9.3), 2) : happy ? 0.22 : 0,
    smile: happy ? 0.85 : shy ? 0.35 : state === 'angry' ? -0.55 : 0.05,
    body: reducedMotion ? 0 : sway * (happy ? 2 : 1) * (0.6 + intensity * 0.4),
  };
}
export type AvatarAction = 'pat' | 'poke' | 'eat' | 'wave' | 'stretch' | 'lookAround';
export const actionSeconds: Record<AvatarAction, number> = {
  pat: 1.8,
  poke: 1.2,
  eat: 8,
  wave: 2.6,
  stretch: 3.2,
  lookAround: 2.8,
};
export function actionPose(action: AvatarAction, time: number) {
  const cycle = Math.sin(time * 12),
    chew = (1 + Math.sin(time * 17)) / 2;
  switch (action) {
    case 'eat':
      return {
        headY: -3 + Math.sin(time * 12) * 3,
        headZ: Math.sin(time * 8) * 2,
        mouth: 0.08 + chew * 0.6,
        smile: 0.8,
        eyeOpen: 0.68,
        armLA: 25 + Math.max(0, cycle) * 15,
        armLB: 70 + Math.max(0, cycle) * 30,
        armRA: -90,
        armRB: -100,
        body: Math.sin(time * 8) * 1.5,
      };
    case 'wave':
      return {
        headZ: 4,
        smile: 0.8,
        eyeOpen: 0.8,
        armRA: -95,
        armRB: -45 + Math.sin(time * 12) * 22,
      };
    case 'stretch':
      return {
        headY: 6,
        eyeOpen: 0.25,
        mouth: 0.18,
        armLA: 95,
        armLB: 12,
        armRA: -95,
        armRB: -12,
        body: Math.sin(time * 2) * 2,
      };
    case 'pat':
      return { headY: -3, headZ: Math.sin(time * 7) * 4, smile: 0.85, eyeOpen: 0.25 };
    case 'poke':
      return { headX: Math.sin(time * 14) * 8, eyeOpen: 1, mouth: 0.3, smile: -0.2 };
    case 'lookAround':
      return { headX: Math.sin(time * 2.8) * 15, eyeX: Math.sin(time * 2.8) * 0.65 };
  }
}
export function createDriver(player: MeshPlayer, random: () => number = Math.random) {
  const parameters = player.parameterRanges();
  const byId = new Map(parameters.map((p) => [p.id, p]));
  let input: AvatarInput = { ...defaultAvatarInput },
    elapsed = 0,
    blinkAt = 2 + random() * 3,
    blinkRemaining = 0;
  const current = new Map<string, number>();
  let lastActive = false;
  let action: { kind: AvatarAction; time: number } | undefined;
  let nextIdleAction = 12 + random() * 12;
  let pointer = { x: 0, y: 0, down: false };
  const supports = (kind: AvatarAction) =>
    kind === 'eat'
      ? ['ParamArmLA', 'ParamArmLB', 'ParamArmRA', 'ParamArmRB'].every((id) => byId.has(id))
      : kind === 'wave'
        ? byId.has('ParamArmRA')
        : kind === 'stretch'
          ? byId.has('ParamArmLA') && byId.has('ParamArmRA')
          : true;
  const play = (kind: AvatarAction) => {
    if (!supports(kind) || !input.active || input.state === 'thinking' || input.state === 'talking')
      return false;
    action = { kind, time: 0 };
    return true;
  };
  // Hair/clothing parameters deliberately stay untouched: p2lrt evaluates their pendulum physics.
  const set = (ids: string[], value: number, alpha: number) => {
    for (const id of ids) {
      const range = byId.get(id);
      if (!range) continue;
      const target = Math.max(range.min, Math.min(range.max, value));
      const prev = current.get(id) ?? range.default;
      const next = prev + (target - prev) * alpha;
      current.set(id, next);
      player.setParameter(id, next);
    }
  };
  player.behaviors(2); // Runtime breathing only; host owns blink and state-specific gaze/mouth.
  return {
    setInput(next: Partial<AvatarInput>) {
      input = { ...input, ...next };
      if (next.active === false) {
        action = undefined;
        pointer.down = false;
      }
      input.intensity = Math.max(0, Math.min(1, input.intensity));
    },
    play,
    supports,
    cancelAction() {
      action = undefined;
      nextIdleAction = elapsed + 12 + random() * 12;
    },
    point(x: number, y: number, down: boolean) {
      pointer = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), down };
    },
    action() {
      return action ? { kind: action.kind, time: action.time } : undefined;
    },
    step(dt: number) {
      if (!input.active) {
        lastActive = false;
        return;
      }
      const step = Math.max(0, Math.min(0.05, dt));
      elapsed += step;
      if (action) {
        action.time += step;
        if (action.time >= actionSeconds[action.kind]) {
          action = undefined;
          nextIdleAction = elapsed + 12 + random() * 12;
        }
      }
      if (!action && input.state === 'idle' && !input.reducedMotion && elapsed >= nextIdleAction) {
        play(random() < 0.5 ? 'lookAround' : 'stretch');
        nextIdleAction = elapsed + 18 + random() * 12;
      }
      if (input.state === 'thinking' || input.state === 'talking') action = undefined;
      blinkRemaining = Math.max(0, blinkRemaining - step);
      if (elapsed >= blinkAt) {
        blinkRemaining = 0.14;
        blinkAt = elapsed + 2 + random() * 4;
      }
      const p: ReturnType<typeof pose> & {
        armLA?: number;
        armLB?: number;
        armRA?: number;
        armRB?: number;
      } = pose(input.state, elapsed, input.intensity, input.reducedMotion);
      if (action) Object.assign(p, actionPose(action.kind, action.time));
      if (pointer.down) {
        p.headX = pointer.x * 20;
        p.headY = pointer.y * 10;
        p.eyeX = pointer.x * 0.8;
        p.eyeY = pointer.y * 0.6;
        p.headZ = -pointer.x * 5;
      }
      if (input.reducedMotion) {
        p.headX = 0;
        p.headY = 0;
        p.headZ = 0;
        p.body = 0;
      }
      const alpha = lastActive ? 1 - Math.exp(-step * 9) : 1;
      lastActive = true;
      const shut = input.eyesClosed || blinkRemaining > 0;
      set(['ParamAngleX'], p.headX, alpha);
      set(['ParamAngleY'], p.headY, alpha);
      set(['ParamAngleZ'], p.headZ, alpha);
      set(['ParamEyeBallX'], p.eyeX, alpha);
      set(['ParamEyeBallY'], p.eyeY, alpha);
      set(['ParamEyeLOpen', 'ParamEyeROpen'], shut ? 0 : p.eyeOpen, shut ? 1 : alpha);
      set(['ParamMouthOpenY', 'ParamMouthOpen'], p.mouth, Math.min(1, step * 18));
      set(['ParamMouthForm', 'ParamMouthSmile'], p.smile, alpha);
      set(['ParamBodyAngleZ', 'ParamBodyAngle'], p.body, alpha);
      set(['ParamArmLA'], p.armLA ?? 0, alpha);
      set(['ParamArmLB'], p.armLB ?? 0, alpha);
      set(['ParamArmRA'], p.armRA ?? 0, alpha);
      set(['ParamArmRB'], p.armRB ?? 0, alpha);
      player.update(step);
      player.draw();
    },
    reset() {
      action = undefined;
      pointer.down = false;
      current.clear();
      lastActive = false;
    },
    parameters,
  };
}
