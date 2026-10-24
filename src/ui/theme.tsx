import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { useTheme } from '../theme/context';
import { closeKeyboard } from './keyboard';
import { themeName } from '../theme/generator';
import { useRuntime } from './context';
import { Avatar, Button, Card, ErrorText, Field, Note, Page } from './components';
import type { ScreenProps } from './navigation';
/** The color question lives on Welcome only. This screen performs the opening reveal. */
export function ThemeScreen({ navigation }: ScreenProps<'Theme'>) {
  const runtime = useRuntime();
  const { palette, apply, transitioning } = useTheme();
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(true);
  const [line, setLine] = useState('把你喜欢的感觉，留在这里。');
  const [error, setError] = useState('');
  const started = useRef(false);
  const mounted = useRef(true);
  const submitting = useRef(false);
  usePreventRemove(busy || transitioning, () => {});
  const change = async (input: string) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await closeKeyboard();
      const next = await runtime.themes.interpret(input);
      if (!mounted.current) return;
      setLine(`那就换成「${themeName(next.preference)}」。`);
      await apply(next, () => runtime.themes.completeOpening(next));
      if (mounted.current) setLine('好了，这里也记住了一点你的样子。');
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : '没换好，再试一下。');
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      void runtime.themes
        .opening()
        .then((input) => {
          if (!mounted.current) return;
          if (!input) {
            setBusy(false);
            return;
          }
          setDescription(input);
          void change(input);
        })
        .catch(() => {
          if (mounted.current) {
            setError('读取颜色偏好失败');
            setBusy(false);
          }
        });
    }
    return () => {
      mounted.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- run the saved opening once
  return (
    <Page>
      <View style={{ paddingTop: 40, gap: 24 }}>
        <Avatar name="Nyvemi" size={70} />
        <Card>
          <Text
            accessibilityLiveRegion="polite"
            style={{ color: palette.ink, fontSize: 22, lineHeight: 34 }}
          >
            {line}
          </Text>
        </Card>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {[palette.accent, palette.tint, palette.paper].map((color, n) => (
            <View
              key={n}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: color,
                borderWidth: 1,
                borderColor: palette.line,
              }}
            />
          ))}
        </View>
        {busy ? <Note>{transitioning ? '颜色正在慢慢铺开…' : '正在听你说…'}</Note> : null}
        <ErrorText text={error} />
        {error ? (
          <>
            <Field
              label="颜色和感觉"
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={500}
            />
            <Button
              title="再试一次"
              disabled={busy || !description.trim()}
              onPress={() => void change(description)}
            />
          </>
        ) : null}
        <Button
          title={error ? '先用原来的颜色，继续' : '去认识她'}
          disabled={busy}
          onPress={() => {
            setBusy(true);
            void runtime.themes
              .completeOpening()
              .then(() => navigation.replace('Create'))
              .catch(() => {
                setError('保存失败，请重试');
                setBusy(false);
              });
          }}
        />
      </View>
    </Page>
  );
}
