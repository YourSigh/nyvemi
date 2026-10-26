import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import type { MeshAvatar } from '../../avatar/model';
import type { CharacterInteractionState } from '../../character/interaction';
import { meshAvatarHTML } from '../../avatar/native';
import type { AvatarInput } from '../../avatar/driver';
import { usePalette } from '../../theme/context';
export function MeshAvatarStage({
  model,
  height,
  state,
  intensity,
  eyesClosed = false,
  onReady,
}: {
  model: MeshAvatar;
  height: number;
  state: CharacterInteractionState;
  intensity: number;
  eyesClosed?: boolean;
  onReady?: (ready: boolean) => void;
}) {
  const uri = model.uri;
  const palette = usePalette(),
    focused = useIsFocused();
  const ref = useRef<WebView>(null);
  const [html, setHtml] = useState(''),
    [error, setError] = useState(''),
    [ready, setReady] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active'),
    [reducedMotion, setReducedMotion] = useState(false);
  const input = useRef<AvatarInput>({
    state,
    intensity,
    eyesClosed,
    active: focused && active,
    reducedMotion,
  });
  input.current = { state, intensity, eyesClosed, active: focused && active, reducedMotion };
  const send = useCallback(() => {
    ref.current?.injectJavaScript(
      `window.NyvemiAvatar&&window.NyvemiAvatar.setInput(${JSON.stringify(input.current)});true;`,
    );
  }, []);
  useEffect(() => {
    let live = true;
    setReady(false);
    onReady?.(false);
    setError('');
    setHtml('');
    void meshAvatarHTML({ format: 'p2lrt', version: 1, uri })
      .then((source) => {
        if (live) setHtml(source);
      })
      .catch(() => {
        if (live) setError('网格模型加载失败，请重新导入');
      });
    return () => {
      live = false;
    };
  }, [uri, onReady]);
  useEffect(() => {
    const app = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const reduced = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => {
      app.remove();
      reduced.remove();
    };
  }, []);
  useEffect(() => {
    if (ready) send();
  }, [ready, state, intensity, eyesClosed, focused, active, reducedMotion, send]);
  return (
    <View testID="mesh-avatar-stage" style={{ height, overflow: 'hidden' }}>
      {html ? (
        <WebView
          ref={ref}
          source={{ html, baseUrl: 'about:blank' }}
          style={{ flex: 1, backgroundColor: 'transparent' }}
          originWhitelist={['about:blank']}
          javaScriptEnabled
          domStorageEnabled={false}
          allowFileAccess={false}
          allowUniversalAccessFromFileURLs={false}
          allowFileAccessFromFileURLs={false}
          mixedContentMode="never"
          androidLayerType="hardware"
          overScrollMode="never"
          scrollEnabled={false}
          onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
          onMessage={(event) => {
            try {
              const data: unknown = JSON.parse(event.nativeEvent.data);
              if (data && typeof data === 'object' && 'type' in data) {
                if (data.type === 'ready') {
                  setReady(true);
                  onReady?.(true);
                  send();
                } else if (data.type === 'error') {
                  setReady(false);
                  onReady?.(false);
                  setError('网格模型无法播放，请检查导出结果');
                }
              }
            } catch {
              setError('角色运行时通信失败');
            }
          }}
          onError={() => setError('角色运行时启动失败')}
        />
      ) : null}
      {!ready || error ? (
        <Text
          style={{
            position: 'absolute',
            alignSelf: 'center',
            top: height / 2,
            color: palette.muted,
          }}
        >
          {error || '正在唤醒…'}
        </Text>
      ) : null}
    </View>
  );
}
