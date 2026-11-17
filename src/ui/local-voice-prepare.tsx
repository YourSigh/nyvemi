import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View } from 'react-native';
import type { LocalVoiceState } from '../native/android';
import { localVoiceState, prepareBundledLocalVoice } from '../speech/local-voice';
import { Button, Note } from './components';

/** Bundled weights are verified locally. No network or automatic voice activation. */
export function LocalVoicePrepare({
  onSettings,
  onReady,
}: {
  onSettings?: () => void;
  onReady?: () => void;
}) {
  const [state, setState] = useState<LocalVoiceState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const readyCallback = useRef(onReady);
  readyCallback.current = onReady;
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void localVoiceState()
        .then((next) => {
          if (!alive) return;
          setState(next);
          if (next.available) readyCallback.current?.();
        })
        .catch(() => {
          if (alive) setError('暂时无法读取本机模型状态。');
        });
      return () => {
        alive = false;
      };
    }, []),
  );
  const prepare = async () => {
    setBusy(true);
    setError('');
    try {
      const next = await prepareBundledLocalVoice();
      setState(next);
      if (next.available) readyCallback.current?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : '本机模型准备失败，请检查剩余空间后重试。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <Note>
        {!state
          ? '正在读取本机模型状态…'
          : state.available
            ? '本机换声模型已就绪。还需有权使用的参考录音，并手动启用。'
            : state.bundled
              ? '安装包已附带本机换声模型。点击后在手机内校验并准备，无需联网，不会自动改变原声。'
              : '此版本未附带模型。可以在声音设置导入已校验的模型 ZIP。'}
      </Note>
      {error ? <Note>{error}</Note> : null}
      {state?.bundled && !state.available ? (
        <Button
          secondary
          title={busy ? '正在准备本机模型…' : '准备本机换声模型'}
          disabled={busy}
          onPress={() => void prepare()}
        />
      ) : onSettings ? (
        <Button secondary title="打开声音设置" onPress={onSettings} />
      ) : null}
    </View>
  );
}
