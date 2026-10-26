import { Animated, Image, View, type ViewProps } from 'react-native';
import { SvgXml } from 'react-native-svg';
import type { CharacterRig, ImageAsset } from '../../appearance/model';
import type { CharacterInteractionState } from '../../character/interaction';
export function CharacterImage({
  asset,
  width,
  height,
}: {
  asset: ImageAsset;
  width: number;
  height: number;
}) {
  return asset.svg ? (
    <SvgXml xml={asset.svg} width={width} height={height} />
  ) : (
    <Image source={{ uri: asset.uri }} resizeMode="contain" style={{ width, height }} />
  );
}
export function RigCharacter({
  rig,
  width,
  height,
  eyesClosed,
  mouthOpen,
  state,
  headStyle,
  armStyle,
}: {
  rig: CharacterRig;
  width: number;
  height: number;
  eyesClosed: boolean;
  mouthOpen: boolean;
  state: CharacterInteractionState;
  headStyle: Animated.AnimatedProps<ViewProps>['style'];
  armStyle: Animated.AnimatedProps<ViewProps>['style'];
}) {
  const headRoles = ['head', 'hair', 'eyes', 'mouth'];
  return (
    <View style={{ width, height }}>
      {[...rig.layers]
        .sort((a, b) => a.z - b.z)
        .map((layer, i) => {
          const [x, y, w, h] = layer.bounds;
          const closed = eyesClosed || state === 'sleepy';
          return (
            <Animated.View
              key={i}
              pointerEvents="none"
              style={[
                { position: 'absolute', width, height },
                headRoles.includes(layer.role)
                  ? headStyle
                  : layer.role === 'arm'
                    ? armStyle
                    : undefined,
              ]}
            >
              <View
                style={{
                  position: 'absolute',
                  left: x * width,
                  top: y * height,
                  width: w * width,
                  height: h * height,
                  transform: [
                    {
                      scaleY:
                        layer.role === 'eyes'
                          ? closed
                            ? 0.08
                            : 1
                          : layer.role === 'mouth'
                            ? mouthOpen
                              ? 1
                              : 0.35
                            : 1,
                    },
                  ],
                }}
              >
                <CharacterImage asset={layer.asset} width={w * width} height={h * height} />
              </View>
            </Animated.View>
          );
        })}
    </View>
  );
}
