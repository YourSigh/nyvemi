import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '../../theme/context';
import type { CharacterInteractionState } from '../../character/interaction';
import {
  CharacterMotionScheduler,
  type CharacterMotion,
  type MotionCommand,
} from '../../character/motion-scheduler';
const timing = (value: Animated.Value, toValue: number, duration: number) =>
  Animated.timing(value, {
    toValue,
    duration,
    easing: Easing.inOut(Easing.sin),
    useNativeDriver: true,
  });
export function useCharacterMotion(
  state: CharacterInteractionState = 'idle',
  intensity = 0.5,
  command?: MotionCommand,
) {
  const { reducedMotion } = useTheme();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [eyesClosed, setEyesClosed] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(false);
  const breath = useRef(new Animated.Value(0)).current;
  const bounce = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const pose = useRef(new Animated.Value(0)).current;
  const gesture = useRef(new Animated.Value(0)).current;
  const arm = useRef(new Animated.Value(0)).current;
  const scheduler = useRef(new CharacterMotionScheduler()).current;
  const active = focused && foreground && !reducedMotion;
  const activeRef = useRef(active);
  activeRef.current = active;
  const stateRef = useRef(state);
  stateRef.current = state;
  const reopen = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const action = useRef<Animated.CompositeAnimation | undefined>(undefined);
  const play = useCallback(
    (name: CharacterMotion, strength = 0.5) => {
      if (!activeRef.current) return;
      const amount = 0.35 + Math.max(0, Math.min(1, strength)) * 0.65;
      if (name === 'blink') {
        clearTimeout(reopen.current);
        setEyesClosed(true);
        reopen.current = setTimeout(() => setEyesClosed(false), 120);
        return;
      }
      action.current?.stop();
      bounce.setValue(0);
      shake.setValue(0);
      gesture.setValue(0);
      arm.setValue(0);
      let animation: Animated.CompositeAnimation;
      let duration = 800;
      if (name === 'happyBounce') {
        duration = 450;
        animation = Animated.sequence([timing(bounce, -4 * amount, 180), timing(bounce, 0, 270)]);
      } else if (name === 'angryShake') {
        duration = 300;
        animation = Animated.sequence([
          timing(shake, -2.5 * amount, 75),
          timing(shake, 2.5 * amount, 75),
          timing(shake, -1.5 * amount, 75),
          timing(shake, 0, 75),
        ]);
      } else if (name === 'wave') {
        duration = 850;
        animation = Animated.sequence([
          timing(arm, -28, 220),
          timing(arm, -12, 160),
          timing(arm, -25, 190),
          timing(arm, 0, 280),
        ]);
      } else {
        const angle =
          name === 'shy' || name === 'sleepy'
            ? -3
            : name === 'thinkingTilt'
              ? 4
              : name === 'lookAround'
                ? -2
                : 1.5;
        animation = Animated.sequence([
          timing(gesture, angle * amount, 400),
          timing(gesture, 0, 400),
        ]);
      }
      scheduler.occupy(Date.now(), duration);
      action.current = animation;
      animation.start();
    },
    [arm, bounce, gesture, scheduler, shake],
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!active) {
      setEyesClosed(false);
      setMouthOpen(false);
      return;
    }
    const breathing = Animated.loop(
      Animated.sequence([timing(breath, 1, 2400), timing(breath, 0, 2700)]),
    );
    breathing.start();
    scheduler.start(Date.now());
    let timer: ReturnType<typeof setTimeout>;
    const plan = () => {
      timer = setTimeout(
        () => {
          const next = scheduler.tick(Date.now(), stateRef.current);
          if (next) play(next);
          plan();
        },
        Math.max(1, (scheduler.nextAt() ?? Date.now() + 4000) - Date.now()),
      );
    };
    plan();
    return () => {
      breathing.stop();
      scheduler.stop();
      action.current?.stop();
      clearTimeout(timer);
      clearTimeout(reopen.current);
      for (const value of [breath, bounce, shake, gesture, arm]) {
        value.stopAnimation();
        value.setValue(0);
      }
    };
  }, [active, arm, bounce, breath, gesture, play, scheduler, shake]);
  useEffect(() => {
    if (!active) {
      pose.setValue(0);
      return;
    }
    gesture.stopAnimation();
    gesture.setValue(0);
    const target =
      state === 'thinking'
        ? 4
        : state === 'listening'
          ? 1
          : state === 'shy'
            ? -4
            : state === 'sad' || state === 'sleepy'
              ? -2.5
              : 0;
    const animation =
      state === 'thinking'
        ? Animated.loop(Animated.sequence([timing(pose, target, 1400), timing(pose, 2.5, 1700)]))
        : timing(pose, target, 400);
    animation.start();
    if (state === 'thinking') play('blink');
    if (state === 'happy' || state === 'excited')
      play('happyBounce', state === 'excited' ? intensity : intensity * 0.6);
    if (state === 'angry') play('angryShake', intensity);
    return () => animation.stop();
  }, [state, active, gesture, intensity, play, pose]);
  useEffect(() => {
    if (state !== 'talking' || !active) {
      setMouthOpen(false);
      return;
    }
    const timer = setInterval(() => setMouthOpen((v) => !v), 180);
    return () => clearInterval(timer);
  }, [state, active]);
  useEffect(() => {
    if (command) play(command.name, command.intensity);
  }, [command, play]);
  return {
    eyesClosed,
    mouthOpen,
    play,
    style: {
      transform: [
        {
          translateY: Animated.add(
            bounce,
            breath.interpolate({
              inputRange: [0, 1],
              outputRange: [0, state === 'idle' ? -1.5 : -0.6],
            }),
          ),
        },
        { translateX: shake },
        { scaleY: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.006] }) },
      ],
    },
    headStyle: {
      transform: [
        {
          rotate: Animated.add(pose, gesture).interpolate({
            inputRange: [-10, 10],
            outputRange: ['-10deg', '10deg'],
          }),
        },
        { translateY: state === 'listening' || state === 'sad' ? 1 : 0 },
      ],
    },
    armStyle: {
      transform: [
        { rotate: arm.interpolate({ inputRange: [-45, 45], outputRange: ['-45deg', '45deg'] }) },
      ],
    },
  };
}
