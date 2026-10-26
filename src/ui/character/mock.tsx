import { Animated, View, type ViewProps } from 'react-native';
import type { CharacterInteractionState } from '../../character/interaction';
import Svg, { Ellipse, Path, Circle } from 'react-native-svg';
import type { CharacterTheme } from '../../character/theme';
/** Original vector stand-in; replace this renderer with a rigged asset without changing chat. */
export function MockCharacter({
  theme,
  width,
  height,
  eyesClosed = false,
  mouthOpen = false,
  state = 'idle',
  headStyle,
  armStyle,
}: {
  theme: CharacterTheme;
  width: number;
  height: number;
  eyesClosed?: boolean;
  mouthOpen?: boolean;
  state?: CharacterInteractionState;
  headStyle?: Animated.AnimatedProps<ViewProps>['style'];
  armStyle?: Animated.AnimatedProps<ViewProps>['style'];
}) {
  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height} viewBox="0 0 240 340">
        <Ellipse cx="120" cy="327" rx="53" ry="7" fill={theme.primary} opacity="0.09" />
        <Path
          d="M62 92Q45 142 51 210Q64 218 82 200L159 200Q180 219 191 207Q198 145 179 91Z"
          fill={theme.primary}
        />
        <Path
          d="M98 278L97 315Q106 321 116 314L119 282M126 282L128 315Q139 321 148 314L144 278"
          fill={theme.surface}
          stroke={theme.border}
          strokeWidth="2"
        />
        <Path
          d="M96 309Q108 312 117 308L118 321Q107 328 91 321Z M127 309Q138 313 149 308L154 321Q138 328 127 321Z"
          fill={theme.primary}
        />
        <Path
          d="M92 170Q76 172 66 194L53 238Q57 247 67 245L83 215L79 278Q120 292 162 278L157 195Q151 178 149 170Z"
          fill={theme.primarySoft}
          stroke={theme.border}
          strokeWidth="2"
        />
        <Path d="M95 169Q120 192 146 169L147 191Q120 209 92 190Z" fill={theme.surface} />
        <Path
          d="M96 188L96 220M145 188L145 220"
          stroke={theme.primary}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <Circle cx="96" cy="221" r="3" fill={theme.primary} />
        <Circle cx="145" cy="221" r="3" fill={theme.primary} />
        <Path
          d="M97 249Q121 258 145 249L145 264Q120 272 97 264Z"
          fill={theme.surface}
          opacity="0.7"
        />
      </Svg>
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: (width * 146) / 240,
            top: (height * 170) / 340,
            width: (width * 40) / 240,
            height: (height * 76) / 340,
            transformOrigin: '50% 12%',
          },
          armStyle,
        ]}
      >
        <Svg width="100%" height="100%" viewBox="0 0 40 76">
          <Path
            d="M3 2Q12 -4 19 10L34 58Q37 68 26 71Q20 73 16 64L0 29Z"
            fill={theme.primarySoft}
            stroke={theme.border}
            strokeWidth="2"
          />
        </Svg>
      </Animated.View>
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            top: 0,
            width,
            height: (height * 180) / 340,
            transformOrigin: '50% 58%',
          },
          headStyle,
        ]}
      >
        <Svg width="100%" height="100%" viewBox="0 0 240 180">
          <Path
            d="M62 106Q42 54 78 30Q115 7 155 27Q196 41 182 109L173 156Q120 183 67 153Z"
            fill={theme.primary}
          />
          <Ellipse cx="120" cy="105" rx="58" ry="56" fill={theme.characterFace} />
          <Path
            d="M61 88Q62 35 115 30Q165 27 180 81L169 103L160 70L148 85L135 61L113 79L100 61L80 92L77 77L67 105Z"
            fill={theme.primary}
          />
          <Path
            d="M104 30Q100 15 111 11Q124 6 130 17"
            fill="none"
            stroke={theme.primary}
            strokeWidth="6"
            strokeLinecap="round"
          />
          <Path
            d={
              state === 'angry'
                ? 'M82 99L99 105M141 105L158 99'
                : state === 'sad'
                  ? 'M82 106L99 101M141 101L158 106'
                  : 'M82 104Q91 99 99 103M141 103Q150 99 158 104'
            }
            fill="none"
            stroke={theme.characterEye}
            strokeOpacity="0.6"
            strokeWidth="2"
            strokeLinecap="round"
          />
          {eyesClosed ? (
            <Path
              d="M85 118Q92 121 99 117M142 117Q149 121 156 118"
              fill="none"
              stroke={theme.characterEye}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          ) : (
            <>
              <Ellipse
                cx="92"
                cy="116"
                rx="5"
                ry={state === 'sleepy' ? 3 : 8}
                fill={theme.characterEye}
              />
              <Ellipse
                cx="149"
                cy="116"
                rx="5"
                ry={state === 'sleepy' ? 3 : 8}
                fill={theme.characterEye}
              />
              <Circle cx="94" cy="113" r="1.8" fill={theme.characterHighlight} />
              <Circle cx="151" cy="113" r="1.8" fill={theme.characterHighlight} />
            </>
          )}
          <Ellipse cx="78" cy="130" rx="10" ry="5" fill={theme.characterBlush} />
          <Ellipse cx="162" cy="130" rx="10" ry="5" fill={theme.characterBlush} />
          {mouthOpen ? (
            <Ellipse cx="120" cy="137" rx="5" ry="6" fill={theme.characterEye} />
          ) : (
            <Path
              d={state === 'sad' ? 'M113 140Q120 134 127 140' : 'M113 136Q120 141 127 136'}
              fill="none"
              stroke={theme.characterEye}
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}
          <Path d="M168 72L172 107Q183 93 180 77Z" fill={theme.primary} />
          <Path d="M74 72L69 113Q58 99 62 82Z" fill={theme.primary} />
        </Svg>
      </Animated.View>
    </View>
  );
}
