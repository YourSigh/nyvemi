import { useEffect, useState } from 'react';
import { bridge } from '../../native/android';
import { armLayout, type RenderLayer } from '../../appearance/arm-layout';
import { Animated, Image, View, type ViewProps } from 'react-native';
import { SvgXml } from 'react-native-svg';
import type { CharacterRig, ImageAsset } from '../../appearance/model';
import type { CharacterInteractionState } from '../../character/interaction';
export function CharacterImage({
  asset,
  width,
  height,
  preserveDetail = false,
}: {
  preserveDetail?: boolean;
  asset: ImageAsset;
  width: number;
  height: number;
}) {
  return asset.svg ? (
    <SvgXml xml={asset.svg} width={width} height={height} />
  ) : (
    <Image
      source={{ uri: asset.uri }}
      resizeMode="contain"
      resizeMethod={preserveDetail ? 'scale' : 'auto'}
      style={{ width, height }}
    />
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
  leftArmStyle,
}: {
  rig: CharacterRig;
  width: number;
  height: number;
  eyesClosed: boolean;
  mouthOpen: boolean;
  state: CharacterInteractionState;
  headStyle: Animated.AnimatedProps<ViewProps>['style'];
  armStyle: Animated.AnimatedProps<ViewProps>['style'];
  leftArmStyle?: Animated.AnimatedProps<ViewProps>['style'];
}) {
  const headRoles = ['head', 'hair', 'eyes', 'mouth'];
  const [resolved, setResolved] = useState<{ rig: CharacterRig; layers: RenderLayer[] }>();
  useEffect(() => {
    let live = true;
    const body = rig.layers.find((layer) => layer.role === 'body');
    const centerX = body ? body.bounds[0] + body.bounds[2] / 2 : 0.5;
    void Promise.all(
      rig.layers.map(async (layer) => {
        if (layer.role !== 'arm' || layer.asset.svg)
          return [{ layer, crop: [0, 0, 1, 1] } as RenderLayer];
        try {
          return armLayout(layer, await bridge().analyzeCharacterImage(layer.asset.uri), centerX);
        } catch {
          return [{ layer, crop: [0, 0, 1, 1] } as RenderLayer];
        }
      }),
    ).then((layers) => {
      if (live) setResolved({ rig, layers: layers.flat() });
    });
    return () => {
      live = false;
    };
  }, [rig]);
  const layers =
    resolved?.rig === rig
      ? resolved.layers
      : rig.layers.map((layer) => ({ layer, crop: [0, 0, 1, 1] }) as RenderLayer);
  return (
    <View style={{ width, height }}>
      {[...layers]
        .filter(({ layer }) => rig.source !== 'seedream' || layer.role !== 'background')
        .sort((a, b) => a.layer.z - b.layer.z)
        .map(({ layer, crop, pivot, side }, i) => {
          const [x, y, w, h] = layer.bounds;
          const isArm = layer.role === 'arm';
          const armPosition = {
            position: 'absolute' as const,
            left: x * width,
            top: y * height,
            width: w * width,
            height: h * height,
            ...(pivot ? { transformOrigin: [pivot[0] * w * width, pivot[1] * h * height, 0] } : {}),
          };
          const closed = eyesClosed || state === 'sleepy';
          return (
            <Animated.View
              key={i}
              pointerEvents="none"
              style={[
                isArm ? armPosition : { position: 'absolute', width, height },
                headRoles.includes(layer.role)
                  ? headStyle
                  : side
                    ? side === 'right'
                      ? armStyle
                      : leftArmStyle
                    : undefined,
              ]}
            >
              <View
                style={{
                  position: 'absolute',
                  left: isArm ? 0 : x * width,
                  top: isArm ? 0 : y * height,
                  overflow: 'hidden',
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
                <View
                  style={{
                    position: 'absolute',
                    left: (-crop[0] * w * width) / crop[2],
                    top: (-crop[1] * h * height) / crop[3],
                  }}
                >
                  <CharacterImage
                    preserveDetail={layer.role === 'eyes' || layer.role === 'mouth'}
                    asset={layer.asset}
                    width={(w * width) / crop[2]}
                    height={(h * height) / crop[3]}
                  />
                </View>
              </View>
            </Animated.View>
          );
        })}
    </View>
  );
}
