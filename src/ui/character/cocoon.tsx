import type { CharacterInteractionState } from '../../character/interaction';
import { useState } from 'react';
import { Animated, Image, Pressable, View } from 'react-native';
import { initialCharacterSize } from '../../character/layout';
import { useCocoonMotion } from './cocoon-motion';
const artwork = require('../../../assets/characters/moon-cocoon-v2.png');
const orbit = [
  [-0.45, 0],
  [0, -0.42],
  [0.45, 0],
  [0, 0.42],
];
/** A painted light-being with independent light effects; existing user rigs remain untouched. */
export function CocoonCharacter({
  height,
  glow,
  light = '#C9B7E9',
  animated = true,
  state = 'idle',
}: {
  height: number;
  glow: string;
  light?: string;
  animated?: boolean;
  state?: CharacterInteractionState;
}) {
  const [width, setWidth] = useState(360);
  const motion = useCocoonMotion(animated, state);
  const size = initialCharacterSize(height, width);
  const ring = Math.max(0, Math.min(height - 4, width - 8, size + 12));
  const engaged = motion.flash || motion.soothing || state === 'thinking' || state === 'talking';
  return (
    <View
      testID="moon-cocoon"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height, width: '100%', alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: ring,
          height: ring,
          borderRadius: ring,
          backgroundColor: glow,
          opacity: motion.moving
            ? motion.breath.interpolate({
                inputRange: [0, 1],
                outputRange: engaged ? [0.3, 0.6] : [0.12, 0.3],
              })
            : engaged
              ? 0.5
              : 0.18,
          transform: [
            {
              scale: motion.moving
                ? motion.breath.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] })
                : 1,
            },
          ],
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="月胚之茧，轻触泛起月光，长按轻轻安抚"
        accessibilityHint="只与初生角色互动，不会发送聊天消息"
        disabled={!motion.active}
        delayLongPress={450}
        onPress={motion.tap}
        onLongPress={motion.soothe}
        onPressOut={motion.release}
      >
        <Animated.View
          style={{
            transform: [
              {
                translateY: motion.moving
                  ? motion.breath.interpolate({ inputRange: [0, 1], outputRange: [1, -3] })
                  : 0,
              },
              {
                translateY: motion.moving
                  ? motion.reaction.interpolate({
                      inputRange: [0, 0.25, 1],
                      outputRange: [0, -5, 0],
                    })
                  : 0,
              },
              {
                scale: motion.moving
                  ? motion.reaction.interpolate({
                      inputRange: [0, 0.25, 1],
                      outputRange: [1, 1.018, 1],
                    })
                  : 1,
              },
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
      {motion.moving ? (
        <>
          <Animated.View
            testID="cocoon-touch-ripple"
            pointerEvents="none"
            style={{
              position: 'absolute',
              width: ring,
              height: ring,
              borderRadius: ring,
              borderWidth: 1.5,
              borderColor: light,
              opacity: motion.reaction.interpolate({
                inputRange: [0, 0.2, 1],
                outputRange: [0, 0.65, 0],
              }),
              transform: [
                {
                  scale: motion.reaction.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.55, 1],
                  }),
                },
              ],
            }}
          />
          {[0, 1, 2].map((n) => (
            <Animated.View
              key={n}
              pointerEvents="none"
              style={{
                position: 'absolute',
                width: n === 1 ? 3 : 4,
                height: n === 1 ? 3 : 4,
                borderRadius: 4,
                backgroundColor: light,
                opacity: motion.breath.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.25, 0.8],
                }),
                transform: [
                  {
                    translateX: motion.stream.interpolate({
                      inputRange: [0, 0.25, 0.5, 0.75, 1],
                      outputRange: [0, 1, 2, 3, 4].map((k) => orbit[(k + n) % 4][0] * size),
                    }),
                  },
                  {
                    translateY: motion.stream.interpolate({
                      inputRange: [0, 0.25, 0.5, 0.75, 1],
                      outputRange: [0, 1, 2, 3, 4].map((k) => orbit[(k + n) % 4][1] * size),
                    }),
                  },
                ],
              }}
            />
          ))}
        </>
      ) : null}
    </View>
  );
}
