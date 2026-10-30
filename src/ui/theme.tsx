import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { useTheme } from '../theme/context';
import { closeKeyboard } from './keyboard';
import { themeName } from '../theme/generator';
import { useRuntime } from './context';
import { Avatar, Button, Card, ErrorText, Field, Note, Page } from './components';
import type { ScreenProps } from './navigation';
/** Settings edits never consume the opening draft or restart character creation. */
export function ThemeScreen({ navigation, route }: ScreenProps<'Theme'>) {
  const runtime = useRuntime();
  const { palette, record, apply, transitioning } = useTheme();
  const editing = route.params?.mode === 'settings';
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(!editing);
  const [line, setLine] = useState(editing ? '想换成什么颜色？' : '把你喜欢的感觉，留在这里。');
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const request = useRef<AbortController | undefined>(undefined);
  usePreventRemove(transitioning, () => {});
  const change = async (input: string) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      await closeKeyboard();
      const next = await runtime.themes.interpret(input, record?.preference, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setLine(`那就换成「${themeName(next.preference)}」。`);
      await apply(
        next,
        (signal) =>
          editing
            ? runtime.themes.save(next, signal)
            : runtime.themes.completeOpening(next, signal),
        controller.signal,
      );
      if (mounted.current && !controller.signal.aborted) setLine('好了，换个心情。');
    } catch (e) {
      if (mounted.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : '没换好，再试一下。');
    } finally {
      if (request.current === controller) request.current = undefined;
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    let live = true;
    if (editing) {
      setDescription(record?.description ?? '');
      setBusy(false);
    } else {
      void runtime.themes
        .opening()
        .then((input) => {
          if (!live) return;
          if (input) {
            setDescription(input);
            void change(input);
          } else setBusy(false);
        })
        .catch(() => {
          if (live) {
            setError('读取颜色偏好失败');
            setBusy(false);
          }
        });
    }
    return () => {
      live = false;
      mounted.current = false;
      request.current?.abort();
    };
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps -- initialize on entry, not palette updates
  return (
    <Page>
      <View style={{ paddingTop: 24, gap: 20 }}>
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
        {editing || error ? (
          <>
            <Field
              label="颜色和感觉"
              placeholder="比如：淡蓝色，安静一点"
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={500}
              editable={!busy}
            />
            <Button
              title={busy ? '正在换色…' : '换成这个颜色'}
              disabled={busy || !description.trim()}
              onPress={() => void change(description)}
            />
          </>
        ) : null}
        {busy ? <Note>{transitioning ? '颜色正在慢慢铺开…' : '正在听你说…'}</Note> : null}
        <ErrorText text={error} />
        {busy && !transitioning ? (
          <Button title="取消" secondary onPress={() => request.current?.abort()} />
        ) : null}
        {!editing ? (
          <Button
            title={error ? '先用原来的颜色，继续' : '去认识她'}
            disabled={busy || transitioning}
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
        ) : null}
      </View>
    </Page>
  );
}
