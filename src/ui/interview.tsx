import { usePalette } from '../theme/context';
import type { Palette } from '../theme/model';
import { useHeaderHeight } from '@react-navigation/elements';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { interviewQuestions, type InterviewDraft } from '../characters/interview';
import { defaultAnswers, type CharacterAnswers } from '../characters/service';
import { useRuntime } from './context';
import { Avatar, Button, Card, ErrorText, Field, Note, Busy } from './components';
import type { ScreenProps } from './navigation';
export function InterviewScreen({ navigation }: ScreenProps<'Create'>) {
  const palette = usePalette();
  const s = useMemo(() => createStyles(palette), [palette]);
  const runtime = useRuntime();
  const headerHeight = useHeaderHeight();
  const [draft, setDraft] = useState<InterviewDraft>();
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<keyof CharacterAnswers>();
  const [editText, setEditText] = useState('');
  const scroll = useRef<ScrollView>(null);
  const load = () =>
    runtime.interview
      .clearFinished()
      .then(() => runtime.interview.load())
      .then((d) => {
        setDraft(d);
        setAnswer(d.pendingAnswer ?? '');
      });
  useEffect(() => {
    void load().catch(() => setError('无法读取访谈草稿'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (skip = false) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      setDraft(await runtime.interview.answer(answer, skip));
      setAnswer('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，答案仍在本机');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const finished = !!draft && draft.step >= interviewQuestions.length;
  const question = draft ? interviewQuestions[draft.step] : undefined;
  return (
    <SafeAreaView edges={['bottom']} style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>{finished ? '她的轮廓已经清晰了' : '一起拼出她的样子'}</Text>
        <Note>
          {finished
            ? '12 / 12 · 可以回看修改，再正式开始'
            : `${draft?.step ?? 0} / 12 已完成 · 约 3～5 分钟 · 除名字外可跳过`}
        </Note>
        <View style={s.track}>
          <View
            style={[
              s.fill,
              { width: `${((draft?.step ?? 0) / interviewQuestions.length) * 100}%` },
            ]}
          />
        </View>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={headerHeight}
      >
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={s.thread}
          onContentSizeChange={() => {
            if (!finished) scroll.current?.scrollToEnd({ animated: true });
          }}
        >
          {!draft ? (
            <>
              <Busy label="接着上次的地方…" />
              <ErrorText text={error} />
              {error ? (
                <Button
                  title="重试读取"
                  onPress={() => void load().catch(() => setError('读取失败'))}
                />
              ) : null}
            </>
          ) : null}
          {draft?.turns.map((turn, i) => (
            <View key={i} style={[s.row, turn.role === 'user' && s.mine]}>
              {turn.role === 'assistant' ? <Avatar name="Nyvemi" size={32} /> : null}
              <View style={[s.bubble, turn.role === 'user' && { backgroundColor: palette.tint }]}>
                <Text style={s.message}>{turn.content}</Text>
                {turn.localFallback ? (
                  <Text style={s.fallback}>网络回应暂不可用，已用本地引导继续</Text>
                ) : null}
              </View>
            </View>
          ))}
          {finished && draft ? (
            <View style={{ gap: 12 }}>
              <Note>这是共同写下的设定。正式创建后，对话中的反馈仍会慢慢塑造她。</Note>
              {interviewQuestions.map((q) => (
                <Card key={q.key}>
                  <Text style={{ color: palette.ink, fontWeight: '600' }}>{q.question}</Text>
                  {editing === q.key ? (
                    <>
                      <Field
                        label="修改答案"
                        value={editText}
                        onChangeText={setEditText}
                        multiline
                        maxLength={q.key === 'name' ? 80 : 1000}
                      />
                      <Button
                        title="保存修改"
                        onPress={() => {
                          void runtime.interview
                            .revise(q.key, editText)
                            .then((d) => {
                              setDraft(d);
                              setEditing(undefined);
                              setError('');
                            })
                            .catch(() => setError('修改失败，请检查名字和答案长度'));
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <Text style={s.message}>{draft.answers[q.key] || '留白'}</Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          setEditing(q.key);
                          setEditText(draft.answers[q.key]);
                        }}
                      >
                        <Text style={{ color: palette.accent }}>修改这一项</Text>
                      </Pressable>
                    </>
                  )}
                </Card>
              ))}
            </View>
          ) : null}
          {draft?.step === 0 ? (
            <Button
              title="开发测试：直接使用桶砸"
              secondary
              onPress={() =>
                navigation.navigate('Generate', {
                  answers: { ...defaultAnswers, name: '桶砸' },
                  demo: true,
                })
              }
            />
          ) : null}
        </ScrollView>
        {draft ? (
          <View style={s.composer}>
            <ErrorText text={error} />
            {finished ? (
              <Button
                title="正式认识她"
                disabled={!!editing || busy}
                onPress={() =>
                  navigation.navigate('Generate', {
                    answers: draft.answers,
                    demo: false,
                    interview: true,
                  })
                }
              />
            ) : (
              <>
                <TextInput
                  accessibilityLabel={`第 ${draft.step + 1} 题的回答`}
                  style={s.input}
                  value={answer}
                  onChangeText={setAnswer}
                  editable={!busy}
                  multiline
                  maxLength={question?.key === 'name' ? 80 : 1000}
                  placeholder="说说你心里的样子…"
                  placeholderTextColor={palette.muted}
                  selectionColor={palette.accent}
                  cursorColor={palette.accent}
                />
                {busy ? (
                  <Note>正在听你说，也在整理下一笔…</Note>
                ) : question?.choices ? (
                  <View style={s.choices}>
                    {question.choices.map((c) => (
                      <Pressable
                        key={c}
                        accessibilityRole="button"
                        onPress={() => setAnswer(c)}
                        style={s.chip}
                      >
                        <Text style={{ color: palette.accent }}>{c}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title={
                        busy ? '正在回应…' : draft.step === 11 ? '完成最后一题' : '回答，继续下一题'
                      }
                      disabled={busy || !answer.trim()}
                      onPress={() => void send()}
                    />
                  </View>
                  {!question?.required ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void send(true)}
                    >
                      <Text style={{ color: palette.muted, padding: 8 }}>先跳过</Text>
                    </Pressable>
                  ) : null}
                </View>
              </>
            )}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const createStyles = (palette: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: palette.background },
    header: { padding: 18, gap: 8, borderBottomWidth: 1, borderColor: palette.line },
    title: { fontSize: 22, fontWeight: '600', color: palette.ink },
    track: { height: 5, borderRadius: 3, backgroundColor: palette.line, overflow: 'hidden' },
    fill: { height: 5, backgroundColor: palette.accent },
    thread: { padding: 18, gap: 18, paddingBottom: 28 },
    row: { flexDirection: 'row', gap: 8 },
    mine: { justifyContent: 'flex-end' },
    bubble: {
      maxWidth: '86%',
      backgroundColor: palette.paper,
      padding: 14,
      borderRadius: 16,
      gap: 8,
    },
    message: { fontSize: 16, color: palette.ink, lineHeight: 25 },
    fallback: { fontSize: 11, color: palette.muted },
    composer: { padding: 12, gap: 10, borderTopWidth: 1, borderColor: palette.line },
    input: {
      minHeight: 48,
      maxHeight: 110,
      backgroundColor: palette.paper,
      borderRadius: 12,
      padding: 12,
      color: palette.ink,
      fontSize: 16,
      textAlignVertical: 'top',
    },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      maxWidth: '100%',
      flexShrink: 1,
      padding: 10,
      borderRadius: 12,
      backgroundColor: palette.tint,
    },
  });
