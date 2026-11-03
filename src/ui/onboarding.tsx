import { useTheme } from '../theme/context';
import { closeKeyboard } from './keyboard';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useRuntime } from './context';
import {
  Avatar,
  Button,
  Card,
  ErrorText,
  Field,
  Heading,
  Note,
  Page,
  Busy,
  Details,
  TextButton,
} from './components';
import { deepSeekPreset } from '../providers/provider';
import type { ScreenProps } from './navigation';
import { secretStore } from '../storage/native';
export function WelcomeScreen({ navigation }: ScreenProps<'Welcome'>) {
  const { palette, record, apply, transitioning } = useTheme();
  const runtime = useRuntime();
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [modelOption, setModelOption] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    let live = true;
    void runtime.themes
      .opening()
      .then((text) => {
        if (live && text) setDescription(text);
      })
      .catch(() => {
        if (live) setError('读取开场偏好失败');
      });
    return () => {
      live = false;
      mounted.current = false;
      request.current?.abort();
    };
  }, [runtime]);
  const continueOpening = async (skip = false, deferToModel = false) => {
    if (submitting.current) return;
    submitting.current = true;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setModelOption(false);
    let interpreted = skip || deferToModel;
    try {
      await closeKeyboard();
      if (deferToModel) await runtime.themes.rememberOpening(description);
      else if (skip) await runtime.themes.completeOpening(undefined, controller.signal);
      else {
        const next = await runtime.themes.interpret(
          description,
          record?.preference,
          controller.signal,
        );
        interpreted = true;
        if (!mounted.current || controller.signal.aborted) return;
        await apply(
          next,
          (signal) => runtime.themes.completeOpening(next, signal),
          controller.signal,
        );
      }
      if (mounted.current && !controller.signal.aborted)
        navigation.navigate('Provider', { onboarding: true, skipTheme: !deferToModel });
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) {
        setError(error instanceof Error ? error.message : '没能保存这点小偏好，请再试一次');
        setModelOption(!interpreted);
      }
    } finally {
      submitting.current = false;
      request.current = undefined;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <Page>
      <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar name="Nyvemi" size={44} />
          <View>
            <Heading>Nyvemi</Heading>
            <Note>A life that remembers you.</Note>
          </View>
        </View>
        <Card>
          <Text style={{ color: palette.ink, fontSize: 22, lineHeight: 30 }}>
            你喜欢什么颜色呀？
          </Text>
          <Note>先把这里换成你喜欢的样子。现在不需要密钥。</Note>
        </Card>
        <Field
          label="你喜欢的颜色和感觉"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={500}
          placeholder="淡淡的粉色，柔和一点，别太艳"
          editable={!busy}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {['淡粉色，柔和', '蓝灰色，安静', '黑白灰，温暖', '淡紫色，梦幻'].map((text) => (
            <Pressable
              key={text}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setDescription(text)}
              style={{
                padding: 10,
                backgroundColor: palette.tint,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text
                style={{ color: palette.accent, includeFontPadding: false, textAlign: 'center' }}
              >
                {text}
              </Text>
            </Pressable>
          ))}
        </View>

        <ErrorText text={error} />
        <Button
          title={busy ? (transitioning ? '颜色正在慢慢铺开…' : '正在准备…') : '就这个感觉'}
          disabled={busy || !description.trim()}
          onPress={() => void continueOpening()}
        />
        {modelOption ? (
          <Button
            title="连接模型帮我理解"
            secondary
            disabled={busy}
            onPress={() => void continueOpening(false, true)}
          />
        ) : null}
        {busy && !transitioning ? (
          <Button title="取消" secondary onPress={() => request.current?.abort()} />
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <TextButton
            title="先用现在的颜色"
            disabled={busy}
            onPress={() => void continueOpening(true)}
          />
          <TextButton
            title="恢复角色备份"
            disabled={busy}
            onPress={() => navigation.navigate('Transfer')}
          />
        </View>
      </View>
    </Page>
  );
}
export function ProviderScreen({ navigation, route }: ScreenProps<'Provider'>) {
  const { palette } = useTheme();
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
      .catch(() => setError('无法读取模型设置'));
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
        else navigation.replace('Theme');
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
      <Heading>{route.params?.onboarding ? '让她能和你说话' : '聊天模型'}</Heading>
      <Note>默认使用 DeepSeek，填入密钥就能开始。</Note>
      <Card>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Text style={{ fontSize: 17, fontWeight: '600', color: palette.ink }}>
            {config.baseUrl === deepSeekPreset.baseUrl && config.model === deepSeekPreset.model
              ? 'DeepSeek'
              : '自定义聊天模型'}
          </Text>
          <TextButton
            title="获取 Key"
            onPress={() =>
              void Linking.openURL('https://platform.deepseek.com/api_keys').catch(() =>
                setError('无法打开网页，请前往 DeepSeek 开放平台创建密钥'),
              )
            }
          />
        </View>
        <Field
          label="API Key"
          value={key}
          onChangeText={setKey}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={hasKey ? '已保存，留空保留' : '粘贴 DeepSeek API Key'}
        />
        <Details title="自定义模型">
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
          <TextButton title="恢复 DeepSeek 默认配置" onPress={() => setConfig(deepSeekPreset)} />
          <Note>更换服务地址后，请重新填写对应的密钥。</Note>
        </Details>
      </Card>
      <Note>密钥仅存本机。豆包画图可以稍后单独设置。</Note>
      <ErrorText text={error} />
      {notice ? <Note>{notice}</Note> : null}
      <Button
        title={busy ? '连接中…' : route.params?.onboarding ? '保存并创建角色' : '保存设置'}
        disabled={busy}
        onPress={() => void save(false)}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <TextButton title="测试连接（一次请求）" disabled={busy} onPress={() => void save(true)} />
        <TextButton title="用量与费用" onPress={() => navigation.navigate('Usage')} />
      </View>
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
      .then((c) => {
        navigation.reset({
          index: 0,
          routes: [{ name: 'Appearance', params: { characterId: c.id, onboarding: true } }],
        });
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
