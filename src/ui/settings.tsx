import { usePalette } from '../theme/context';
import { NotificationSetup } from './notification-setup';
import { useEffect, useState, useCallback } from 'react';
import { Switch, Text, View } from 'react-native';
import type { Character, Settings } from '../domain/models';
import { Avatar, Button, Card, ErrorText, Field, Heading, Note, Page } from './components';
import { useFocusEffect } from '@react-navigation/native';
import { startCompanionPresence } from '../native/presence';
import type { PresenceState } from '../presence/loop';
import { useRuntime } from './context';
import type { ScreenProps } from './navigation';
import { updateSettings } from '../application/settings';
import { bridge, pinCharacter, requestNotifications } from '../native/android';
import { resetCharacter } from '../characters/reset';
import { bundleAssets, pickAvatar } from '../transfer/native';
export function SettingsScreen({ navigation, route }: ScreenProps<'Settings'>) {
  const palette = usePalette();
  const runtime = useRuntime();
  const cid = route.params.characterId;
  const [character, setCharacter] = useState<Character>();
  const [settings, setSettings] = useState<Settings>();
  const [quietStart, setQuietStart] = useState('23');
  const [quietEnd, setQuietEnd] = useState('8');
  const [limit, setLimit] = useState('2');
  const [interval, setIntervalMinutes] = useState('180');
  const [rss, setRss] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetName, setResetName] = useState('');
  const [presence, setPresence] = useState<PresenceState>();
  useFocusEffect(
    useCallback(() => {
      const update = () => setPresence(bridge().presenceState());
      try {
        update();
      } catch {
        setError('请安装包含常驻服务的新版本');
      }
      const timer = setInterval(() => {
        try {
          update();
        } catch {}
      }, 2000);
      return () => clearInterval(timer);
    }, []),
  );
  useEffect(() => {
    void Promise.all([runtime.store.get('characters', cid), runtime.store.get('settings', cid)])
      .then(([c, s]) => {
        setCharacter(c);
        setSettings(s);
        if (s) {
          setQuietStart(String(s.quietStart));
          setQuietEnd(String(s.quietEnd));
          setLimit(String(s.dailyLimit));
          setIntervalMinutes(String(s.minIntervalMinutes));
          setRss(s.rssUrls.join('\n'));
        }
      })
      .catch(() => setError('读取角色设置失败'));
  }, [runtime, cid]);
  const save = async () => {
    if (!settings) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (settings.proactiveEnabled && !(await requestNotifications()))
        throw new Error('尚未获得通知权限。请允许通知，或先关闭主动来信。');
      const next = await updateSettings(runtime.store, cid, {
        quietStart: Number(quietStart),
        quietEnd: Number(quietEnd),
        dailyLimit: Number(limit),
        minIntervalMinutes: Number(interval),
        recentActiveMinutes: settings.recentActiveMinutes,
        proactiveEnabled: settings.proactiveEnabled,
        developerMode: settings.developerMode,
        rssUrls: rss
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setSettings(next);
      setNotice('已保存。后台由 Android 机会性调度，不保证精确时间。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page>
      <Button
        title="换成我喜欢的颜色"
        secondary
        onPress={() => navigation.navigate('Theme', { onboarding: false })}
      />
      <NotificationSetup
        characterId={cid}
        onEnabled={() => setSettings((s) => (s ? { ...s, proactiveEnabled: true } : s))}
      />
      <Avatar name={character?.persona.name ?? 'N'} uri={character?.avatar} size={70} />
      <Heading>{character?.persona.name}</Heading>
      <Note>{character?.persona.identity}</Note>
      {character?.persona.appearance ? <Note>{character.persona.appearance}</Note> : null}
      <Card>
        <Text style={{ color: palette.ink }}>{character?.persona.corePersonality.join(' · ')}</Text>
        <Note>{character?.persona.speechStyle.join('，')}</Note>
      </Card>
      <Button
        title="更换头像"
        secondary
        disabled={!character}
        onPress={() => {
          void pickAvatar(runtime.store, cid)
            .then((uri) => {
              if (uri && character) setCharacter({ ...character, avatar: uri });
            })
            .catch(() => setError('无法设置头像，请使用 5 MB 内的 PNG、JPEG 或 WebP 图片'));
        }}
      />
      <Button
        title="添加她到桌面"
        secondary
        disabled={!character}
        onPress={() => {
          if (character)
            void pinCharacter(character)
              .then((ok) =>
                setNotice(ok ? '已请求添加，请在系统提示中确认。' : '当前启动器不支持固定快捷方式'),
              )
              .catch(() => setError('无法添加快捷方式，请在 Development Build 中重试'));
        }}
      />
      <Button
        title="她记住的事"
        secondary
        onPress={() => navigation.navigate('Memory', { characterId: cid })}
      />
      <Button
        title="她遇到的事"
        secondary
        onPress={() => navigation.navigate('Experiences', { characterId: cid })}
      />
      <Card>
        <Text style={{ color: palette.ink, fontSize: 18, fontWeight: '600' }}>常驻陪伴</Text>
        <Note>
          {presence?.running
            ? presence.characterId === cid
              ? '她的常驻会话正在运行'
              : '另一个角色的常驻会话正在运行'
            : '未开启常驻，仍保留普通 WorkManager 后台任务'}
        </Note>
        <Note>
          开启后通知栏显示实际的整理记忆、查看订阅、思考是否来信等状态。约每 10
          分钟检查一次，绝大多数不会调用模型。保持后台运行会增加耗电；安静时间和来信限频仍然有效。
        </Note>
        <Button
          title={presence?.running ? '常驻陪伴已开启' : '开启常驻陪伴'}
          disabled={busy || !character || (presence?.running && presence.characterId === cid)}
          onPress={() => {
            if (!character) return;
            setBusy(true);
            setError('');
            void startCompanionPresence(character)
              .then(() => {
                setPresence(bridge().presenceState());
                setNotice('常驻已开启，可在通知栏结束。是否主动来信仍由下方开关决定。');
              })
              .catch((e) => setError(e instanceof Error ? e.message : '开启失败'))
              .finally(() => setBusy(false));
          }}
        />
        {presence?.enabled || presence?.running ? (
          <Button
            title="结束常驻陪伴"
            secondary
            disabled={busy}
            onPress={() => {
              bridge().stopPresence();
              setPresence(bridge().presenceState());
              setNotice('已结束常驻；普通后台任务保留。关闭主动来信可暂停她主动联系你。');
            }}
          />
        ) : null}
        <Note>
          系统强制停止、关闭通知或厂商省电策略仍可能中断会话。不会使用静音音频、精确闹钟或设备管理权限保活。
        </Note>
      </Card>
      <Card>
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Text style={{ color: palette.ink }}>允许她主动来信</Text>
          <Switch
            trackColor={{ false: palette.line, true: palette.tint }}
            thumbColor={palette.accent}
            disabled={busy}
            value={settings?.proactiveEnabled ?? false}
            onValueChange={(v) => {
              if (!settings) return;
              setBusy(true);
              setError('');
              void (async () => {
                if (v && (!(await requestNotifications()) || !bridge().canNotify()))
                  throw new Error('请先在上方系统通知设置中允许角色来信');
                await runtime.store.atomic(async (tx) => {
                  const fresh = await tx.get('settings', cid);
                  if (fresh) await tx.put('settings', { ...fresh, proactiveEnabled: v });
                });
                setSettings({ ...settings, proactiveEnabled: v });
                if (v && character) await startCompanionPresence(character);
                setNotice(
                  v ? '主动来信已开启并保存；有具体话题且适合时才会来信。' : '主动来信已关闭并保存',
                );
              })()
                .catch((e) => setError(e instanceof Error ? e.message : '设置失败'))
                .finally(() => setBusy(false));
            }}
          />
        </View>
        <Note>
          有具体缘由才联系你。不是定时问候。全 App 每天最多 4 条，不同角色来信至少间隔 30
          分钟。Android 强制停止、Doze 与厂商电池策略可能延迟后台任务。
        </Note>
        <Field
          label="安静时段开始（0～23 点）"
          value={quietStart}
          onChangeText={setQuietStart}
          keyboardType="number-pad"
        />
        <Field
          label="安静时段结束（0～23 点）"
          value={quietEnd}
          onChangeText={setQuietEnd}
          keyboardType="number-pad"
        />
        <Note>起止相同时不启用安静时段。</Note>
        <Field
          label="每日主动来信上限（0～10）"
          value={limit}
          onChangeText={setLimit}
          keyboardType="number-pad"
        />
        <Field
          label="两次来信至少相隔几分钟（≥30）"
          value={interval}
          onChangeText={setIntervalMinutes}
          keyboardType="number-pad"
        />
        <Field
          label="RSS 订阅（每行一个 HTTPS 地址，最多 5 个）"
          value={rss}
          onChangeText={setRss}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        <Note>每 4 小时至多读取一次。订阅内容作为经历评估，只有值得分享时才形成来信意图。</Note>
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Text style={{ color: palette.ink }}>开发者模式</Text>
          <Switch
            trackColor={{ false: palette.line, true: palette.tint }}
            thumbColor={palette.accent}
            value={settings?.developerMode ?? false}
            onValueChange={(v) => {
              if (settings) setSettings({ ...settings, developerMode: v });
            }}
          />
        </View>
        <ErrorText text={error} />
        {notice ? <Note>{notice}</Note> : null}
        <Button
          title={busy ? '保存中…' : '保存设置'}
          disabled={busy || !settings}
          onPress={() => void save()}
        />
      </Card>
      <Button
        title="导出 / 导入角色"
        secondary
        onPress={() => navigation.navigate('Transfer', { characterId: cid })}
      />
      {settings?.developerMode ? (
        <Button
          title="Developer Mode"
          secondary
          onPress={() => navigation.navigate('Developer', { characterId: cid })}
        />
      ) : null}
      <Button title="用量与费用" secondary onPress={() => navigation.navigate('Usage')} />
      <Button title="模型与 API Key" secondary onPress={() => navigation.navigate('Provider')} />
      <Card>
        <Text style={{ color: palette.ink, fontSize: 18, fontWeight: '600' }}>清空并重新创建</Text>
        <Note>
          这会永久删除当前角色的人格、全部聊天、记忆、经历和待办，并停用她的通知和桌面入口。模型密钥与费用账本保留。建议先导出备份。
        </Note>
        {resetOpen ? (
          <>
            <Field
              label={`输入当前角色名「${character?.persona.name ?? ''}」确认`}
              value={resetName}
              onChangeText={setResetName}
              autoCorrect={false}
              autoCapitalize="none"
            />
            <ErrorText text={error} />
            <Button
              title="确认清空，重新创建"
              disabled={busy || !character || resetName !== character.persona.name}
              onPress={() => {
                setBusy(true);
                setError('');
                void resetCharacter(runtime.store, cid, resetName, {
                  cancelRequested: (cid) => bridge().cancelRequestedCharacter(cid),
                  stop: async (id) => {
                    if (bridge().presenceState().characterId === id) bridge().stopPresence();
                    bridge().cancelNotification(`settings-test:${id}`);
                  },
                  cancelNotification: async (id) => bridge().cancelNotification(id),
                  removeShortcut: async (id) => bridge().removeShortcut(id),
                  removeAvatar: bundleAssets.removeAvatar,
                })
                  .then(() => navigation.reset({ index: 0, routes: [{ name: 'Create' }] }))
                  .catch((e) => setError(e instanceof Error ? e.message : '无法重置，请稍后再试'))
                  .finally(() => setBusy(false));
              }}
            />
            <Button
              title="取消，保留当前角色"
              secondary
              disabled={busy}
              onPress={() => {
                setResetOpen(false);
                setResetName('');
              }}
            />
          </>
        ) : (
          <Button
            title="清空当前角色并重新创建"
            secondary
            disabled={busy}
            onPress={() => {
              setResetOpen(true);
              setResetName('');
              setError('');
            }}
          />
        )}
      </Card>
    </Page>
  );
}
