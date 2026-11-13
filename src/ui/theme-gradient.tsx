import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { Palette } from '../theme/model';

export function ThemeGradient({ stops }: { stops: Palette['backgroundGradient'] }) {
  if (!stops) return null;
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      width="100%"
      height="100%"
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Defs>
        <LinearGradient id="page-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset={0} stopColor={stops[0]} />
          <Stop offset={1} stopColor={stops[1]} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#page-gradient)" />
    </Svg>
  );
}
