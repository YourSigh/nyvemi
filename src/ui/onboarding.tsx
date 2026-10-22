import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useRuntime } from './context';
import { Avatar, Button, Card, ErrorText, Field, Heading, Note, Page, Busy } from './components';
import { deepSeekPreset } from '../providers/provider';
import type { ScreenProps } from './navigation';
import { secretStore } from '../storage/native';
export function WelcomeScreen({ navigation }: ScreenProps<'Welcome'>) {
  return (
    <Page>
      <View style={{ paddingTop: 65, gap: 22 }}>
        <Avatar name="Nyvemi" size={76} />
        <Heading>Nyvemi</Heading>
        <Text style={{ fontSize: 20 }}>A life that remembers you.</Text>
        <Note>从一次认识开始。她会记住相处中的小事，也会在某个恰当的时刻想起你。</Note>
        <Card>
          <Note>
            人格与记忆留在这台设备。模型请求发送给你选择的 Provider，使用你自己的 API
            Key。这里的持续状态是行为模型，不代表意识。
          </Note>
        </Card>
        <Button
          title="开始认识她"
          onPress={() => navigation.navigate('Provider', { onboarding: true })}
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
      } else if (route.params?.onboarding) navigation.replace('Create');
      else {
        setNotice('已保存');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
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
      .then((c) =>
        navigation.reset({ index: 0, routes: [{ name: 'Chat', params: { characterId: c.id } }] }),
      )
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
