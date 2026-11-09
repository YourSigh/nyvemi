import { upgradeImageSettings, qualityImageSettings } from '../appearance/settings';
import { StructuredOutputError } from '../providers/structured-error';
import { id } from '../domain/models';
import { usesVisualResearch } from '../appearance/model';
import { ImageProviderError, type ImageRequestFailure } from '../appearance/errors';
import { pickMeshAvatar } from '../avatar/native';
import type { MeshAvatar } from '../avatar/model';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRuntime } from './context';
import {
  Button,
  Busy,
  ErrorText,
  Field,
  Heading,
  Note,
  Page,
  Details,
  TextButton,
} from './components';
import type { ScreenProps } from './navigation';
import { usePalette } from '../theme/context';
import {
  defaultImageSettings,
  type CharacterRig,
  type CreationMode,
  type ImageAsset,
  type ImageSettings,
  type VisualDraft,
  type VisualBuildProgress,
} from '../appearance/model';
import { imageSecret, pickReference, pickLayeredLook } from '../appearance/native';
import { validateImageSettings } from '../appearance/service';
import { awakeningAt, awakeningDuration } from '../appearance/awakening';
import { CharacterImage, RigCharacter } from './character/rig';
import { CharacterStage } from './character/stage';
import { startCompanionPresence } from '../native/presence';
import type { CharacterInteractionState } from '../character/interaction';
const modes: [CreationMode, string][] = [
  ['text', '文字生成'],
  ['reference', '加参考图'],
  ['animate', '使用原图'],
];
export function AppearanceScreen({ route, navigation }: ScreenProps<'Appearance'>) {
  const runtime = useRuntime();
  const palette = usePalette();
  const { width, height } = useWindowDimensions();
  const candidateWidth = Math.max(56, Math.min(180, (width - 64) / 3));
  const cid = route.params.characterId;
  const [name, setName] = useState('她');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<CreationMode>('text');
  const [reference, setReference] = useState<ImageAsset>();
  const [config, setConfig] = useState<ImageSettings>(defaultImageSettings);
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>();
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<VisualDraft>();
  const [rig, setRig] = useState<CharacterRig>();
  const [build, setBuild] = useState<VisualBuildProgress>();
  const [meshReady, setMeshReady] = useState(false);
  const [meshAvatar, setMeshAvatar] = useState<MeshAvatar>();
  const [editing, setEditing] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [failure, setFailure] = useState<ImageRequestFailure>();
  const [schemaFailure, setSchemaFailure] = useState<StructuredOutputError['details']>();
  const [elapsed, setElapsed] = useState(0);
  const [previewState, setPreviewState] = useState<CharacterInteractionState>('idle');
  const working = useRef(false);
  useEffect(() => {
    let live = true;
    void Promise.all([
      runtime.store.get('characters', cid),
      runtime.visuals.restoreLook
        ? runtime.visuals.restoreLook(cid).catch(() => runtime.store.get('visualDrafts', cid))
        : runtime.store.get('visualDrafts', cid),
      runtime.store.get('imageSettings', 'images'),
      imageSecret.get(),
    ])
      .then(([c, d, settings, secret]) => {
        if (!live) return;
        if (!c) throw new Error('角色不存在');
        setName(c.persona.name);
        setDescription(c.persona.appearance || '正面全身，可爱的二次元角色，简单背景');
        if (settings) setConfig(upgradeImageSettings({ ...settings, provider: 'seedream' }));
        setHasKey(Boolean(secret));
        if (d) {
          setDraft(d);
          setDescription(d.input.description);
          setMode(d.input.mode);
          setReference(d.input.reference);
          if (d.build && d.build.stage !== 'ready') setBuild(d.build);
          if (d.providerId !== 'mock-v1' && (!d.saved || d.rig || d.meshAvatar)) {
            setEditing(
              !(
                d.rig ||
                d.meshAvatar ||
                d.build ||
                d.research ||
                d.candidates.length ||
                d.selected
              ),
            );
            setRig(d.build && d.build.stage !== 'ready' ? undefined : d.rig);
            setMeshAvatar(d.meshAvatar);
          }
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
      if ((!rig && !meshAvatar) || editing || (meshAvatar && !meshReady)) return;
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
    }, [rig, meshAvatar, editing, meshReady]),
  );
  const run = async (label: string, action: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(label);
    setError('');
    setFailure(undefined);
    setSchemaFailure(undefined);
    try {
      await action();
    } catch (e) {
      if (e instanceof ImageProviderError) setFailure(e.failure);
      if (e instanceof StructuredOutputError) {
        setSchemaFailure(e.details);
        await runtime.store
          .put('diagnostics', {
            id: id(),
            characterId: cid,
            createdAt: Date.now(),
            kind: 'error',
            data: { event: 'visual_schema', ...e.details },
          })
          .catch(() => undefined);
      }
      setError(
        e instanceof ImageProviderError
          ? e.userMessage
          : e instanceof StructuredOutputError
            ? `${e.details.stage}未完成，请重试`
            : e instanceof Error
              ? e.message
              : '操作失败，请重试',
      );
    } finally {
      working.current = false;
      setBusy('');
    }
  };
  const saveConfig = async (requireKey = true) => {
    const next = validateImageSettings(config);
    if (next.provider === 'seedream') {
      if (key.trim()) {
        await imageSecret.set(key.trim(), next.baseUrl);
        setKey('');
        setHasKey(true);
      } else if (requireKey && !(await imageSecret.get(next.baseUrl)))
        throw new Error('请填写当前服务的 API Key；更换接口地址需重新填写');
    }
    await runtime.store.put('imageSettings', next);
  };
  const select = (index?: number) =>
    void run('正在制作动态形象', async () => {
      setRig(undefined);
      setEditing(false);
      const source = index === undefined ? draft?.selected : draft?.candidates[index];
      if (source) setBuild({ stage: 'layers', source, completed: 0 });
      const next = await runtime.visuals.select(cid, index, setBuild);
      setBuild(undefined);
      setRig(next);
      setPreviewState('idle');
      setEditing(false);
      setDraft(await runtime.store.get('visualDrafts', cid));
    });
  const generate = (
    regenerate = false,
    options: {
      planOnly?: boolean;
      refreshResearch?: boolean;
      reviewAgain?: boolean;
      referenceId?: string;
    } = {},
  ) =>
    void run(mode === 'animate' ? '正在读取图片' : '正在准备形象', async () => {
      await saveConfig(!options.planOnly && draft?.candidates.length !== 3 && !options.reviewAgain);
      setBuild(undefined);
      try {
        const next = await runtime.visuals.generate(
          cid,
          {
            description,
            mode,
            reference: mode === 'text' ? undefined : reference,
          },
          {
            regenerate,
            ...options,
            onDraft: (value) => {
              setDraft({ ...value });
              setEditing(false);
            },
            onStage: (stage) =>
              setBusy(
                {
                  brief: '正在准备形象',
                  prompt: '正在准备形象',
                  reference: '正在准备形象',
                  generation: '正在生成形象',
                  review: '正在检查候选图',
                }[stage],
              ),
          },
        );
        setDraft(next);
        setSelectedIndex(undefined);
        setRig(undefined);
        setEditing(false);
        if (mode === 'animate') {
          const source = next.selected;
          if (source) setBuild({ stage: 'layers', source, completed: 0 });
          const result = await runtime.visuals.select(cid, undefined, setBuild);
          setBuild(undefined);
          setRig(result);
          setPreviewState('idle');
          setDraft(await runtime.store.get('visualDrafts', cid));
        }
      } catch (error) {
        const latest = await runtime.store.get('visualDrafts', cid);
        setDraft(latest);
        setEditing(!latest?.candidates.length && !latest?.selected);
        throw error;
      }
    });
  const finish = () =>
    void run('正在保存形象', async () => {
      if (meshAvatar) await runtime.visuals.saveMesh(cid);
      else await runtime.visuals.save(cid);
      const c = await runtime.store.get('characters', cid);
      if (c && (await runtime.store.get('settings', cid))?.proactiveEnabled)
        await startCompanionPresence(c).catch(() => undefined);
      navigation.reset({ index: 0, routes: [{ name: 'Chat', params: { characterId: cid } }] });
    });
  const awake = awakeningAt(elapsed);
  const buildHeight = build?.preview
    ? Math.min(260, ((width - 40) * build.preview.height) / build.preview.width)
    : 260;
  return (
    <Page>
      <Heading>{route.params.onboarding ? '初次见面的样子' : '换个新形象'}</Heading>
      <ErrorText text={error} />
      {failure || schemaFailure ? (
        <Details title="错误详情">
          {failure ? (
            <>
              <Note>HTTP {failure.httpStatus}</Note>
              {failure.code ? <Note>错误码：{failure.code}</Note> : null}
              {failure.parameter ? <Note>参数：{failure.parameter}</Note> : null}
              {failure.requestId ? <Note>请求编号：{failure.requestId}</Note> : null}
            </>
          ) : null}
          {schemaFailure ? (
            <>
              <Note>阶段：{schemaFailure.stage}</Note>
              <Note>原因：{schemaFailure.reason}</Note>
              {schemaFailure.issues.map((issue, i) => (
                <Note key={i}>
                  字段：{issue.path.join('.') || '$'}（{issue.code}）
                </Note>
              ))}
            </>
          ) : null}
        </Details>
      ) : null}
      {!loaded ? <Busy label="读取形象…" /> : null}
      {build && build.stage !== 'ready' && !editing ? (
        <View testID="visual-build-preview" style={{ gap: 12, alignItems: 'center' }}>
          {build.preview?.layers.length ? (
            <RigCharacter
              rig={{ version: 1, source: 'seedream', ...build.preview }}
              width={(buildHeight * build.preview.width) / build.preview.height}
              height={buildHeight}
              eyesClosed={false}
              mouthOpen={false}
              state="idle"
              headStyle={{}}
              armStyle={{}}
            />
          ) : (
            <CharacterImage asset={build.source} width={Math.min(width - 40, 260)} height={260} />
          )}
          <Note>
            {build.stage === 'failed'
              ? '制作暂停，可从当前进度继续'
              : busy
                ? ({
                    layers: '正在制作动态形象',
                    checking: '正在检查效果',
                    repairing_arms: '正在调整手臂',
                    finishing: '正在完善细节',
                  }[build.stage] ?? '正在制作')
                : '可以继续制作'}
          </Note>
          {busy && build.total ? (
            <Note>
              进度 {build.completed}/{build.total}
            </Note>
          ) : null}
          {!busy ? <Button title="继续制作" onPress={() => select()} /> : null}
        </View>
      ) : null}
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
                  padding: 10,
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 16,
                  backgroundColor: mode === id ? palette.tint : palette.paper,
                  borderWidth: 1,
                  borderColor: mode === id ? palette.accent : palette.line,
                }}
              >
                <Text
                  style={{ color: palette.ink, includeFontPadding: false, textAlign: 'center' }}
                >
                  {label}
                </Text>
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
              {reference ? <CharacterImage asset={reference} width={90} height={110} /> : null}
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
          {hasKey ? (
            <Details title="更换豆包密钥">
              <Field
                label="豆包 API Key"
                value={key}
                onChangeText={setKey}
                secureTextEntry
                autoCapitalize="none"
                placeholder="已保存，留空保留"
              />
            </Details>
          ) : (
            <Field
              label="豆包 API Key"
              value={key}
              onChangeText={setKey}
              secureTextEntry
              autoCapitalize="none"
              placeholder="粘贴火山方舟 API Key"
            />
          )}
          <Details title="自定义生图模型">
            <TextButton
              title="省钱组合：Pro生图 + Flash拆层"
              disabled={Boolean(busy)}
              onPress={() => setConfig(defaultImageSettings)}
            />
            <TextButton
              title="使用Pro生图 + Pro拆层"
              disabled={Boolean(busy)}
              onPress={() => setConfig(qualityImageSettings)}
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
          </Details>
          {config.provider === 'seedream' ? <Note>可能使用豆包额度。</Note> : null}
          <Button
            title={mode === 'animate' ? '让原图动起来' : '生成 3 张候选图'}
            disabled={Boolean(busy) || !description.trim() || (mode !== 'text' && !reference)}
            onPress={() => generate()}
          />
          <Details title="导入已有形象">
            <TextButton
              title="导入网格角色 (.p2lrt)"
              disabled={Boolean(busy)}
              onPress={() =>
                void run('读取网格角色', async () => {
                  const model = await pickMeshAvatar(runtime.store, cid);
                  if (model) {
                    setMeshAvatar(model);
                    setElapsed(0);
                    setRig(undefined);
                    setEditing(false);
                    setPreviewState('idle');
                  }
                })
              }
            />
            <TextButton
              title="导入分层形象文件"
              disabled={Boolean(busy)}
              onPress={() =>
                void run('读取分层形象', async () => {
                  const next = await pickLayeredLook(runtime.store, cid);
                  if (next) {
                    setRig(next);
                    setEditing(false);
                    setPreviewState('idle');
                  }
                })
              }
            />
            <Note>网格模型可直接播放；分层图片仍需在电脑端绑定网格。</Note>
          </Details>
        </>
      ) : null}
      {!editing &&
      !rig &&
      !meshAvatar &&
      draft &&
      !draft.candidates.length &&
      mode !== 'animate' ? (
        <Button title="继续生成候选图" disabled={Boolean(busy)} onPress={() => generate()} />
      ) : null}
      {!editing &&
      !rig &&
      !meshAvatar &&
      draft &&
      (!build || build.stage === 'ready') &&
      (draft.candidates.length > 0 || (mode === 'animate' && draft.selected)) ? (
        <>
          {mode !== 'animate' ? <Note>选一张你喜欢的形象。</Note> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
            {(mode === 'animate' && draft.selected ? [draft.selected] : draft.candidates).map(
              (asset, i) => (
                <Pressable
                  key={asset.uri}
                  accessibilityRole="button"
                  accessibilityLabel={`选择形象 ${i + 1}`}
                  disabled={Boolean(busy)}
                  onPress={() => setSelectedIndex(i)}
                  accessibilityState={{ selected: selectedIndex === i }}
                  style={{
                    borderRadius: 16,
                    borderColor: selectedIndex === i ? palette.accent : palette.line,
                    backgroundColor: selectedIndex === i ? palette.tint : palette.paper,
                    borderWidth: 2,
                    padding: 2,
                    alignItems: 'center',
                    flexShrink: 1,
                  }}
                >
                  <CharacterImage
                    asset={asset}
                    width={candidateWidth}
                    height={Math.min(220, candidateWidth * 1.6)}
                  />
                  <Text style={{ color: palette.accent, textAlign: 'center' }}>选择 {i + 1}</Text>
                </Pressable>
              ),
            )}
          </View>
          <Button
            title="让她动起来"
            disabled={Boolean(busy) || (mode !== 'animate' && selectedIndex === undefined)}
            onPress={() => select(mode === 'animate' ? undefined : selectedIndex)}
          />
          {config.provider === 'seedream' ? <Note>可能使用豆包额度。</Note> : null}
          {usesVisualResearch(draft.promptVersion) &&
            (draft.candidates.length < 3 ? (
              <TextButton
                title="生成剩余候选图"
                disabled={Boolean(busy)}
                onPress={() => generate(false)}
              />
            ) : (
              <Details title="形象核对">
                {selectedIndex !== undefined &&
                draft.candidateReviews?.[selectedIndex]?.issues.length ? (
                  <Note>
                    {draft.candidateReviews[selectedIndex]!.issues.slice(0, 2).join('；')}
                  </Note>
                ) : null}
                <TextButton
                  title="重新核对"
                  disabled={Boolean(busy)}
                  onPress={() => generate(false, { reviewAgain: true })}
                />
              </Details>
            ))}
          {mode !== 'animate' && draft.candidates.length === 3 ? (
            <TextButton
              title="换一批"
              disabled={Boolean(busy)}
              onPress={() => {
                if (config.provider === 'seedream')
                  Alert.alert('换一批形象？', '将使用豆包额度生成 3 张新图。', [
                    { text: '取消', style: 'cancel' },
                    { text: '生成', onPress: () => generate(true) },
                  ]);
                else generate(true);
              }}
            />
          ) : null}
        </>
      ) : null}
      {(rig || meshAvatar) && !editing ? (
        <>
          <CharacterStage
            name={name}
            height={Math.min(280, height * 0.35)}
            rig={rig}
            meshAvatar={meshAvatar}
            onMeshReady={setMeshReady}
            forceEyesClosed={!awake.complete && awake.eyesClosed}
            state={awake.complete ? previewState : awake.state}
          />
          {draft?.advisories?.includes('repair_unavailable') && !busy && !error ? (
            <Note>部分动作可能不自然，请先预览。</Note>
          ) : null}
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
              <TextButton
                key={state}
                title={label}
                disabled={!awake.complete || Boolean(busy)}
                onPress={() => setPreviewState(state)}
              />
            ))}
          </View>
          {rig?.source === 'seedream' && draft?.selected && config.provider === 'seedream' ? (
            <Details title="高级修复">
              <Button
                secondary
                title={draft.bodyRepairApplied ? '身体已补全' : '重新补全身体（付费）'}
                disabled={draft.bodyRepairApplied || !awake.complete || Boolean(busy)}
                onPress={() =>
                  void run('正在补全身体', async () => {
                    setRig(await runtime.visuals.repairBody(cid));
                    setDraft(await runtime.store.get('visualDrafts', cid));
                    setPreviewState('idle');
                  })
                }
              />
              <TextButton
                title={draft.armRepairApplied ? '双臂已修复' : '修复双臂连接（付费）'}
                disabled={Boolean(busy) || !awake.complete || draft.armRepairApplied}
                onPress={() =>
                  Alert.alert('修复双臂连接', '修复将使用豆包额度。', [
                    { text: '取消', style: 'cancel' },
                    {
                      text: '修复',
                      onPress: () =>
                        void run('正在修复双臂', async () => {
                          setRig(await runtime.visuals.repairArms(cid));
                          setDraft(await runtime.store.get('visualDrafts', cid));
                          setPreviewState('idle');
                        }),
                    },
                  ])
                }
              />
            </Details>
          ) : null}
          <Button
            title={route.params.onboarding ? '保存，开始聊天' : '保存新形象'}
            disabled={!awake.complete || Boolean(busy) || Boolean(meshAvatar && !meshReady)}
            onPress={finish}
          />
        </>
      ) : null}
      {!editing ? (
        <TextButton
          title="调整描述 / 重新选择"
          disabled={Boolean(busy)}
          onPress={() => {
            setEditing(true);
            setBuild(undefined);
            setRig(undefined);
            setMeshAvatar(undefined);
          }}
        />
      ) : null}
      {route.params.onboarding ? (
        <TextButton
          title="先聊天，稍后设置形象"
          disabled={Boolean(busy)}
          onPress={() =>
            void run('正在进入聊天', async () => {
              const character = await runtime.store.get('characters', cid);
              if (!character) throw Error('角色不存在');
              await runtime.store.put('characters', { ...character, appearancePending: false });
              if ((await runtime.store.get('settings', cid))?.proactiveEnabled)
                await startCompanionPresence(character).catch(() => undefined);
              navigation.reset({
                index: 0,
                routes: [{ name: 'Chat', params: { characterId: cid } }],
              });
            })
          }
        />
      ) : null}
      {busy && !build ? <Busy label={`${busy}…`} /> : null}
    </Page>
  );
}
