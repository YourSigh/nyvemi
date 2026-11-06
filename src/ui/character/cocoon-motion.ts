import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing } from 'react-native';
import type { CharacterInteractionState } from '../../character/interaction';
/** Native-driver effects only. No chat messages, model calls or character-data changes. */
export function useCocoonMotion(animated: boolean, state: CharacterInteractionState) {
  const breath = useRef(new Animated.Value(0)).current;
  const stream = useRef(new Animated.Value(0)).current;
  const reaction = useRef(new Animated.Value(0)).current;
  const response = useRef<Animated.CompositeAnimation | undefined>(undefined);
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [reducedMotion, setReducedMotion] = useState(true);
  const [flash, setFlash] = useState(false);
  const [soothing, setSoothing] = useState(false);
  const moving = animated && active && !reducedMotion;
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (live) setReducedMotion(value);
      })
      .catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    const life = AppState.addEventListener('change', (next) => setActive(next === 'active'));
    return () => {
      live = false;
      motion.remove();
      life.remove();
    };
  }, []);
  useEffect(() => {
    if (!moving) return;
    const duration = soothing || state === 'sleepy' ? 3100 : 2300;
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration,
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    );
    const flowing = Animated.loop(
      Animated.timing(stream, {
        toValue: 1,
        duration: state === 'thinking' ? 5200 : 8500,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      }),
    );
    breathing.start();
    flowing.start();
    return () => {
      breathing.stop();
      flowing.stop();
    };
  }, [moving, soothing, state, breath, stream]);
  useEffect(() => {
    if (!moving) {
      response.current?.stop();
      reaction.setValue(0);
    }
  }, [moving, reaction]);
  useEffect(() => {
    if (!active) {
      response.current?.stop();
      clearTimeout(reset.current);
      setFlash(false);
      setSoothing(false);
    }
  }, [active]);
  useEffect(
    () => () => {
      response.current?.stop();
      clearTimeout(reset.current);
    },
    [],
  );
  const tap = useCallback(() => {
    if (!active) return;
    clearTimeout(reset.current);
    setFlash(true);
    reset.current = setTimeout(() => setFlash(false), 800);
    response.current?.stop();
    reaction.setValue(0);
    if (moving) {
      response.current = Animated.timing(reaction, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
        isInteraction: false,
      });
      response.current.start();
    }
  }, [active, moving, reaction]);
  const soothe = useCallback(() => {
    if (active) {
      setSoothing(true);
      tap();
    }
  }, [active, tap]);
  return {
    breath,
    stream,
    reaction,
    moving,
    active,
    flash,
    soothing,
    tap,
    soothe,
    release: () => setSoothing(false),
  };
}
