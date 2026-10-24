import { deliveryReport, deliverySummary } from '../proactive/delivery-report';
import { usePalette } from '../theme/context';
import { useCallback, useState } from 'react';
import { AppState, Pressable, Share, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { bridge, requestNotifications } from '../native/android';
import { useRuntime } from './context';
import { Button, Card, ErrorText, Note } from './components';
export function NotificationSetup({ characterId }: { characterId: string }) {
  const palette = usePalette();
  const runtime = useRuntime();
  const [allowed, setAllowed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [health, setHealth] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const report = useCallback(
    () =>
      deliveryReport(runtime.store, characterId, (id) => bridge().intentionWorkState(id), {
        notifications: bridge().canNotify(),
        online: bridge().hasNetwork(),
        presenceRunning: bridge().presenceState().running,
      }),
    [runtime, characterId],
  );
  const refresh = useCallback(async () => {
    setAllowed(bridge().canNotify());
    if (expanded) setHealth(deliverySummary(await report()));
  }, [expanded, report]);
  useFocusEffect(
    useCallback(() => {
      const update = () => void refresh().catch(() => setError('无法读取通知状态'));
      update();
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') update();
      });
      const timer = expanded ? setInterval(update, 15000) : undefined;
      return () => {
        sub.remove();
        if (timer) clearInterval(timer);
      };
    }, [refresh, expanded]),
  );
  const act = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
      await refresh();
    } catch {
      setError('操作未完成，请稍后重试');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Card>
        <Text style={{ color: palette.ink, fontSize: 16 }}>
          {allowed ? '系统通知已开启' : '系统通知未开启'}
        </Text>
        {!allowed ? (
          <>
            <Note>请允许通知，并打开「角色来信」。</Note>
            <Button
              title="开启通知"
              disabled={busy}
              onPress={() =>
                void act(async () => {
                  if (!(await requestNotifications())) await bridge().openNotificationSettings();
                })
              }
            />
          </>
        ) : null}
        <Button
          title="系统通知设置"
          secondary
          onPress={() => void act(() => bridge().openNotificationSettings())}
        />
        <Button
          title="后台电池设置"
          secondary
          onPress={() => void act(() => bridge().openBatterySettings())}
        />
        <Note>后台收不到来信时，可允许后台运行或选择「不限制」。</Note>
      </Card>
      <Card>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((v) => !v)}
          style={{ paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between' }}
        >
          <Text style={{ color: palette.ink, fontSize: 16 }}>来信故障排查</Text>
          <Text style={{ color: palette.muted }}>{expanded ? '收起' : '展开'}</Text>
        </Pressable>
        {expanded ? (
          <View style={{ gap: 12 }}>
            <Note>{health}</Note>
            <Note>后台受省电和网络影响，可能延迟。强行停止后需重新打开 App。</Note>
            <Button
              title="测试通知"
              secondary
              disabled={busy || !allowed}
              onPress={() =>
                void act(async () => {
                  const c = await runtime.store.get('characters', characterId);
                  if (!c) return;
                  if (
                    !(await bridge().notify(
                      `settings-test:${characterId}`,
                      characterId,
                      c.persona.name,
                      '[通知测试] 点开回到聊天。',
                      c.avatar ?? null,
                    ))
                  )
                    throw new Error('Notification failed');
                })
              }
            />
            <Button
              title="修复后台任务"
              secondary
              disabled={busy}
              onPress={() => void act(() => runtime.syncIntentionWork())}
            />
            <Button
              title="分享来信诊断"
              secondary
              disabled={busy}
              onPress={() =>
                void act(async () =>
                  Share.share({
                    message: JSON.stringify(await report(), null, 2),
                    title: 'Nyvemi 来信诊断',
                  }),
                )
              }
            />
            <Note>诊断不含聊天内容和密钥。</Note>
          </View>
        ) : null}
        <ErrorText text={error} />
      </Card>
    </>
  );
}
