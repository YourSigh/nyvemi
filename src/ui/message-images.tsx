import { useTheme } from '../theme/context';
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { MediaAsset } from '../media/model';
import { useRuntime } from './context';
export function MessageImages({ ids, characterId }: { ids: string[]; characterId: string }) {
  const { transitioning, palette } = useTheme();
  const runtime = useRuntime(),
    [assets, setAssets] = useState<MediaAsset[]>([]),
    [view, setView] = useState<MediaAsset>(),
    [failed, setFailed] = useState(false),
    key = ids.join('|');
  useEffect(() => {
    if (transitioning) setView(undefined);
  }, [transitioning]);
  useEffect(() => {
    let live = true;
    void Promise.allSettled(
      key
        .split('|')
        .filter(Boolean)
        .map((id) => runtime.media.asset(characterId, id)),
    )
      .then((rows) => {
        if (live) {
          setAssets(rows.flatMap((row) => (row.status === 'fulfilled' ? [row.value] : [])));
          setFailed(rows.some((row) => row.status === 'rejected'));
        }
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [runtime, characterId, key]);
  return (
    <View style={{ gap: 8 }}>
      {assets.map((asset) => (
        <Pressable
          key={asset.id}
          accessibilityRole="button"
          accessibilityLabel="查看图片"
          disabled={transitioning}
          onPress={() => setView(asset)}
        >
          <Image
            source={{ uri: asset.uri }}
            resizeMode="contain"
            style={{
              width: 220,
              height: Math.min(260, Math.max(100, (220 * asset.height) / asset.width)),
              borderRadius: 10,
            }}
            onError={() => setFailed(true)}
          />
        </Pressable>
      ))}
      {failed ? <Text style={{ color: palette.muted }}>图片文件不可用</Text> : null}
      <Modal visible={!!view} animationType="fade" onRequestClose={() => setView(undefined)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#111' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭图片"
            onPress={() => setView(undefined)}
            style={{ padding: 20 }}
          >
            <Text style={{ color: '#fff' }}>关闭</Text>
          </Pressable>
          {view ? (
            <Image source={{ uri: view.uri }} resizeMode="contain" style={{ flex: 1 }} />
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}
