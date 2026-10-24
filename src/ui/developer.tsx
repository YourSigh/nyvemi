import { deliveryReport } from '../proactive/delivery-report';
import { usePalette } from '../theme/context';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as BackgroundTask from 'expo-background-task';
import { id, type NotificationRecord } from '../domain/models';
import { androidNotifications, bridge } from '../native/android';
import { runBackgroundCycle } from '../proactive/heartbeat/driver';
import { HEARTBEAT_TASK } from '../native/background';
import * as TaskManager from 'expo-task-manager';
import { useRuntime } from './context';
import { Button, Card, ErrorText, Heading, Note, Page } from './components';
import type { ScreenProps } from './navigation';
export function DeveloperScreen({ route }: ScreenProps<'Developer'>) {
  const palette = usePalette();
  const runtime = useRuntime();
  const cid = route.params.characterId;
  const [allowed, setAllowed] = useState(false);
  const [snapshot, setSnapshot] = useState<Record<string, unknown>>({});
  const [tab, setTab] = useState('人格');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const settings = await runtime.store.get('settings', cid);
    setAllowed(settings?.developerMode ?? false);
    if (!settings?.developerMode) return;
    const character = await runtime.store.get('characters', cid);
    const diagnostics = await runtime.store.list('diagnostics', undefined, 200);
    setSnapshot({
      人格: character?.persona,
      状态: character?.state,
      兴趣: character?.interests,
      记忆: await runtime.store.list('memories', cid, 60),
      检索: diagnostics.filter((d) => d.characterId === cid && d.kind === 'retrieval'),
      未完事件: (await runtime.store.list('memories', cid, 100)).filter(
        (m) => m.type === 'open_loop',
      ),
      未来意图: await runtime.store.list('intentions', cid, 100),
      经历与评估: await runtime.store.list('experiences', cid, 60),
      Heartbeat: diagnostics.filter((d) => d.characterId === cid && d.kind === 'heartbeat'),
      通知历史: await runtime.store.list('notifications', cid, 60),
      'API Usage': diagnostics.filter((d) => d.kind === 'api'),
      Prompt: diagnostics.filter((d) => d.characterId === cid && d.kind === 'prompt'),
      Error: diagnostics.filter((d) => d.kind === 'error'),
      抽取队列: await runtime.store.list('extractions', cid, 60),
      后台注册: await TaskManager.getRegisteredTasksAsync(),
      常驻状态: bridge().presenceState(),
      来信执行链路: await deliveryReport(
        runtime.store,
        cid,
        (id) => bridge().intentionWorkState(id),
        {
          notifications: bridge().canNotify(),
          online: bridge().hasNetwork(),
          presenceRunning: bridge().presenceState().running,
        },
      ),
    });
  }, [runtime, cid]);
  useFocusEffect(
    useCallback(() => {
      void refresh().catch(() => setError('读取调试信息失败'));
    }, [refresh]),
  );
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch {
      setError('调试操作失败，请检查最近 Error 与系统日志。');
    } finally {
      setBusy(false);
    }
  };
  const testNotification = async () => {
    const character = await runtime.store.get('characters', cid);
    if (!character) throw new Error('角色不存在');
    if (!(await androidNotifications.enabled())) throw new Error('请先允许通知');
    const now = Date.now();
    const record: NotificationRecord = {
      id: id(),
      characterId: cid,
      messageId: id(),
      title: character.persona.name,
      body: '[开发测试] 这是一条本地角色通知，点开应进入当前角色聊天。',
      createdAt: now,
      status: 'pending',
    };
    await runtime.store.atomic(async (tx) => {
      await tx.put('messages', {
        id: record.messageId,
        characterId: cid,
        role: 'assistant',
        origin: 'proactive',
        content: record.body,
        status: 'pending',
        createdAt: now,
      });
      await tx.put('notifications', record);
    });
    await androidNotifications.show(record, character);
    await runtime.store.put('notifications', { ...record, status: 'delivered' });
  };
  if (!allowed)
    return (
      <Page>
        <Heading>Developer Mode</Heading>
        <Note>请先在角色设置中开启并保存开发者模式。</Note>
      </Page>
    );
  return (
    <Page>
      <Heading>她为什么这么做</Heading>
      <Note>
        仅本机调试。Prompt
        和检索日志可能包含私人对话；不包含密钥。普通用户页面不会显示这些数值。最多保留最近 200
        条诊断。
      </Note>
      <ErrorText text={error} />
      <View style={{ gap: 8 }}>
        <Button title="刷新" secondary disabled={busy} onPress={() => void run(refresh)} />
        <Button
          title="执行 Heartbeat（必要时调用模型）"
          secondary
          disabled={busy}
          onPress={() => void run(() => runtime.heartbeat.run())}
        />
        <Button
          title="执行完整后台周期（可能产生 API 费用）"
          secondary
          disabled={busy}
          onPress={() => void run(() => runBackgroundCycle(runtime))}
        />
        {__DEV__ ? (
          <Button
            title="触发真实 WorkManager Worker（Debug）"
            secondary
            disabled={busy}
            onPress={() =>
              void run(async () => {
                if (!(await TaskManager.isTaskRegisteredAsync(HEARTBEAT_TASK)))
                  throw new Error('未注册');
                await BackgroundTask.triggerTaskWorkerForTestingAsync();
              })
            }
          />
        ) : null}
        <Button
          title="发送本地测试通知（无模型调用）"
          secondary
          disabled={busy}
          onPress={() => void run(testNotification)}
        />
        <Button
          title="重试失败的记忆抽取（可能产生 API 费用）"
          secondary
          disabled={busy}
          onPress={() =>
            void run(async () => {
              for (const job of await runtime.store.list('extractions', cid, 10000))
                if (job.status === 'failed')
                  await runtime.store.put('extractions', {
                    ...job,
                    status: 'pending',
                    attempts: 0,
                    nextAttemptAt: Date.now(),
                  });
              await runtime.extraction.drain();
            })
          }
        />
        <Button
          title="清除诊断日志"
          secondary
          disabled={busy}
          onPress={() =>
            Alert.alert('清除诊断日志？', '不会清除人格、记忆或聊天。', [
              { text: '取消', style: 'cancel' },
              {
                text: '清除',
                style: 'destructive',
                onPress: () =>
                  void run(async () => {
                    for (const d of await runtime.store.list('diagnostics', undefined, 10000))
                      if (d.characterId === cid || d.characterId === '')
                        await runtime.store.remove('diagnostics', d.id);
                  }),
              },
            ])
          }
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {Object.keys(snapshot).map((key) => (
            <Button key={key} title={key} secondary={tab !== key} onPress={() => setTab(key)} />
          ))}
        </View>
      </ScrollView>
      <Card>
        <Text
          selectable
          style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 19, color: palette.ink }}
        >
          {JSON.stringify(snapshot[tab] ?? null, null, 2)}
        </Text>
      </Card>
    </Page>
  );
}
