import { useEffect, useRef } from 'react';
import { Animated, Pressable, View } from 'react-native';
import Svg, { Path, Ellipse, Circle } from 'react-native-svg';
import { useCharacterTheme } from './theme';
import type { CharacterInteractionState } from '../../character/interaction';
export function EggCharacter({
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
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 1900, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0, duration: 1900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath]);
  const size = Math.min(height - 12, 210);
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
        <Animated.View
          style={{
            transform: [
              { translateY: breath.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) },
              {
                rotate: touch.interpolate({ inputRange: [-1, 1], outputRange: ['-7deg', '7deg'] }),
              },
            ],
          }}
        >
          <Svg width={size} height={size} viewBox="0 0 240 260">
            <Ellipse cx="120" cy="244" rx="66" ry="9" fill={theme.characterGlow} opacity={0.5} />
            <Path
              d="M120 17C80 17 34 111 34 166c0 48 32 73 86 73s86-25 86-73C206 111 160 17 120 17Z"
              fill={theme.surface}
              stroke={theme.primarySoft}
              strokeWidth="4"
            />
            <Path
              d="M47 183c22-10 45 11 73 5 29-6 51-16 75-6-9 31-35 46-75 46-39 0-65-14-73-45Z"
              fill={theme.primarySoft}
              opacity={0.65}
            />
            <Path
              d="M87 56c-18 22-30 49-33 73"
              fill="none"
              stroke={theme.characterHighlight}
              strokeWidth="9"
              strokeLinecap="round"
            />
            {state === 'sleepy' ? (
              <Path
                d="M87 149h12m42 0h12"
                stroke={theme.textSecondary}
                strokeWidth="3"
                strokeLinecap="round"
              />
            ) : (
              <>
                <Ellipse cx="93" cy="148" rx="3.5" ry="5" fill={theme.textSecondary} />
                <Ellipse cx="147" cy="148" rx="3.5" ry="5" fill={theme.textSecondary} />
              </>
            )}
            <Ellipse
              cx="120"
              cy="163"
              rx={state === 'talking' ? 5 : 4}
              ry={state === 'talking' ? 7 : 2}
              fill={theme.primary}
            />
            <Circle cx="78" cy="160" r="7" fill={theme.primarySoft} />
            <Circle cx="162" cy="160" r="7" fill={theme.primarySoft} />
            {progress > 0.5 ? (
              <Path
                d="m111 19 11 16-10 13 17 13-7 15"
                fill="none"
                stroke={theme.primarySoft}
                strokeWidth="3"
                strokeLinecap="round"
              />
            ) : null}
            <Circle cx="85" cy="205" r="6" fill={theme.primary} opacity={0.18} />
            <Circle cx="148" cy="214" r="9" fill={theme.primary} opacity={0.12} />
          </Svg>
        </Animated.View>
      </Pressable>
    </View>
  );
}
