import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette } from '../theme/context';
import type { Intention } from '../domain/models';
import { closeKeyboard } from './keyboard';
export function ScheduledMessages({
  tasks,
  onCancel,
  onError,
}: {
  tasks: Intention[];
  onCancel(id: string): Promise<void>;
  onError(): void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string>();
  if (!tasks.length) return null;
  const time = (task: Intention) =>
    new Date(task.requestedDueAt ?? task.earliestAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="查看约定来信"
        onPress={() => {
          void closeKeyboard().then(() => setOpen(true));
        }}
        style={{ paddingHorizontal: 20, paddingVertical: 6 }}
      >
        <Text style={{ color: palette.muted, fontSize: 11 }}>
          约好 {time(tasks[0])} 来信{tasks.length > 1 ? ` · 共 ${tasks.length} 次` : ''}　›
        </Text>
      </Pressable>
      <Modal transparent visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭约定列表"
            onPress={() => setOpen(false)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: palette.ink,
              opacity: 0.16,
            }}
          />
          <View
            style={{
              backgroundColor: palette.background,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 24,
              paddingBottom: insets.bottom + 24,
              maxHeight: '55%',
            }}
          >
            <Text style={{ color: palette.ink, fontSize: 18, marginBottom: 16 }}>约定来信</Text>
            <ScrollView>
              {tasks.map((task) => (
                <View
                  key={task.id}
                  style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: 12 }}
                >
                  <Text style={{ flex: 1, color: palette.ink }}>
                    {time(task)}
                    {Date.now() >= task.earliestAt ? ' · 等待送达' : ''}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`取消 ${time(task)} 的约定`}
                    disabled={Boolean(busy)}
                    onPress={() => {
                      setBusy(task.id);
                      void onCancel(task.id)
                        .catch(onError)
                        .finally(() => setBusy(undefined));
                    }}
                    style={{ padding: 12 }}
                  >
                    <Text style={{ color: palette.accent }}>{busy === task.id ? '…' : '取消'}</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
