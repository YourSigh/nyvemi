import type { CharacterInteractionState } from '../../character/interaction';
import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Image, Pressable, View } from 'react-native';
const artwork = require('../../../assets/characters/moon-cocoon.png');
/** A painted nascent spirit; user-generated character rigs are not changed by this preview. */
export function CocoonCharacter({
  height,
  glow,
  animated = true,
  state = 'idle',
}: {
  height: number;
  glow: string;
  animated?: boolean;
  state?: CharacterInteractionState;
}) {
  const float = useRef(new Animated.Value(0)).current;
  const touch = useRef(new Animated.Value(0)).current;
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => setActive(next === 'active'));
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!animated || !active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2600, useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      touch.stopAnimation();
    };
  }, [active, animated, float, touch]);
  const size = Math.max(1, height - 8);
  return (
    <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: size * 0.84,
          height: size * 0.84,
          backgroundColor: glow,
          opacity: state === 'thinking' || state === 'talking' ? 0.46 : 0.28,
          borderRadius: size,
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="轻触月胚之茧"
        onPress={() => {
          touch.stopAnimation();
          Animated.sequence([
            Animated.timing(touch, { toValue: 1, duration: 180, useNativeDriver: true }),
            Animated.timing(touch, { toValue: 0, duration: 700, useNativeDriver: true }),
          ]).start();
        }}
      >
        <Animated.View
          style={{
            transform: [
              { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [2, -4] }) },
              { scale: touch.interpolate({ inputRange: [0, 1], outputRange: [1, 1.018] }) },
            ],
          }}
        >
          <Image
            source={artwork}
            accessible={false}
            resizeMode="contain"
            fadeDuration={0}
            style={{ width: size, height: size }}
          />
        </Animated.View>
      </Pressable>
    </View>
  );
}
