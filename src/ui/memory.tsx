import { usePalette } from '../theme/context';
import { useCallback, useState } from 'react';
import { Alert, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { Memory } from '../domain/models';
import { Button, Card, ErrorText, Heading, Note, Page } from './components';
import { useRuntime } from './context';
import type { ScreenProps } from './navigation';
const labels: Record<Memory['type'], string> = {
  semantic: '关于你',
  episodic: '共同经历',
  relationship: '相处偏好',
  open_loop: '还惦记着的事',
  experience: '她的经历',
};
export function MemoryScreen({ route }: ScreenProps<'Memory'>) {
  const palette = usePalette();
  const runtime = useRuntime();
  const cid = route.params.characterId;
  const [memories, setMemories] = useState<Memory[]>([]);
  const [error, setError] = useState('');
  const refresh = useCallback(
    () =>
      runtime.memories
        .list(cid)
        .then(setMemories)
        .catch(() => setError('读取记忆失败')),
    [runtime, cid],
  );
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  const forget = (m: Memory) =>
    Alert.alert('忘记这条记忆？', '这会删除本地的这条记忆。', [
      { text: '取消', style: 'cancel' },
      {
        text: '忘记',
        style: 'destructive',
        onPress: () => {
          void runtime.memories
            .remove(m.id)
            .then(refresh)
            .catch(() => setError('删除失败'));
        },
      },
    ]);
  return (
    <Page>
      <Heading>她记住的事</Heading>
      <Note>记忆来自你们的对话，也可能理解错。你可以让她忘记不想保留的内容。</Note>
      <ErrorText text={error} />
      {memories.length ? (
        memories.map((m) => (
          <Card key={m.id}>
            <Note>
              {labels[m.type]} · {new Date(m.createdAt).toLocaleDateString()}
            </Note>
            <Text style={{ color: palette.ink, fontSize: 16, lineHeight: 25 }}>{m.content}</Text>
            {m.type === 'open_loop' ? (
              <Button
                title="这件事已经结束"
                secondary
                onPress={() => {
                  void runtime.memories
                    .completeOpenLoop(cid, m.id)
                    .then(refresh)
                    .catch(() => setError('更新失败'));
                }}
              />
            ) : null}
            <Button title="忘记这条" secondary onPress={() => forget(m)} />
          </Card>
        ))
      ) : (
        <Note>还没有需要留下的记忆。先随意聊聊吧。</Note>
      )}
    </Page>
  );
}
