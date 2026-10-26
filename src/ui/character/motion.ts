import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '../../theme/context';
import type { CharacterInteractionState } from '../../character/interaction';
import { CharacterMotionScheduler } from '../../character/motion-scheduler';
export function useCharacterMotion(state: CharacterInteractionState = 'idle', intensity = 0.5) {
  const { reducedMotion } = useTheme();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [eyesClosed, setEyesClosed] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(false);
  const breath = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!focused || !foreground || reducedMotion) {
      breath.setValue(0);
      setEyesClosed(false);
      return;
    }
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 2700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    breathing.start();
    const scheduler = new CharacterMotionScheduler();
    scheduler.start(Date.now());
    let timer: ReturnType<typeof setTimeout>;
    let reopen: ReturnType<typeof setTimeout>;
    const plan = () => {
      timer = setTimeout(
        () => {
          if (scheduler.tick(Date.now()) === 'blink') {
            setEyesClosed(true);
            reopen = setTimeout(() => setEyesClosed(false), 120);
          }
          plan();
        },
        Math.max(1, (scheduler.nextAt() ?? Date.now() + 4000) - Date.now()),
      );
    };
    plan();
    return () => {
      breathing.stop();
      scheduler.stop();
      clearTimeout(timer);
      clearTimeout(reopen);
      breath.setValue(0);
    };
  }, [focused, foreground, reducedMotion, breath]);
  useEffect(() => {
    if (state !== 'talking' || reducedMotion || !focused || !foreground) {
      setMouthOpen(false);
      return;
    }
    const timer = setInterval(() => setMouthOpen((v) => !v), 180);
    return () => clearInterval(timer);
  }, [state, reducedMotion, focused, foreground]);
  return {
    eyesClosed,
    mouthOpen,
    style: {
      transform: [
        {
          translateY: breath.interpolate({
            inputRange: [0, 1],
            outputRange: [
              0,
              state === 'listening' || state === 'thinking' ? -0.6 : -1.5 * (0.8 + intensity * 0.2),
            ],
          }),
        },
        { scaleY: breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.006] }) },
      ],
    },
  };
}
