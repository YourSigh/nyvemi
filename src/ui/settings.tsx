import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import type { Character, Settings } from '../domain/models';
import { Avatar, Button, Card, ErrorText, Field, Heading, Note, Page } from './components';
import { useRuntime } from './context';
import type { ScreenProps } from './navigation';
import { updateSettings } from '../application/settings';
import { pinCharacter, requestNotifications } from '../native/android';
import { pickAvatar } from '../transfer/native';
export function SettingsScreen({ navigation, route }: ScreenProps<'Settings'>) {
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
      <Avatar name={character?.persona.name ?? 'N'} uri={character?.avatar} size={70} />
      <Heading>{character?.persona.name}</Heading>
      <Note>{character?.persona.identity}</Note>
      <Card>
        <Text>{character?.persona.corePersonality.join(' · ')}</Text>
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
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Text>允许她主动来信</Text>
          <Switch
            trackColor={{ false: '#EADDE3', true: '#EFBBD0' }}
            thumbColor="#D86B96"
            value={settings?.proactiveEnabled ?? false}
            onValueChange={(v) => {
              if (settings) setSettings({ ...settings, proactiveEnabled: v });
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
          <Text>开发者模式</Text>
          <Switch
            trackColor={{ false: '#EADDE3', true: '#EFBBD0' }}
            thumbColor="#D86B96"
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
      <Button title="模型与 API Key" secondary onPress={() => navigation.navigate('Provider')} />
      <Button title="切换或创建角色" secondary onPress={() => navigation.navigate('Characters')} />
    </Page>
  );
}
export function CharactersScreen({ navigation }: ScreenProps<'Characters'>) {
  const runtime = useRuntime();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void runtime.store
      .list('characters')
      .then(setCharacters)
      .catch(() => setError('读取角色失败'));
  }, [runtime]);
  return (
    <Page>
      <Heading>相遇的人</Heading>
      <ErrorText text={error} />
      {characters.map((c) => (
        <Card key={c.id}>
          <Avatar name={c.persona.name} uri={c.avatar} />
          <Button
            title={c.persona.name}
            secondary
            onPress={() => navigation.replace('Chat', { characterId: c.id })}
          />
          <Note>{c.persona.identity}</Note>
        </Card>
      ))}
      <Button title="认识新的角色" onPress={() => navigation.navigate('Create')} />
    </Page>
  );
}
