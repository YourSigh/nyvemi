import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRuntime } from './context';
import { Button, Busy, Card, ErrorText, Field, Heading, Note, Page } from './components';
import type { ScreenProps } from './navigation';
import { usePalette } from '../theme/context';
import {
  defaultImageSettings,
  type CharacterRig,
  type CreationMode,
  type ImageAsset,
  type ImageSettings,
  type VisualDraft,
} from '../appearance/model';
import { imageSecret, pickReference } from '../appearance/native';
import { validateImageSettings } from '../appearance/service';
import { awakeningAt, awakeningDuration } from '../appearance/awakening';
import { CharacterImage } from './character/rig';
import { CharacterStage } from './character/stage';
import { startCompanionPresence } from '../native/presence';
import type { CharacterInteractionState } from '../character/interaction';
const modes: [CreationMode, string][] = [
  ['text', '文字生成'],
  ['reference', '文字 + 参考图'],
  ['animate', '让参考图动起来'],
];
export function AppearanceScreen({ route, navigation }: ScreenProps<'Appearance'>) {
  const runtime = useRuntime();
  const palette = usePalette();
  const cid = route.params.characterId;
  const [name, setName] = useState('她');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<CreationMode>('text');
  const [reference, setReference] = useState<ImageAsset>();
  const [config, setConfig] = useState<ImageSettings>(defaultImageSettings);
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [configure, setConfigure] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<VisualDraft>();
  const [rig, setRig] = useState<CharacterRig>();
  const [editing, setEditing] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [previewState, setPreviewState] = useState<CharacterInteractionState>('idle');
  const working = useRef(false);
  useEffect(() => {
    let live = true;
    void Promise.all([
      runtime.store.get('characters', cid),
      runtime.store.get('visualDrafts', cid),
      runtime.store.get('imageSettings', 'images'),
      imageSecret.get(),
    ])
      .then(([c, d, settings, secret]) => {
        if (!live) return;
        if (!c) throw new Error('角色不存在');
        setName(c.persona.name);
        setDescription(c.persona.appearance || '正面全身，可爱的二次元角色，简单背景');
        if (settings) setConfig(settings);
        setHasKey(Boolean(secret));
        if (d && !d.saved) {
          setDraft(d);
          setDescription(d.input.description);
          setMode(d.input.mode);
          setReference(d.input.reference);
          setEditing(!d.candidates.length && !d.selected);
          setRig(d.rig);
        }
        setLoaded(true);
      })
      .catch(() => setError('读取形象草稿失败，请返回后重试'));
    return () => {
      live = false;
    };
  }, [runtime, cid]);
  useFocusEffect(
    useCallback(() => {
      if (!rig || editing) return;
      let total = 0;
      let previous = Date.now();
      setElapsed(0);
      const timer = setInterval(() => {
        const now = Date.now();
        if (AppState.currentState === 'active') total += now - previous;
        previous = now;
        setElapsed(Math.min(total, awakeningDuration));
      }, 50);
      return () => clearInterval(timer);
    }, [rig, editing]),
  );
  const run = async (label: string, action: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(label);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，请重试');
    } finally {
      working.current = false;
      setBusy('');
    }
  };
  const saveConfig = async () => {
    const next = validateImageSettings(config);
    if (next.provider === 'seedream') {
      if (key.trim()) {
        await imageSecret.set(key.trim());
        setKey('');
        setHasKey(true);
      } else if (!(await imageSecret.get())) throw new Error('请先填写豆包 API Key');
    }
    await runtime.store.put('imageSettings', next);
  };
  const select = (index?: number) =>
    void run('正在整理图层', async () => {
      const next = await runtime.visuals.select(cid, index);
      setRig(next);
      setPreviewState('idle');
      setEditing(false);
      setDraft(await runtime.store.get('visualDrafts', cid));
    });
  const generate = () =>
    void run(mode === 'animate' ? '正在保存参考图' : '正在生成形象', async () => {
      await saveConfig();
      const next = await runtime.visuals.generate(cid, {
        description,
        mode,
        reference: mode === 'text' ? undefined : reference,
      });
      setDraft(next);
      setRig(undefined);
      setEditing(false);
    });
  const finish = () =>
    void run('正在保存形象', async () => {
      await runtime.visuals.save(cid);
      const c = await runtime.store.get('characters', cid);
      if (c && (await runtime.store.get('settings', cid))?.proactiveEnabled)
        await startCompanionPresence(c).catch(() => undefined);
      navigation.reset({ index: 0, routes: [{ name: 'Chat', params: { characterId: cid } }] });
    });
  const awake = awakeningAt(elapsed);
  return (
    <Page>
      <Heading>{route.params.onboarding ? '初次见面的样子' : '换个新形象'}</Heading>
      <Note>
        {config.provider === 'mock'
          ? '演示模式 · 不联网、不扣费，参考图也会用示例分层角色演示动作'
          : '豆包 / Seedream'}
      </Note>
      <ErrorText text={error} />
      {!loaded ? <Busy label="读取形象…" /> : null}
      {loaded && editing ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {modes.map(([id, label]) => (
              <Pressable
                key={id}
                disabled={Boolean(busy)}
                onPress={() => setMode(id)}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === id }}
                style={{
                  padding: 12,
                  borderRadius: 16,
                  backgroundColor: mode === id ? palette.tint : palette.paper,
                  borderWidth: 1,
                  borderColor: mode === id ? palette.accent : palette.line,
                }}
              >
                <Text style={{ color: palette.ink }}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Field
            label="描述她的样子"
            multiline
            maxLength={2000}
            value={description}
            onChangeText={setDescription}
            editable={!busy}
            placeholder="银白长发、粉色发饰，穿宽松外套……"
          />
          {mode !== 'text' ? (
            <>
              {reference ? <CharacterImage asset={reference} width={180} height={200} /> : null}
              <Button
                secondary
                title={reference ? '更换参考图' : '上传参考图'}
                disabled={Boolean(busy)}
                onPress={() =>
                  void run('读取参考图', async () => {
                    const selected = await pickReference();
                    if (selected) setReference(selected);
                  })
                }
              />
            </>
          ) : null}
          <Button
            secondary
            title={configure ? '收起生图设置' : '生图设置'}
            disabled={Boolean(busy)}
            onPress={() => setConfigure((v) => !v)}
          />
          {configure ? (
            <Card>
              <Button
                title={config.provider === 'mock' ? '当前：免费演示' : '切回免费演示'}
                secondary
                disabled={Boolean(busy)}
                onPress={() => setConfig({ ...config, provider: 'mock' })}
              />
              <Button
                title={config.provider === 'seedream' ? '当前：豆包付费接口' : '使用豆包付费接口'}
                disabled={Boolean(busy)}
                onPress={() =>
                  Alert.alert(
                    '启用豆包',
                    '生成候选图需要 3 次请求；拆层最多可能按 17 张输出图计费。相同输入会复用本机缓存。',
                    [
                      { text: '取消', style: 'cancel' },
                      {
                        text: '启用',
                        onPress: () => setConfig({ ...config, provider: 'seedream' }),
                      },
                    ],
                  )
                }
              />
              {config.provider === 'seedream' ? (
                <>
                  <Field
                    label="API Key"
                    value={key}
                    onChangeText={setKey}
                    secureTextEntry
                    autoCapitalize="none"
                    placeholder={hasKey ? '已保存，留空保留' : '火山方舟 API Key'}
                  />
                  <Field
                    label="Base URL"
                    value={config.baseUrl}
                    onChangeText={(baseUrl) => setConfig({ ...config, baseUrl })}
                    autoCapitalize="none"
                  />
                  <Field
                    label="生图模型"
                    value={config.imageModel}
                    onChangeText={(imageModel) => setConfig({ ...config, imageModel })}
                    autoCapitalize="none"
                  />
                  <Field
                    label="拆层模型"
                    value={config.layerModel}
                    onChangeText={(layerModel) => setConfig({ ...config, layerModel })}
                    autoCapitalize="none"
                  />
                </>
              ) : null}
            </Card>
          ) : null}
          <Button
            title={mode === 'animate' ? '使用这张参考图' : '生成 3 张候选图'}
            disabled={Boolean(busy) || !description.trim() || (mode !== 'text' && !reference)}
            onPress={generate}
          />
        </>
      ) : null}
      {!editing && !rig && draft ? (
        <>
          <Note>{mode === 'animate' ? '参考图已就绪' : '选一张你喜欢的，再让她动起来。'}</Note>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {(mode === 'animate' && draft.selected ? [draft.selected] : draft.candidates).map(
              (asset, i) => (
                <Pressable
                  key={asset.uri}
                  accessibilityRole="button"
                  accessibilityLabel={`选择形象 ${i + 1}`}
                  disabled={Boolean(busy)}
                  onPress={() => select(mode === 'animate' ? undefined : i)}
                  style={{
                    borderRadius: 16,
                    borderColor: palette.line,
                    borderWidth: 1,
                    padding: 8,
                  }}
                >
                  <CharacterImage asset={asset} width={140} height={190} />
                  <Text style={{ color: palette.accent, textAlign: 'center' }}>选择 {i + 1}</Text>
                </Pressable>
              ),
            )}
          </View>
          {mode === 'animate' ? (
            <Button title="整理图层并生成动作" disabled={Boolean(busy)} onPress={() => select()} />
          ) : null}
        </>
      ) : null}
      {rig && !editing ? (
        <>
          <CharacterStage
            name={name}
            height={340}
            rig={rig}
            forceEyesClosed={!awake.complete && awake.eyesClosed}
            state={awake.complete ? previewState : awake.state}
          />
          <Note>
            {!awake.complete
              ? elapsed < 1400
                ? '正在让她睁开眼睛'
                : elapsed < 2600
                  ? '正在让她学会眨眼'
                  : '正在让她动起来'
              : '醒来了。'}
          </Note>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(
              [
                ['idle', '呼吸'],
                ['thinking', '思考'],
                ['talking', '说话'],
                ['happy', '开心'],
                ['sleepy', '困了'],
              ] as [CharacterInteractionState, string][]
            ).map(([state, label]) => (
              <Button
                key={state}
                secondary
                title={label}
                disabled={!awake.complete || Boolean(busy)}
                onPress={() => setPreviewState(state)}
              />
            ))}
          </View>
          <Button
            title={route.params.onboarding ? '保存，开始聊天' : '保存新形象'}
            disabled={!awake.complete || Boolean(busy)}
            onPress={finish}
          />
        </>
      ) : null}
      {!editing ? (
        <Button
          secondary
          title="重新选择 / 调整描述"
          disabled={Boolean(busy)}
          onPress={() => {
            setEditing(true);
            setRig(undefined);
          }}
        />
      ) : null}
      {busy ? <Busy label={`${busy}…`} /> : null}
    </Page>
  );
}
