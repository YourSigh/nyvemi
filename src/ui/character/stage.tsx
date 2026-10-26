import type { CharacterInteractionState } from '../../character/interaction';
import { Text } from 'react-native';
import { useState } from 'react';
import { Animated, View } from 'react-native';
import { usePalette } from '../../theme/context';
import { useCharacterMotion } from './motion';
import { MockCharacter } from './mock';
export function CharacterStage({
  name,
  height,
  state = 'idle',
  intensity = 0.5,
}: {
  name: string;
  height: number;
  state?: CharacterInteractionState;
  intensity?: number;
}) {
  const motion = useCharacterMotion(state, intensity);
  const palette = usePalette();
  const [width, setWidth] = useState(360);
  const artHeight = Math.max(0, Math.min(height - 12, width * 1.03, 420));
  return (
    <View
      testID="character-stage"
      accessible
      accessibilityLabel={`${name}在这里`}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        height,
        alignItems: 'center',
        justifyContent: 'flex-end',
        overflow: 'hidden',
        paddingBottom: 4,
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: width * 0.74,
          height: height * 0.78,
          bottom: 5,
          borderRadius: 1000,
          backgroundColor: palette.tint,
          opacity: 0.28,
        }}
      />
      <Animated.View style={motion.style}>
        <MockCharacter
          palette={palette}
          width={(artHeight * 240) / 340}
          height={artHeight}
          eyesClosed={motion.eyesClosed}
          mouthOpen={motion.mouthOpen}
        />
      </Animated.View>
      {state === 'thinking' || state === 'talking' || state === 'listening' ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ position: 'absolute', bottom: 2, fontSize: 11, color: palette.muted }}
        >
          {state === 'thinking' ? '想一想…' : state === 'talking' ? '正在说…' : '听你说'}
        </Text>
      ) : null}
    </View>
  );
}
