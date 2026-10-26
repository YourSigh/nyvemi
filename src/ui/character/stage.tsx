import { useState } from 'react';
import { View } from 'react-native';
import { usePalette } from '../../theme/context';
import { MockCharacter } from './mock';
export function CharacterStage({ name, height }: { name: string; height: number }) {
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
      <MockCharacter palette={palette} width={(artHeight * 240) / 340} height={artHeight} />
    </View>
  );
}
