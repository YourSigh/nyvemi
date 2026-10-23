import { useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, Pressable, Text, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { useTheme } from '../theme/context';
import { defaultPreference, type ThemeRecord } from '../theme/model';
import { themeName } from '../theme/generator';
import { useRuntime } from './context';
import { Avatar, Button, Card, ErrorText, Field, Heading, Note, Page } from './components';
import type { ScreenProps } from './navigation';
async function closeKeyboard(): Promise<void> {
  if (!Keyboard.isVisible()) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      subscription.remove();
      resolve();
    };
    const subscription = Keyboard.addListener('keyboardDidHide', finish);
    const timeout = setTimeout(finish, 450);
    Keyboard.dismiss();
  });
}
export function ThemeScreen({ navigation, route }: ScreenProps<'Theme'>) {
  const runtime = useRuntime();
  const { palette, record, apply, transitioning, reducedMotion } = useTheme();
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [done, setDone] = useState(false);
  const [line, setLine] = useState('');
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const mounted = useRef(true);
  const hop = useRef(new Animated.Value(0)).current;
  usePreventRemove(transitioning, () => {});
  const change = async (input: string, reset = false) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    setDone(false);
    setLine(reset ? '那就回到最初那一点粉白。' : '嗯……让我听听你喜欢的感觉。');
    try {
      await closeKeyboard();
      const next: ThemeRecord = reset
        ? {
            id: 'app',
            version: 1,
            preference: defaultPreference,
            description: '',
            source: 'default',
            createdAt: Date.now(),
          }
        : await runtime.themes.interpret(input);
      if (!mounted.current) return;
      setLine(`那就让这里，慢慢变成「${themeName(next.preference)}」。`);
      // Paint the acknowledgement before taking the transient old-theme snapshot.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (!mounted.current) return;
      await apply(next, () => runtime.themes.save(next));
      await runtime.themes.clearOpening();
      if (!mounted.current) return;
      setDone(true);
      if (next.source === 'local')
        setLine('这次先用本地配色，按你说的颜色做了这一版。你可以再调整。');
      else if (reset) setLine('又回到那一点粉白了。');
      else setLine('好了，这里也记住了一点你的样子。');
      if (!reducedMotion)
        Animated.sequence([
          Animated.timing(hop, { toValue: -5, duration: 120, useNativeDriver: true }),
          Animated.timing(hop, { toValue: 0, duration: 180, useNativeDriver: true }),
        ]).start();
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : '颜色没换好，原来的样子还在。');
        setLine('别急，我们可以换个说法。');
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    let live = true;
    void runtime.themes
      .opening()
      .then((opening) => {
        if (!live) return;
        const input = route.params?.onboarding
          ? (opening ?? record?.description ?? '')
          : (record?.description ?? '');
        setDescription(input);
        setLoaded(true);
        if (route.params?.autoGenerate && input) void change(input);
      })
      .catch(() => {
        if (live) {
          setLoaded(true);
          setError('读取颜色偏好失败，可以重新告诉我。');
        }
      });
    return () => {
      live = false;
      mounted.current = false;
      hop.stopAnimation();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one explicit generation per navigation, never on theme re-render
  const continueOnboarding = async () => {
    try {
      await runtime.themes.clearOpening();
      navigation.replace('Create');
    } catch {
      setError('保存开场进度失败，请再试一下');
    }
  };
  return (
    <Page>
      <View style={{ paddingTop: 16, gap: 18 }}>
        <Animated.View style={{ alignSelf: 'flex-start', transform: [{ translateY: hop }] }}>
          <Avatar name="Nyvemi" size={70} />
        </Animated.View>
        <Note>
          {route.params?.onboarding
            ? '开场 · 只问这一小步，接着就去创造她'
            : '不必从头开始，告诉我你现在喜欢的感觉'}
        </Note>
        <Heading>让这里，更像你喜欢的样子</Heading>
        <Card>
          <Text
            accessibilityLiveRegion="polite"
            style={{ color: palette.ink, fontSize: 19, lineHeight: 30 }}
          >
            {line || '你喜欢什么颜色呀？温柔、清爽、安静、可爱、神秘，都可以告诉我。'}
          </Text>
        </Card>
        <Field
          label="颜色和感觉"
          value={description}
          onChangeText={(text) => {
            setDescription(text);
            setDone(false);
          }}
          multiline
          maxLength={500}
          editable={!busy}
          placeholder="比如：蓝灰色，安静一点，不要太冷"
        />
        {!busy ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {['淡粉色，柔和、不太艳', '蓝灰色，安静一点', '深夜蓝，暗一点', '紫色，梦幻一点'].map(
              (text) => (
                <Pressable
                  key={text}
                  accessibilityRole="button"
                  onPress={() => {
                    setDescription(text);
                    setDone(false);
                  }}
                  style={{ backgroundColor: palette.tint, padding: 10, borderRadius: 14 }}
                >
                  <Text style={{ color: palette.accent }}>{text}</Text>
                </Pressable>
              ),
            )}
          </View>
        ) : null}
        <ErrorText text={error} />
        <Button
          title={
            busy
              ? transitioning
                ? '颜色正在慢慢铺开…'
                : '正在听你说…'
              : done
                ? '再调整一下感觉'
                : '就按这个感觉'
          }
          disabled={!loaded || busy || !description.trim()}
          onPress={() => void change(description)}
        />
        {record ? (
          <Note>
            现在是「{themeName(record.preference)}」。背景、按钮、气泡和文字都会一起适应。
          </Note>
        ) : null}
        {route.params?.onboarding ? (
          <Button
            title={done ? '颜色好了，去认识她' : '先保留现在的颜色，继续'}
            secondary
            disabled={busy}
            onPress={() => void continueOnboarding()}
          />
        ) : (
          <Button
            title="回去和她聊天"
            secondary
            disabled={busy}
            onPress={() => navigation.goBack()}
          />
        )}
        <Button
          title="恢复粉白色"
          secondary
          disabled={busy || !loaded}
          onPress={() => void change('', true)}
        />
      </View>
    </Page>
  );
}
