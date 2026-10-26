import type { MeshAvatar } from '../../avatar/model';
import { MeshAvatarStage } from './mesh';
import type { MotionCommand } from '../../character/motion-scheduler';
import type { CharacterRig } from '../../appearance/model';
import { RigCharacter } from './rig';
import { Pressable, Text, Animated, View } from 'react-native';
import type { CharacterInteractionState } from '../../character/interaction';
import { useState } from 'react';
import { useCharacterTheme } from './theme';
import { useCharacterMotion } from './motion';
import { MockCharacter } from './mock';
function LegacyCharacterStage({
  name,
  height,
  state = 'idle',
  intensity = 0.5,
  command,
  rig,
  forceEyesClosed = false,
}: {
  rig?: CharacterRig;
  forceEyesClosed?: boolean;
  name: string;
  height: number;
  state?: CharacterInteractionState;
  intensity?: number;
  command?: MotionCommand;
}) {
  const motion = useCharacterMotion(state, intensity, command);
  const theme = useCharacterTheme();
  const [width, setWidth] = useState(360);
  const artHeight = Math.max(
    0,
    Math.min(height - 12, width * 1.03, rig ? (width * rig.height) / rig.width : 420),
  );
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
          backgroundColor: theme.characterGlow,
          opacity: 0.28,
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}在这里，点按挥手`}
        onPress={() => motion.play('wave')}
      >
        <Animated.View style={motion.style}>
          {rig ? (
            <RigCharacter
              rig={rig}
              width={(artHeight * rig.width) / rig.height}
              height={artHeight}
              eyesClosed={motion.eyesClosed || forceEyesClosed}
              mouthOpen={motion.mouthOpen}
              state={state}
              headStyle={motion.headStyle}
              armStyle={motion.armStyle}
            />
          ) : (
            <MockCharacter
              theme={theme}
              width={(artHeight * 240) / 340}
              height={artHeight}
              eyesClosed={motion.eyesClosed || forceEyesClosed}
              mouthOpen={motion.mouthOpen}
              state={state}
              headStyle={motion.headStyle}
              armStyle={motion.armStyle}
            />
          )}
        </Animated.View>
      </Pressable>
      {state === 'thinking' || state === 'talking' || state === 'listening' ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ position: 'absolute', bottom: 2, fontSize: 11, color: theme.textSecondary }}
        >
          {state === 'thinking' ? '想一想…' : state === 'talking' ? '正在说…' : '听你说'}
        </Text>
      ) : null}
    </View>
  );
}

export function CharacterStage(
  props: Parameters<typeof LegacyCharacterStage>[0] & {
    meshAvatar?: MeshAvatar;
    onMeshReady?: (ready: boolean) => void;
  },
) {
  return props.meshAvatar ? (
    <MeshAvatarStage
      model={props.meshAvatar}
      onReady={props.onMeshReady}
      height={props.height}
      state={props.state ?? 'idle'}
      intensity={props.intensity ?? 0.5}
      eyesClosed={props.forceEyesClosed}
    />
  ) : (
    <LegacyCharacterStage {...props} />
  );
}
