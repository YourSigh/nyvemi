import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Image, Pressable, View } from 'react-native';
import { useCharacterTheme } from './theme';
import type { CharacterInteractionState } from '../../character/interaction';
const artwork = require('../../../assets/characters/egg-expressions.png');
export function LegacyEggCharacter({
  height,
  state = 'idle',
  progress = 0,
}: {
  height: number;
  state?: CharacterInteractionState;
  progress?: number;
}) {
  const theme = useCharacterTheme(),
    breath = useRef(new Animated.Value(0)).current,
    touch = useRef(new Animated.Value(0)).current;
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [blinking, setBlinking] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(false);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) =>
      setActive(next === 'active'),
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 1900, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 1900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      touch.stopAnimation();
    };
  }, [active, breath, touch]);
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    const blink = () => {
      setBlinking(true);
      timer = setTimeout(() => {
        setBlinking(false);
        timer = setTimeout(blink, 3000 + Math.random() * 1600);
      }, 160);
    };
    timer = setTimeout(blink, 2800);
    return () => clearTimeout(timer);
  }, [active]);
  useEffect(() => {
    if (!active || state !== 'talking') return;
    const timer = setInterval(() => setMouthOpen((open) => !open), 320);
    return () => clearInterval(timer);
  }, [active, state]);
  // Each atlas cell contains a complete painted expression. No SVG face is painted on top.
  const frame =
    state === 'sleepy' || (active && blinking)
      ? 1
      : state === 'thinking'
        ? 3
        : active && state === 'talking' && mouthOpen
          ? 2
          : 0;
  const size = Math.max(1, Math.min(height - 12, 240));
  return (
    <View testID="egg-character" style={{ height, alignItems: 'center', justifyContent: 'center' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="轻轻碰一下这颗蛋"
        onPress={() => {
          touch.stopAnimation();
          Animated.sequence([
            Animated.timing(touch, { toValue: 1, duration: 90, useNativeDriver: true }),
            Animated.timing(touch, { toValue: -1, duration: 160, useNativeDriver: true }),
            Animated.timing(touch, { toValue: 0, duration: 180, useNativeDriver: true }),
          ]).start();
        }}
      >
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: size * 0.15,
            top: size * 0.18,
            width: size * 0.7,
            height: size * 0.7,
            borderRadius: size,
            backgroundColor: theme.characterGlow,
            opacity: 0.12 + Math.max(0, Math.min(1, progress)) * 0.1,
          }}
        />
        <Animated.View
          style={{
            width: size,
            height: size,
            overflow: 'hidden',
            transform: [
              { translateY: breath.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) },
              {
                rotate: touch.interpolate({ inputRange: [-1, 1], outputRange: ['-5deg', '5deg'] }),
              },
            ],
          }}
        >
          <Image
            source={artwork}
            accessible={false}
            resizeMode="stretch"
            fadeDuration={0}
            style={{
              position: 'absolute',
              width: size * 2,
              height: size * 2,
              left: -(frame % 2) * size,
              top: -Math.floor(frame / 2) * size,
            }}
          />
        </Animated.View>
      </Pressable>
    </View>
  );
}
