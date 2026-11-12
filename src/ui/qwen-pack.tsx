import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { AppState, Text, View } from 'react-native';
import { getDocumentAsync } from 'expo-document-picker';
import { bridge, type QwenPackState } from '../native/android';
import { preferQwenVoice } from '../speech/preferences';
import { usePalette } from '../theme/context';
import { useRuntime } from './context';
import { ErrorText, TextButton } from './components';

export function useQwenPack(cid: string) {
  const { store } = useRuntime();
  const focused = useIsFocused();
  const [status, setStatus] = useState<QwenPackState>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => setStatus(await bridge().qwenPackState()), []);
  useFocusEffect(
    useCallback(() => {
      const check = () => void refresh().catch(() => setError('读取语音模型状态失败'));
      check();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') check();
      });
      return () => sub.remove();
    }, [refresh]),
  );
  const working = ['downloading', 'importing', 'verifying'].includes(status?.phase ?? '');
  useEffect(() => {
    if (!focused || !working) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refresh().catch(() => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [focused, working, refresh]);

  const start = async (fromFile = false) => {
    if (working || starting || status?.phase === 'ready') return;
    setStarting(true);
    setError('');
    try {
      let uri: string | undefined;
      if (fromFile) {
        const picked = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: false });
        if (picked.canceled) return;
        uri = picked.assets[0].uri;
      }
      await preferQwenVoice(store, cid);
      if (uri) await bridge().importQwenPack(uri);
      else await bridge().downloadQwenPack();
      await refresh();
    } catch {
      setError(fromFile ? '无法打开模型文件，请重新选择' : '无法开始下载，请重试');
    } finally {
      setStarting(false);
    }
  };

  return {
    status,
    starting,
    working,
    error,
    download: () => void start(),
    importFile: () => void start(true),
    pause: () =>
      void bridge()
        .pauseQwenPack()
        .catch(() => setError('暂停失败，请重试')),
  };
}

const packErrors = {
  space: '空间不足，请腾出至少 800 MB 后重试。',
  network: '下载中断。换个网络后可以继续下载。',
  checksum: '文件校验失败，请重试或选择正确的模型文件。',
  import: '读取文件失败，请重新选择完整的 GGUF 文件。',
};

export function QwenPackCard({
  pack,
  onSettings,
}: {
  pack: ReturnType<typeof useQwenPack>;
  onSettings?: () => void;
}) {
  const palette = usePalette();
  const { status, working, starting } = pack;
  if (!status) return null;
  if (status.phase === 'unsupported') {
    return <Text style={{ color: palette.muted }}>这台设备可以使用系统语音。</Text>;
  }
  const percent = Math.min(100, Math.floor((status.bytes / status.size) * 100));
  const label =
    status.phase === 'ready'
      ? '已安装'
      : status.phase === 'verifying'
        ? '正在校验…'
        : status.phase === 'importing'
          ? `正在导入 · ${percent}%`
          : status.phase === 'downloading'
            ? `正在下载 · ${percent}%`
            : status.bytes
              ? `已下载 ${percent}% · 约 761 MB`
              : '约 761 MB';
  return (
    <View testID="qwen-pack-card" style={{ gap: 4, paddingVertical: 6 }}>
      <Text style={{ color: palette.ink, fontWeight: '600' }}>Qwen 离线语音</Text>
      <Text accessibilityLiveRegion="polite" style={{ color: palette.muted }}>
        {label}
      </Text>
      {working ? (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="语音模型进度"
          accessibilityValue={{ min: 0, max: 100, now: percent }}
          style={{ height: 4, borderRadius: 2, backgroundColor: palette.line, overflow: 'hidden' }}
        >
          <View style={{ width: `${percent}%`, height: '100%', backgroundColor: palette.accent }} />
        </View>
      ) : null}
      <ErrorText text={pack.error || (status.error ? packErrors[status.error] : '')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {status.phase === 'ready' ? (
          onSettings ? (
            <TextButton title="调整音色" onPress={onSettings} />
          ) : null
        ) : status.phase === 'downloading' ? (
          <TextButton title="暂停下载" onPress={pack.pause} />
        ) : !working ? (
          <>
            <TextButton
              title={status.bytes ? '继续下载' : '下载模型'}
              disabled={starting}
              onPress={pack.download}
            />
            <TextButton title="导入文件" disabled={starting} onPress={pack.importFile} />
          </>
        ) : null}
      </View>
    </View>
  );
}
