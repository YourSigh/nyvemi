import Svg, { Circle, Path } from 'react-native-svg';

type IconName =
  | 'settings'
  | 'plus'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-right'
  | 'arrow-left';

const iconPaths: Record<Exclude<IconName, 'settings'>, string> = {
  plus: 'M12 5v14M5 12h14',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-up': 'm6 15 6-6 6 6',
  'chevron-right': 'm9 6 6 6-6 6',
  'arrow-left': 'M19 12H5m7-7-7 7 7 7',
};

export function Icon({ name, color, size = 20 }: { name: IconName; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
      {name === 'settings' ? (
        <>
          <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={1.7} />
          <Path
            d="M19.4 13.5a7.9 7.9 0 0 0 0-3l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.6A8 8 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5a7.9 7.9 0 0 0 0 3l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.5Z"
            stroke={color}
            strokeWidth={1.7}
            strokeLinejoin="round"
          />
        </>
      ) : (
        <Path
          d={iconPaths[name]}
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </Svg>
  );
}
