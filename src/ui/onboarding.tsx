import { usePalette } from '../theme/context';
import { startCompanionPresence } from '../native/presence';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRuntime } from './context';
import { Avatar, Button, Card, ErrorText, Field, Heading, Note, Page, Busy } from './components';
import { deepSeekPreset } from '../providers/provider';
import type { ScreenProps } from './navigation';
import { secretStore } from '../storage/native';
export function WelcomeScreen({ navigation }: ScreenProps<'Welcome'>) {
  const palette = usePalette();
  const runtime = useRuntime();
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    void runtime.themes
      .opening()
      .then((text) => {
        if (text) setDescription(text);
      })
      .catch(() => setError('读取开场偏好失败'));
  }, [runtime]);
  const continueOpening = async (skip = false) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      if (skip) await runtime.themes.clearOpening();
      else await runtime.themes.rememberOpening(description);
      navigation.navigate('Provider', { onboarding: true, skipTheme: skip });
    } catch {
      setError('没能保存这点小偏好，请再试一次');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <Page>
      <View style={{ paddingTop: 28, gap: 18 }}>
        <Avatar name="Nyvemi" size={68} />
        <Heading>Nyvemi</Heading>
        <Note>A life that remembers you.</Note>
        <Card>
          <Text style={{ color: palette.ink, fontSize: 23, lineHeight: 33 }}>
            你喜欢什么颜色呀？
          </Text>
          <Note>
            一种颜色，或者一种感觉都可以。温柔、清爽、安静、梦幻……我想让这里更像你喜欢的样子。
          </Note>
        </Card>
        <Field
          label="你喜欢的颜色和感觉"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={500}
          placeholder="淡淡的粉色，柔和一点，别太艳"
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {['淡粉色，柔和、不太艳', '蓝灰色，安静一点', '黑白灰，但是别太冷', '紫色，梦幻一点'].map(
            (text) => (
              <Pressable
                key={text}
                accessibilityRole="button"
                onPress={() => setDescription(text)}
                style={{ padding: 10, backgroundColor: palette.tint, borderRadius: 14 }}
              >
                <Text style={{ color: palette.accent }}>{text}</Text>
              </Pressable>
            ),
          )}
        </View>
        <Note>
          先记下这一小点。下一步连接你自己的模型，它会理解你的偏好；颜色选好后，再一起创造她。人格与记忆保存在本机。
        </Note>
        <ErrorText text={error} />
        <Button
          title="就这个感觉"
          disabled={busy || !description.trim()}
          onPress={() => void continueOpening()}
        />
        <Button
          title="先用现在的粉白色"
          secondary
          disabled={busy}
          onPress={() => void continueOpening(true)}
        />
        <Button
          title="从 Bundle 接她过来"
          secondary
          onPress={() => navigation.navigate('Transfer')}
        />
      </View>
    </Page>
  );
}
export function ProviderScreen({ navigation, route }: ScreenProps<'Provider'>) {
  const runtime = useRuntime();
  const [config, setConfig] = useState(deepSeekPreset);
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    void Promise.all([runtime.store.get('provider', 'provider'), secretStore.get()])
      .then(([saved, secret]) => {
        if (saved) setConfig(saved);
        setHasKey(Boolean(secret));
      })
      .catch(() => setError('无法读取 Provider 设置'));
  }, [runtime]);
  const save = async (test: boolean) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await runtime.saveProvider(config, key);
      setKey('');
      setHasKey(true);
      if (test) {
        await (
          await runtime.provider()
        ).chat([{ role: 'user', content: 'Reply with OK.' }], 'connection_test');
        setNotice('连接成功');
      } else if (route.params?.onboarding) {
        if (route.params.skipTheme) navigation.replace('Create');
        else navigation.replace('Theme', { onboarding: true, autoGenerate: true });
      } else {
        setNotice('已保存');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <Page>
      <Heading>连接你的模型</Heading>
      <Note>BYOK · 密钥保存在 Android 安全存储中。普通陪伴聊天默认关闭 thinking。</Note>
      <Button title="使用 DeepSeek 预设" secondary onPress={() => setConfig(deepSeekPreset)} />
      <Field
        label="Base URL"
        value={config.baseUrl}
        onChangeText={(baseUrl) => setConfig({ ...config, baseUrl })}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field
        label="Model Name"
        value={config.model}
        onChangeText={(model) => setConfig({ ...config, model })}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field
        label="API Key"
        value={key}
        onChangeText={setKey}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={hasKey ? '已保存，留空保留现有密钥' : '输入你的 API Key'}
      />
      <Note>
        DeepSeek 默认地址 https://api.deepseek.com，模型可自行修改。兼容接口填写服务商给出的 Base
        URL（通常以 /v1 结尾）。本地服务可填 local 作为占位密钥。
      </Note>
      <Button title="查看用量与费用" secondary onPress={() => navigation.navigate('Usage')} />
      <ErrorText text={error} />
      {notice ? <Note>{notice}</Note> : null}
      <Button
        title={busy ? '连接中…' : route.params?.onboarding ? '保存并创建角色' : '保存设置'}
        disabled={busy}
        onPress={() => void save(false)}
      />
      <Button
        title="测试连接（会发起一次模型请求）"
        disabled={busy}
        secondary
        onPress={() => void save(true)}
      />
    </Page>
  );
}
export function GenerateScreen({ navigation, route }: ScreenProps<'Generate'>) {
  const runtime = useRuntime();
  const started = useRef(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (
      route.params.interview
        ? runtime.interview.finish()
        : runtime.characters.create(route.params.answers, route.params.demo)
    )
      .then(async (c) => {
        if ((await runtime.store.get('settings', c.id))?.proactiveEnabled)
          await startCompanionPresence(c).catch(() => undefined);
        navigation.reset({ index: 0, routes: [{ name: 'Chat', params: { characterId: c.id } }] });
      })
      .catch((e) => setError(e instanceof Error ? e.message : '角色生成失败'));
  }, [runtime, navigation, route.params, attempt]);
  return (
    <Page>
      <Heading>一次新的相遇</Heading>
      {error ? (
        <>
          <ErrorText text={error} />
          <Button
            title="重新生成"
            onPress={() => {
              started.current = false;
              setError('');
              setAttempt((n) => n + 1);
            }}
          />
        </>
      ) : (
        <Busy label="正在形成她的人格，稍等一会儿…" />
      )}
    </Page>
  );
}
