import { usePalette } from '../theme/context';
import { useCallback, useState } from 'react';
import { AppState, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { bridge, requestNotifications } from '../native/android';
import { startCompanionPresence } from '../native/presence';
import { proactiveReadiness, proactiveReason } from '../proactive/readiness';
import { useRuntime } from './context';
import { Button, Card, ErrorText, Note } from './components';
export function NotificationSetup({
  characterId,
  onEnabled,
}: {
  characterId: string;
  onEnabled?: () => void;
}) {
  const palette = usePalette();
  const runtime = useRuntime();
  const [allowed, setAllowed] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [reason, setReason] = useState('正在检查来信状态…');
  const [latest, setLatest] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const permission = bridge().canNotify();
    setAllowed(permission);
    const settings = await runtime.store.get('settings', characterId);
    if (!settings) return;
    setEnabled(settings.proactiveEnabled);
    setReason(
      proactiveReadiness(
        settings,
        await runtime.store.list('intentions', characterId, 10000),
        await runtime.store.list('notifications', undefined, 10000),
        permission,
        Date.now(),
      ),
    );
    const decision = (await runtime.store.list('diagnostics', characterId, 200)).find(
      (d) => d.kind === 'heartbeat',
    );
    setLatest(
      decision
        ? `上次检查 ${new Date(decision.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}：${proactiveReason(String(decision.data.reason))}`
        : '后台还未完成首次检查',
    );
  }, [runtime, characterId]);
  useFocusEffect(
    useCallback(() => {
      const update = () => void refresh().catch(() => setError('无法读取通知状态'));
      update();
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') update();
      });
      const timer = setInterval(update, 15000);
      return () => {
        sub.remove();
        clearInterval(timer);
      };
    }, [refresh]),
  );
  return (
    <Card>
      <Text style={{ color: palette.ink, fontSize: 18, fontWeight: '600' }}>通知与主动来信</Text>
      <Note>{allowed ? '系统与角色来信通知：已开启' : '系统通知或角色来信渠道：未开启'}</Note>
      <Note>{reason}</Note>
      <Note>{latest}</Note>
      <Note>
        进入 App
        会申请通知权限。若曾拒绝，请进入系统通知设置，打开“允许通知”和“角色来信”，按需要开启横幅、声音与锁屏显示。刚聊天、安静时段或没有具体话题时，她不会强行发消息。
      </Note>
      {!allowed ? (
        <Button
          title="申请通知权限"
          disabled={busy}
          onPress={() => {
            setBusy(true);
            void requestNotifications()
              .then((ok) => {
                if (!ok) setError('系统未允许通知，请点击下方按钮手动开启。');
                return refresh();
              })
              .catch(() => setError('申请失败，请打开系统通知设置'))
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
      {!enabled ? (
        <Button
          title="开启主动来信与常驻陪伴"
          disabled={busy}
          onPress={() => {
            setBusy(true);
            setError('');
            void (async () => {
              if (!(await requestNotifications()) || !bridge().canNotify())
                throw new Error('请先在系统设置中允许角色来信通知');
              const c = await runtime.store.get('characters', characterId);
              if (!c) return;
              await runtime.store.atomic(async (tx) => {
                const s = await tx.get('settings', characterId);
                if (s) await tx.put('settings', { ...s, proactiveEnabled: true });
              });
              onEnabled?.();
              await startCompanionPresence(c);
              await refresh();
            })()
              .catch((e) => setError(e instanceof Error ? e.message : '开启失败'))
              .finally(() => setBusy(false));
          }}
        />
      ) : null}
      <Button
        title="发送一条通知测试（不调用模型）"
        secondary
        disabled={busy || !allowed}
        onPress={() => {
          setBusy(true);
          setError('');
          void (async () => {
            const c = await runtime.store.get('characters', characterId);
            if (!c) return;
            const sent = await bridge().notify(
              `settings-test:${characterId}`,
              characterId,
              c.persona.name,
              '[通知测试] 这是一条系统通知测试，点开回到聊天。',
              c.avatar ?? null,
            );
            if (!sent) throw new Error('系统未接受通知');
            setError('');
          })()
            .catch(() => setError('通知未送达，请检查系统通知与角色来信渠道'))
            .finally(() => setBusy(false));
        }}
      />
      <Note>通知测试只用于检查系统显示，不是 AI 的主动回复，不会写进聊天。</Note>
      <Button
        title="打开系统通知设置"
        secondary
        onPress={() =>
          void bridge()
            .openNotificationSettings()
            .catch(() => setError('无法打开系统设置'))
        }
      />
      <Button
        title="查看系统电池优化设置"
        secondary
        onPress={() =>
          void bridge()
            .openBatterySettings()
            .catch(() => setError('无法打开系统设置'))
        }
      />
      <Note>
        若后台收不到消息，在系统 App
        电池设置选择允许后台运行／不限制；部分手机还需允许自启动。是否放宽省电由你决定。
      </Note>
      <ErrorText text={error} />
    </Card>
  );
}
