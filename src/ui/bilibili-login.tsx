import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import createQrMatrix from 'qrcode-generator';
import Svg, { Path, Rect } from 'react-native-svg';
import { Button, Card, ErrorText, Note } from './components';
import { useRuntime } from './context';
import type { BilibiliQrCode } from '../exploration/bilibili-session';

function LoginCode({ url }: { url: string }) {
  const { size, dots } = useMemo(() => {
    const code = createQrMatrix(0, 'M');
    code.addData(url);
    code.make();
    const count = code.getModuleCount();
    let dots = '';
    for (let y = 0; y < count; y++)
      for (let x = 0; x < count; x++) if (code.isDark(y, x)) dots += `M${x + 4} ${y + 4}h1v1h-1z`;
    return { size: count + 8, dots };
  }, [url]);
  return (
    <View accessibilityLabel="B 站登录二维码" accessible style={{ alignSelf: 'center' }}>
      <Svg width={216} height={216} viewBox={`0 0 ${size} ${size}`}>
        <Rect width={size} height={size} fill="white" />
        <Path d={dots} fill="black" />
      </Svg>
    </View>
  );
}

export function BilibiliLogin({ characterId }: { characterId: string }) {
  const { bilibiliSession, prepareBilibiliExploration } = useRuntime();
  const [connected, setConnected] = useState(false);
  const [working, setWorking] = useState(false);
  const [qr, setQr] = useState<BilibiliQrCode>();
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | undefined>(undefined);
  const cancel = useCallback(() => {
    request.current?.abort();
    request.current = undefined;
    bilibiliSession.cancelQr();
  }, [bilibiliSession]);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      const refresh = () => {
        void bilibiliSession.getStatus().then(
          (state) => {
            if (live) setConnected(state === 'signed_in');
          },
          () => {
            if (live) setError('无法读取 B 站登录状态');
          },
        );
      };
      refresh();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') refresh();
      });
      return () => {
        live = false;
        subscription.remove();
        cancel();
        setQr(undefined);
        setWorking(false);
      };
    }, [bilibiliSession, cancel]),
  );
  useEffect(() => {
    if (!qr) return;
    const pending = request.current;
    if (!pending) return;
    let timer: ReturnType<typeof setTimeout>;
    const wait = () => {
      timer = setTimeout(() => void poll(), 3000);
    };
    const poll = async () => {
      if (pending.signal.aborted) return;
      if (AppState.currentState !== 'active' && Date.now() < qr.expiresAt) return wait();
      try {
        const result = await bilibiliSession.pollQr(qr.key, pending.signal);
        if (pending.signal.aborted) return;
        if (result === 'waiting' || result === 'scanned') {
          setScanned(result === 'scanned');
          wait();
        } else {
          request.current = undefined;
          setQr(undefined);
          setConnected(result === 'signed_in');
          if (result === 'expired') setError('二维码已过期，可以重新生成');
          else void prepareBilibiliExploration(characterId).catch(() => undefined);
        }
      } catch {
        if (pending.signal.aborted) return;
        cancel();
        setQr(undefined);
        setError('B 站登录暂不可用，请稍后再试');
      }
    };
    wait();
    return () => clearTimeout(timer);
  }, [bilibiliSession, cancel, characterId, prepareBilibiliExploration, qr]);
  const start = async () => {
    if (request.current || working) return;
    const pending = new AbortController();
    request.current = pending;
    setWorking(true);
    setError('');
    setScanned(false);
    try {
      const code = await bilibiliSession.beginQr(pending.signal);
      if (!pending.signal.aborted) setQr(code);
    } catch {
      if (!pending.signal.aborted) setError('暂时无法生成 B 站二维码');
      cancel();
    } finally {
      if (!pending.signal.aborted || request.current === undefined) setWorking(false);
    }
  };
  const disconnect = async () => {
    setWorking(true);
    setError('');
    try {
      await bilibiliSession.signOut();
      setConnected(false);
    } catch {
      setError('暂时无法断开登录，请重试');
    } finally {
      setWorking(false);
    }
  };
  return (
    <Card>
      <Note>{connected ? 'B 站已连接 · 只读' : 'B 站账号 · 可选'}</Note>
      <ErrorText text={error} />
      {qr ? (
        <>
          <LoginCode url={qr.url} />
          <Note>
            {scanned
              ? '请在 B 站 App 确认登录'
              : '用另一台设备的 B 站 App 扫码，也可以截图后在本机的扫一扫中选相册。'}
          </Note>
          <Button
            title="取消扫码"
            secondary
            onPress={() => {
              cancel();
              setQr(undefined);
            }}
          />
        </>
      ) : connected ? (
        <Button
          title="断开 B 站登录"
          secondary
          disabled={working}
          onPress={() => void disconnect()}
        />
      ) : (
        <>
          <Note>登录后可尝试读取视频字幕。感兴趣的片段可能随聊天发给你配置的模型。</Note>
          <Button
            title={working ? '正在生成二维码…' : '扫码连接 B 站'}
            secondary
            disabled={working}
            onPress={() => void start()}
          />
        </>
      )}
    </Card>
  );
}
