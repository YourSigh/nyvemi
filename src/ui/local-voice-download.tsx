import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View } from 'react-native';
import type { LocalVoiceDownloadState } from '../native/android';
import {
  downloadLocalVoicePack,
  localVoiceDownloadState,
  localVoiceState,
  pauseLocalVoiceDownload,
} from '../speech/local-voice';
import { Button, Note } from './components';
export function LocalVoiceDownload({
  onReady,
  onSettings,
}: {
  onReady?(): void;
  onSettings?(): void;
}) {
  const [state, setState] = useState<LocalVoiceDownloadState>();
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const callback = useRef(onReady);
  callback.current = onReady;
  useFocusEffect(
    useCallback(() => {
      let alive = true,
        polling = false,
        readyReported = false;
      const poll = async () => {
        if (polling) return;
        polling = true;
        try {
          const [next, model] = await Promise.all([localVoiceDownloadState(), localVoiceState()]);
          if (!alive) return;
          setState(next);
          setInstalled(model.available);
          if (model.available && !readyReported) {
            readyReported = true;
            callback.current?.();
          }
        } catch {
          if (alive) setError('无法读取模型下载状态，请稍后重试。');
        } finally {
          polling = false;
        }
      };
      void poll();
      const timer = setInterval(() => void poll(), 1000);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, []),
  );
  const action = async () => {
    if (!state) return;
    setBusy(true);
    setError('');
    try {
      if (state.phase === 'downloading') await pauseLocalVoiceDownload();
      else await downloadLocalVoicePack();
      setState(await localVoiceDownloadState());
    } catch (e) {
      setError(e instanceof Error ? e.message : '下载操作未完成，请重试。');
    } finally {
      setBusy(false);
    }
  };
  const mib = (bytes: number) => (Math.max(0, bytes) / 1048576).toFixed(1);
  const waiting = state?.phase === 'verifying' || state?.phase === 'installing';
  return (
    <View style={{ gap: 8 }}>
      <Note>
        {installed
          ? '本机模型已安装，不需重复下载。参考音色需明确确认后才会应用。'
          : !state
            ? '正在读取模型状态…'
            : !state.configured
              ? 'ModelScope 下载地址尚未配置，暂不能在线下载；可导入已校验的模型 ZIP。'
              : state.phase === 'downloading'
                ? `正在下载：${mib(state.bytes)} / ${state.size ? mib(state.size) : '117.2'} MiB`
                : state.phase === 'paused'
                  ? `已取消当前下载，保留 ${mib(state.bytes)} MiB 进度，可继续。`
                  : waiting
                    ? '下载完成，正在校验并安装；原有模型保持不变。'
                    : state.phase === 'error'
                      ? ((
                          {
                            network: '网络中断，可重试或继续下载。',
                            space: '空间不足，请清理空间后重试。',
                            checksum: '模型校验失败，未安装此文件，请重试。',
                            install: '安装失败，原有模型未被替换，请重试。',
                          } as Record<string, string>
                        )[state.error ?? 'network'] ??
                        (state.error?.trim() || '模型下载未完成，请重试；原有模型保持不变。'))
                      : '从 ModelScope 下载本机换声模型（117.2 MiB），仅点击后开始，不会自动启用换声。'}
      </Note>
      {error ? <Note>{error}</Note> : null}
      {!installed ? (
        <Button
          secondary
          title={
            waiting
              ? '正在校验安装…'
              : state?.phase === 'downloading'
                ? '取消下载（保留进度）'
                : state?.phase === 'paused'
                  ? '继续下载模型'
                  : state?.phase === 'error'
                    ? '重试下载模型'
                    : '下载本机换声模型（117.2 MiB）'
          }
          disabled={busy || !state?.configured || waiting}
          onPress={() => void action()}
        />
      ) : null}
      {onSettings ? <Button secondary title="打开声音设置" onPress={onSettings} /> : null}
    </View>
  );
}
