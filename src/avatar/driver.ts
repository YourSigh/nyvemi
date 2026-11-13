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
const ease = (progress: number) => {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t);
};

const speechShapes: ReadonlyArray<readonly [time: number, openness: number]> = [
  [0, 0],
  [0.09, 0.24],
  [0.2, 0.04],
  [0.32, 0.36],
  [0.48, 0.07],
  [0.63, 0.2],
  [0.8, 0],
  [1, 0],
  [1.09, 0.17],
  [1.22, 0.07],
  [1.37, 0.29],
  [1.57, 0],
  [1.86, 0],
];

function speechOpenness(elapsed: number) {
  const t = elapsed % 1.86;
  for (let i = 1; i < speechShapes.length; i++) {
    const [end, target] = speechShapes[i];
    if (t <= end) {
      const [start, value] = speechShapes[i - 1];
      return value + (target - value) * ease((t - start) / (end - start));
    }
  }
  return 0;
}

const blinkDuration = 0.27;

function lidOpenness(elapsed: number) {
  const closeAt = 0.09;
  const reopenAt = 0.13;
  return elapsed < closeAt
    ? 1 - ease(elapsed / closeAt)
    : ease((elapsed - reopenAt) / (blinkDuration - reopenAt));
}

export function pose(
  state: CharacterInteractionState,
  time: number,
  intensity = 0.5,
  reducedMotion = false,
  stateTime = time,
) {
  const sway = reducedMotion ? 0 : Math.sin(time * 0.57),
    drift = reducedMotion ? 0 : Math.sin(time * 0.33);
  const happy = state === 'happy' || state === 'excited',
    sleepy = state === 'sleepy',
    shy = state === 'shy',
    thinking = state === 'thinking',
    sad = state === 'sad',
    angry = state === 'angry';
  const expression = 0.55 + 0.45 * intensity;
  const lookAway = ease(stateTime / 0.35) * (1 - 0.4 * ease((stateTime - 1.1) / 0.9));
  return {
    headX: thinking ? -1.8 + drift * 0.4 : drift * 0.8,
    headY: thinking ? 0.8 : shy || sad ? -1.2 : sleepy ? -1.1 : sway * 0.5,
    headZ: thinking ? -0.6 : shy ? 0.5 : sleepy ? 0.5 : sway * 0.35,
    eyeX: (thinking ? -0.28 : shy ? 0.2 : 0) * lookAway + drift * 0.05,
    eyeY: (thinking ? 0.16 : shy || sad ? -0.22 : sleepy ? -0.12 : 0) * lookAway,
    eyeOpen: sleepy
      ? 0.28 - 0.19 * ease((stateTime - 0.5) / 0.9)
      : happy
        ? 0.93
        : sad || angry
          ? 0.92
          : 1,
    mouth:
      state === 'talking' ? speechOpenness(stateTime) : state === 'excited' ? 0.11 * expression : 0,
    smile: (happy ? 0.86 : shy ? 0.24 : angry || sad ? -0.36 : 0) * expression,
    browL: (thinking ? 0.32 : happy ? 0.23 : angry ? -0.3 : 0) * expression,
    browR: (thinking ? 0.1 : happy ? 0.23 : angry ? -0.3 : 0) * expression,
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
      return {
        leftEye: 1 - ease((time - 0.12) / 0.14) * (1 - ease((time - 0.55) / 0.24)),
        smile: 0.42 * ease(time / 0.23) * (1 - ease((time - 0.7) / 0.45)),
      };
    case 'smile':
      return { smile: 0.62 * ease(time / 0.28) * (1 - ease((time - 1.3) / 0.9)) };
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
        smile: 0.38 * ease(time / 0.32) * (1 - ease((time - 1.7) / 0.9)),
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
      return { headY: -2, headZ: Math.sin(time * 3) * 1.5, smile: 0.44, eyeOpen: 0.88 };
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
    stateTime = 0,
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
        return movable('ParamArmRA') && movable('ParamArmRB');
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
      if (next.state && next.state !== input.state) stateTime = 0;
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
      stateTime += step;
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
      const canBlink = !input.eyesClosed && input.state !== 'sleepy' && action?.kind !== 'wink';
      blinkRemaining = canBlink ? Math.max(0, blinkRemaining - step) : 0;
      if (elapsed >= blinkAt) {
        if (canBlink) blinkRemaining = blinkDuration;
        blinkAt = elapsed + 2 + random() * 4;
      }
      const p: ReturnType<typeof pose> & {
        leftEye?: number;
        armLA?: number;
        armLB?: number;
        armRA?: number;
        armRB?: number;
      } = pose(input.state, elapsed, input.intensity, input.reducedMotion, stateTime);
      if (action) Object.assign(p, actionPose(action.kind, action.time));
      if (input.motionProfile !== 'interactive') {
        if (action?.kind === 'wave') {
          const progress = action.time / actionSeconds.wave;
          const envelope = Math.min(1, progress * 6, (1 - progress) * 6);
          p.armRA = 18 * envelope;
          p.armRB = (24 + Math.sin(action.time * 10) * 9) * envelope;
        }
        p.headX = Math.max(-3, Math.min(3, p.headX));
        p.headY = Math.max(-2, Math.min(2, p.headY));
        p.headZ = Math.max(-1.2, Math.min(1.2, p.headZ));
        p.body = Math.max(-0.5, Math.min(0.5, p.body));
      }
      if (pointer.down) {
        p.headX = pointer.x * (input.motionProfile === 'interactive' ? 20 : 2.5);
        p.headY = pointer.y * (input.motionProfile === 'interactive' ? 10 : 1.5);
        p.eyeX = pointer.x * (input.motionProfile === 'interactive' ? 0.8 : 0.36);
        p.eyeY = pointer.y * (input.motionProfile === 'interactive' ? 0.6 : 0.28);
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
      const blink = blinkRemaining > 0 ? lidOpenness(blinkDuration - blinkRemaining) : 1;
      const openness = input.eyesClosed ? 0 : p.eyeOpen * blink;
      const leftOpenness = input.eyesClosed ? 0 : (p.leftEye ?? p.eyeOpen) * blink;
      set(['ParamAngleX'], p.headX, alpha);
      set(['ParamAngleY'], p.headY, alpha);
      set(['ParamAngleZ'], p.headZ, alpha);
      set(['ParamEyeBallX'], p.eyeX, alpha);
      set(['ParamEyeBallY'], p.eyeY, alpha);
      set(['ParamEyeLOpen'], leftOpenness, blinkRemaining > 0 || input.eyesClosed ? 1 : alpha);
      set(['ParamEyeROpen'], openness, blinkRemaining > 0 || input.eyesClosed ? 1 : alpha);
      set(['ParamBrowLY'], (byId.get('ParamBrowLY')?.default ?? 0) + p.browL, alpha);
      set(['ParamBrowRY'], (byId.get('ParamBrowRY')?.default ?? 0) + p.browR, alpha);
      set(['ParamMouthOpenY', 'ParamMouthOpen'], p.mouth, 1 - Math.exp(-step * 22));
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
