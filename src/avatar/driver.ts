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
  motionProfile?: 'gentle' | 'interactive';
}
export const defaultAvatarInput: AvatarInput = {
  state: 'idle',
  intensity: 0.5,
  active: true,
  reducedMotion: false,
  motionProfile: 'gentle',
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
    headX: state === 'thinking' ? -1.8 + drift * 0.4 : drift * 1.1,
    headY: state === 'thinking' ? 0.8 : shy ? -1.2 : sleepy ? -1.1 : sway * 0.5,
    headZ: state === 'thinking' ? -0.6 : shy ? 0.5 : sleepy ? 0.5 : sway * 0.35,
    eyeX: state === 'thinking' ? -0.35 : shy ? -0.15 : drift * 0.12,
    eyeY: state === 'thinking' ? 0.25 : shy ? -0.35 : sleepy ? -0.2 : sway * 0.07,
    eyeOpen: sleepy ? 0.18 : happy ? 0.78 : 1,
    mouth: state === 'talking' ? 0.04 + 0.4 * Math.pow(Math.sin(time * 7.8), 2) : happy ? 0.08 : 0,
    smile: happy ? 0.5 : shy ? 0.25 : state === 'angry' ? -0.55 : 0.05,
    body: reducedMotion ? 0 : sway * (happy ? 0.3 : 0.2) * (0.6 + intensity * 0.4),
  };
}
export type AvatarAction =
  | 'pat'
  | 'poke'
  | 'eat'
  | 'wave'
  | 'stretch'
  | 'lookAround'
  | 'nod'
  | 'shake'
  | 'wink'
  | 'smile';
export const actionSeconds: Record<AvatarAction, number> = {
  pat: 1.8,
  poke: 1.2,
  eat: 8,
  wave: 2.6,
  stretch: 3.2,
  lookAround: 2.8,
  nod: 1.7,
  shake: 1.8,
  wink: 1.2,
  smile: 2.2,
};
export function actionPose(action: AvatarAction, time: number) {
  const cycle = Math.sin(time * 12),
    chew = (1 + Math.sin(time * 17)) / 2;
  switch (action) {
    case 'nod':
      return { headY: -Math.sin(Math.min(1, time / 1.7) * Math.PI * 2) * 1.4 };
    case 'shake':
      return { headX: Math.sin(Math.min(1, time / 1.8) * Math.PI * 4) * 2 };
    case 'wink':
      return { leftEye: 1 - Math.sin(Math.min(1, time / 1.2) * Math.PI) ** 2, smile: 0.4 };
    case 'smile':
      return { smile: 0.05 + Math.sin(Math.min(1, time / 2.2) * Math.PI) * 0.45, eyeOpen: 0.85 };
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
  const movable = (...ids: string[]) =>
    ids.some((id) => {
      const p = byId.get(id);
      return !!p && p.max - p.min > 0.05;
    });
  const supports = (kind: AvatarAction): boolean => {
    switch (kind) {
      case 'nod':
        return movable('ParamAngleY');
      case 'shake':
        return movable('ParamAngleX');
      case 'wink':
        return movable('ParamEyeLOpen') && movable('ParamEyeROpen');
      case 'smile':
        return movable('ParamMouthForm', 'ParamMouthSmile');
      case 'pat':
        return movable('ParamAngleY', 'ParamMouthForm', 'ParamEyeLOpen');
      case 'poke':
        return movable('ParamAngleX', 'ParamMouthOpenY', 'ParamMouthOpen');
      case 'lookAround':
        return movable('ParamAngleX', 'ParamEyeBallX');
      case 'eat':
        return (
          input.motionProfile === 'interactive' &&
          ['ParamArmLA', 'ParamArmLB', 'ParamArmRA', 'ParamArmRB'].every((id) => movable(id))
        );
      case 'wave':
        return (
          input.motionProfile === 'interactive' && movable('ParamArmRA') && movable('ParamArmRB')
        );
      case 'stretch':
        return (
          input.motionProfile === 'interactive' && movable('ParamArmLA') && movable('ParamArmRA')
        );
      default:
        return false;
    }
  };
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
      if (action && !supports(action.kind)) action = undefined;
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
        play('lookAround');
        nextIdleAction = elapsed + 18 + random() * 12;
      }
      if (input.state === 'thinking' || input.state === 'talking') action = undefined;
      blinkRemaining = Math.max(0, blinkRemaining - step);
      if (elapsed >= blinkAt) {
        blinkRemaining = 0.2;
        blinkAt = elapsed + 2 + random() * 4;
      }
      const p: ReturnType<typeof pose> & {
        leftEye?: number;
        armLA?: number;
        armLB?: number;
        armRA?: number;
        armRB?: number;
      } = pose(input.state, elapsed, input.intensity, input.reducedMotion);
      if (action) Object.assign(p, actionPose(action.kind, action.time));
      if (input.motionProfile !== 'interactive') {
        p.headX = Math.max(-3, Math.min(3, p.headX));
        p.headY = Math.max(-2, Math.min(2, p.headY));
        p.headZ = Math.max(-1.2, Math.min(1.2, p.headZ));
        p.body = Math.max(-0.5, Math.min(0.5, p.body));
      }
      if (pointer.down) {
        p.headX = pointer.x * (input.motionProfile === 'interactive' ? 20 : 2.5);
        p.headY = pointer.y * (input.motionProfile === 'interactive' ? 10 : 1.5);
        p.eyeX = pointer.x * 0.8;
        p.eyeY = pointer.y * 0.6;
        p.headZ = -pointer.x * (input.motionProfile === 'interactive' ? 5 : 0.7);
      }
      if (input.reducedMotion) {
        p.headX = 0;
        p.headY = 0;
        p.headZ = 0;
        p.body = 0;
      }
      const alpha = lastActive ? 1 - Math.exp(-step * 9) : 1;
      lastActive = true;
      const blink = blinkRemaining > 0 ? Math.sin((1 - blinkRemaining / 0.2) * Math.PI) : 0;
      const openness = input.eyesClosed ? 0 : p.eyeOpen * (1 - blink);
      const leftOpenness = input.eyesClosed ? 0 : (p.leftEye ?? p.eyeOpen) * (1 - blink);
      set(['ParamAngleX'], p.headX, alpha);
      set(['ParamAngleY'], p.headY, alpha);
      set(['ParamAngleZ'], p.headZ, alpha);
      set(['ParamEyeBallX'], p.eyeX, alpha);
      set(['ParamEyeBallY'], p.eyeY, alpha);
      set(['ParamEyeLOpen'], leftOpenness, blinkRemaining > 0 || input.eyesClosed ? 1 : alpha);
      set(['ParamEyeROpen'], openness, blinkRemaining > 0 || input.eyesClosed ? 1 : alpha);
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
