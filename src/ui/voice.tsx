import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, PermissionsAndroid, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { bridge } from '../native/android';
import { useTheme } from '../theme/context';
import { VoiceHold, type VoicePhase } from '../voice/hold';
export async function requestVoiceAccess(): Promise<boolean> {
  const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (await PermissionsAndroid.check(permission)) return true;
  const result = await PermissionsAndroid.request(permission, {
    title: '按住说话',
    message: '需要麦克风权限来识别你按住时说的话。',
    buttonPositive: '继续',
    buttonNegative: '取消',
  });
  if (result === PermissionsAndroid.RESULTS.GRANTED) return true;
  Alert.alert('麦克风未开启', '可以在系统设置里允许麦克风，或继续使用键盘。', [
    { text: '取消', style: 'cancel' },
    {
      text: '去设置',
      onPress: () => {
        void Linking.openSettings();
      },
    },
  ]);
  return false;
}
export function HoldToTalk({
  disabled,
  onText,
  onError,
  onActiveChange,
}: {
  disabled: boolean;
  onText: (text: string) => void;
  onError: (message: string) => void;
  onActiveChange: (active: boolean) => void;
}) {
  const { palette, transitioning } = useTheme(),
    focused = useIsFocused();
  const [phase, setPhase] = useState<VoicePhase>('idle'),
    [partial, setPartial] = useState('');
  const mounted = useRef(true),
    callbacks = useRef({ onText, onError, onActiveChange });
  callbacks.current = { onText, onError, onActiveChange };
  const allowed = useRef(true);
  const baseAllowed = useRef(true);
  baseAllowed.current = !disabled && !transitioning && focused;
  allowed.current = !disabled && !transitioning && focused && AppState.currentState === 'active';
  const controller = useRef<VoiceHold | null>(null);
  if (!controller.current)
    controller.current = new VoiceHold({
      start: async (id) => {
        await bridge().startVoice(id);
      },
      finish: (id, cancel) => bridge().finishVoice(id, cancel),
      abort: (id) => bridge().cancelVoice(id),
      now: Date.now,
      state: (next) => {
        if (!mounted.current) return;
        setPhase(next);
        if (next === 'idle') setPartial('');
        callbacks.current.onActiveChange(next !== 'idle');
      },
      text: (text) => {
        if (allowed.current && AppState.currentState === 'active') callbacks.current.onText(text);
      },
      error: (message) => {
        if (mounted.current && allowed.current) callbacks.current.onError(message);
      },
    });
  useEffect(() => {
    mounted.current = true;
    const sub = bridge().addListener('voicePartial', (e) => {
      const text = controller.current?.partial(e.id, e.text);
      if (text !== undefined) setPartial(text);
    });
    const app = AppState.addEventListener('change', (s) => {
      allowed.current = s === 'active' && baseAllowed.current;
      if (s !== 'active') {
        allowed.current = false;
        controller.current?.cancel();
      }
    });
    return () => {
      mounted.current = false;
      sub.remove();
      app.remove();
      controller.current?.cancel();
      callbacks.current.onActiveChange(false);
    };
  }, []);
  useEffect(() => {
    if (disabled || transitioning || !focused) controller.current?.cancel();
  }, [disabled, transitioning, focused]);
  const canceling = phase === 'canceling',
    holding = phase === 'holding' || canceling || phase === 'starting';
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      {phase !== 'idle' ? (
        <Text
          accessibilityLiveRegion="polite"
          numberOfLines={2}
          style={{
            color: canceling ? palette.error : palette.muted,
            fontSize: 12,
            textAlign: 'center',
            marginBottom: 5,
          }}
        >
          {canceling
            ? '松开取消发送'
            : phase === 'processing'
              ? '正在识别…'
              : partial || '上滑取消 · 最长60秒'}
        </Text>
      ) : null}
      <View
        accessibilityRole="button"
        accessibilityLabel="按住说话，上滑取消"
        style={{
          minHeight: 46,
          padding: 12,
          borderWidth: 1,
          borderRadius: 18,
          borderColor: canceling ? palette.error : palette.line,
          backgroundColor: holding ? palette.tint : palette.paper,
          opacity: disabled ? 0.5 : 1,
          justifyContent: 'center',
          alignItems: 'center',
        }}
        onStartShouldSetResponder={() => allowed.current && phase !== 'processing'}
        onResponderGrant={(e) => {
          if (allowed.current) {
            setPartial('');
            void controller.current?.begin(e.nativeEvent.pageY);
          }
        }}
        onResponderMove={(e) => controller.current?.move(e.nativeEvent.pageY)}
        onResponderRelease={() => controller.current?.release()}
        onResponderTerminationRequest={() => false}
        onResponderTerminate={() => controller.current?.cancel()}
      >
        <Text style={{ color: canceling ? palette.error : palette.ink, fontSize: 15 }}>
          {canceling
            ? '松开取消'
            : phase === 'processing'
              ? '正在识别…'
              : holding
                ? '松开发送'
                : '按住说话'}
        </Text>
      </View>
    </View>
  );
}
