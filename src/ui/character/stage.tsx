import type { MotionCommand } from '../../character/motion-scheduler';
import { Pressable } from 'react-native';
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
  command,
}: {
  name: string;
  height: number;
  state?: CharacterInteractionState;
  intensity?: number;
  command?: MotionCommand;
}) {
  const motion = useCharacterMotion(state, intensity, command);
  const palette = usePalette();
  const [width, setWidth] = useState(360);
  const artHeight = Math.max(0, Math.min(height - 12, width * 1.03, 420));
  return (
    <View
      testID="character-stage"
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}在这里，点按挥手`}
        onPress={() => motion.play('wave')}
      >
        <Animated.View style={motion.style}>
          <MockCharacter
            palette={palette}
            width={(artHeight * 240) / 340}
            height={artHeight}
            eyesClosed={motion.eyesClosed}
            mouthOpen={motion.mouthOpen}
            state={state}
            headStyle={motion.headStyle}
            armStyle={motion.armStyle}
          />
        </Animated.View>
      </Pressable>
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
