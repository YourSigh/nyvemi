import { cleanupVisualAssets } from '../appearance/native';
import { usePalette } from '../theme/context';
import { NotificationSetup } from './notification-setup';
import { useState, useCallback, useLayoutEffect } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import type { PropsWithChildren } from 'react';
import type { Character, Settings } from '../domain/models';
import { Avatar, Button, Card, ErrorText, Field, Note, Page } from './components';
import { useFocusEffect } from '@react-navigation/native';
import { startCompanionPresence } from '../native/presence';
import type { PresenceState } from '../presence/loop';
import { useRuntime } from './context';
import type { ScreenProps } from './navigation';
import { updateSettings } from '../application/settings';
import { bridge, pinCharacter, requestNotifications } from '../native/android';
import { resetCharacter } from '../characters/reset';
import { bundleAssets, pickAvatar } from '../transfer/native';
function Row({ title, value, onPress }: { title: string; value?: string; onPress(): void }) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 12 }}
    >
      <Text style={{ color: palette.ink, fontSize: 16, flex: 1 }}>{title}</Text>
      {value ? <Text style={{ color: palette.muted, fontSize: 13 }}>{value}</Text> : null}
      <Text style={{ color: palette.muted, fontSize: 20 }}>›</Text>
    </Pressable>
  );
}
function Toggle({
  title,
  value,
  disabled,
  onChange,
  children,
}: PropsWithChildren<{
  title: string;
  value: boolean;
  disabled: boolean;
  onChange(value: boolean): void;
}>) {
  const palette = usePalette();
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: palette.ink, fontSize: 16 }}>{title}</Text>
        <Switch
          accessibilityLabel={title}
          trackColor={{ false: palette.line, true: palette.tint }}
          thumbColor={palette.accent}
          value={value}
          disabled={disabled}
          onValueChange={onChange}
        />
      </View>
      {children}
    </View>
  );
}
export function SettingsScreen({ navigation, route }: ScreenProps<'Settings'>) {
  const palette = usePalette();
  const runtime = useRuntime();
  const cid = route.params.characterId;
  const section = route.params.section;
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
  const [resetName, setResetName] = useState('');
  const [presence, setPresence] = useState<PresenceState>();
  useLayoutEffect(() => {
    navigation.setOptions({
      title: section
        ? {
            notifications: '来信与通知',
            preferences: '来信偏好',
            advanced: '高级设置',
            reset: '重新创建',
          }[section]
        : '设置',
    });
  }, [navigation, section]);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void Promise.all([runtime.store.get('characters', cid), runtime.store.get('settings', cid)])
        .then(([c, s]) => {
          if (!live) return;
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
        .catch(() => {
          if (live) setError('读取设置失败');
        });
      const update = () => {
        try {
          if (live) setPresence(bridge().presenceState());
        } catch {}
      };
      update();
      const timer = section === 'notifications' ? setInterval(update, 2000) : undefined;
      return () => {
        live = false;
        if (timer) clearInterval(timer);
      };
    }, [runtime, cid, section]),
  );
  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    act(async () => {
      const next = await updateSettings(
        runtime.store,
        cid,
        section === 'preferences'
          ? {
              quietStart: Number(quietStart),
              quietEnd: Number(quietEnd),
              dailyLimit: Number(limit),
              minIntervalMinutes: Number(interval),
            }
          : {
              rssUrls: rss
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
            },
      );
      setSettings(next);
      await runtime.syncIntentionWork();
      setNotice('已保存');
    });
  const open = (next: NonNullable<ScreenProps<'Settings'>['route']['params']['section']>) =>
    navigation.push('Settings', { characterId: cid, section: next });
  return (
    <Page>
      {!section ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="更换头像"
            onPress={() =>
              void act(async () => {
                const uri = await pickAvatar(runtime.store, cid);
                if (uri && character) setCharacter({ ...character, avatar: uri });
              })
            }
            style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 12 }}
          >
            <Avatar name={character?.persona.name ?? 'N'} uri={character?.avatar} size={64} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={{ color: palette.ink, fontSize: 22, fontWeight: '600' }}>
                {character?.persona.name}
              </Text>
              <Text numberOfLines={1} style={{ color: palette.muted }}>
                {character?.persona.corePersonality.slice(0, 3).join(' · ')}
              </Text>
            </View>
          </Pressable>
          <Card>
            <Row
              title="角色形象"
              onPress={() => navigation.navigate('Appearance', { characterId: cid })}
            />
            <Row
              title="她记住的事"
              onPress={() => navigation.navigate('Memory', { characterId: cid })}
            />
            <Row
              title="她遇到的事"
              onPress={() => navigation.navigate('Experiences', { characterId: cid })}
            />
            <Row
              title="添加她到桌面"
              onPress={() =>
                void act(async () => {
                  if (character)
                    setNotice(
                      (await pinCharacter(character))
                        ? '请在系统提示中确认'
                        : '当前桌面不支持快捷方式',
                    );
                })
              }
            />
          </Card>
          <Card>
            <Row
              title="来信与通知"
              value={settings?.proactiveEnabled ? '已开启' : '已关闭'}
              onPress={() => open('notifications')}
            />
            <Row title="来信偏好" onPress={() => open('preferences')} />
            <Row title="用量与费用" onPress={() => navigation.navigate('Usage')} />
            <Row title="模型连接" onPress={() => navigation.navigate('Provider')} />
          </Card>
          <Card>
            <Row
              title="导出 / 导入"
              onPress={() => navigation.navigate('Transfer', { characterId: cid })}
            />
            <Row title="高级设置" onPress={() => open('advanced')} />
          </Card>
        </>
      ) : section === 'notifications' ? (
        <>
          <Card>
            <Toggle
              title="允许她主动来信"
              value={settings?.proactiveEnabled ?? false}
              disabled={busy || !settings}
              onChange={(v) =>
                void act(async () => {
                  if (v && (!(await requestNotifications()) || !bridge().canNotify()))
                    throw new Error('请先开启系统通知');
                  setSettings(await updateSettings(runtime.store, cid, { proactiveEnabled: v }));
                  await runtime.syncIntentionWork();
                  if (v && character) await startCompanionPresence(character);
                })
              }
            />
            <Toggle
              title="常驻陪伴"
              value={Boolean(presence?.running && presence.characterId === cid)}
              disabled={busy || !character}
              onChange={(v) =>
                void act(async () => {
                  if (v && character) await startCompanionPresence(character);
                  else bridge().stopPresence();
                  setPresence(bridge().presenceState());
                })
              }
            >
              <Note>在通知栏显示她的状态，会增加耗电。</Note>
            </Toggle>
          </Card>
          <NotificationSetup characterId={cid} />
        </>
      ) : section === 'preferences' ? (
        <>
          <Card>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="安静时间 · 从"
                  value={quietStart}
                  onChangeText={setQuietStart}
                  keyboardType="number-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="到（0～23 点）"
                  value={quietEnd}
                  onChangeText={setQuietEnd}
                  keyboardType="number-pad"
                />
              </View>
            </View>
            <Note>起止相同则不设安静时段。</Note>
            <Field
              label="每天主动开启话题（0～10 次）"
              value={limit}
              onChangeText={setLimit}
              keyboardType="number-pad"
            />
            <Field
              label="主动话题间隔（至少 30 分钟）"
              value={interval}
              onChangeText={setIntervalMinutes}
              keyboardType="number-pad"
            />
            <Note>接着刚才聊的话题另计，最多 2 次/小时、6 次/天；设为 0 会同时关闭。</Note>
          </Card>
          <Button
            title={busy ? '保存中…' : '保存'}
            disabled={busy || !settings}
            onPress={() => void save()}
          />
        </>
      ) : section === 'advanced' ? (
        <>
          <Card>
            <Field
              label="订阅源（最多 5 个 HTTPS 地址，每行一个）"
              value={rss}
              onChangeText={setRss}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />
            <Button title="保存订阅" disabled={busy || !settings} onPress={() => void save()} />
          </Card>
          <Card>
            <Toggle
              title="开发者模式"
              value={settings?.developerMode ?? false}
              disabled={busy || !settings}
              onChange={(v) =>
                void act(async () => {
                  setSettings(await updateSettings(runtime.store, cid, { developerMode: v }));
                })
              }
            />
            {settings?.developerMode ? (
              <Row
                title="查看调试信息"
                onPress={() => navigation.navigate('Developer', { characterId: cid })}
              />
            ) : null}
          </Card>
          <Card>
            <Row title="清空当前角色并重新创建" onPress={() => open('reset')} />
          </Card>
        </>
      ) : (
        <>
          <Note>聊天、记忆、经历和角色设定将永久删除。建议先导出。</Note>
          <Field
            label={`输入「${character?.persona.name ?? ''}」确认`}
            value={resetName}
            onChangeText={setResetName}
            autoCorrect={false}
            autoCapitalize="none"
          />
          <Button
            title="确认清空并重新创建"
            disabled={busy || !character || resetName !== character.persona.name}
            onPress={() =>
              void act(async () => {
                await resetCharacter(runtime.store, cid, resetName, {
                  cancelRequested: (id) => bridge().cancelRequestedCharacter(id),
                  stop: async (id) => {
                    if (bridge().presenceState().characterId === id) bridge().stopPresence();
                    bridge().cancelNotification(`settings-test:${id}`);
                  },
                  cancelNotification: async (id) => bridge().cancelNotification(id),
                  removeShortcut: async (id) => bridge().removeShortcut(id),
                  removeAvatar: bundleAssets.removeAvatar,
                  removeAppearance: () => cleanupVisualAssets(runtime.store),
                });
                navigation.reset({ index: 0, routes: [{ name: 'Create' }] });
              })
            }
          />
        </>
      )}
      <ErrorText text={error} />
      {notice ? <Note>{notice}</Note> : null}
    </Page>
  );
}
