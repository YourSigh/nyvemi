import { ImageProviderError, type ImageRequestFailure } from '../appearance/errors';
import { pickMeshAvatar } from '../avatar/native';
import type { MeshAvatar } from '../avatar/model';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Pressable, Text, View, useWindowDimensions } from 'react-native';
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
} from '../appearance/model';
import { imageSecret, pickReference, pickLayeredLook } from '../appearance/native';
import { validateImageSettings } from '../appearance/service';
import { awakeningAt, awakeningDuration } from '../appearance/awakening';
import { CharacterImage } from './character/rig';
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
  const [referenceId, setReferenceId] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<VisualDraft>();
  const [rig, setRig] = useState<CharacterRig>();
  const [meshReady, setMeshReady] = useState(false);
  const [meshAvatar, setMeshAvatar] = useState<MeshAvatar>();
  const [editing, setEditing] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [failure, setFailure] = useState<ImageRequestFailure>();
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
        if (settings) setConfig({ ...settings, provider: 'seedream' });
        setHasKey(Boolean(secret));
        if (d) {
          setDraft(d);
          setReferenceId(d.confirmedReferenceId);
          setDescription(d.input.description);
          setMode(d.input.mode);
          setReference(d.input.reference);
          if (!d.saved && d.providerId !== 'mock-v1') {
            setEditing(
              d.rig || d.meshAvatar || d.research
                ? false
                : d.input.mode !== 'animate'
                  ? d.candidates.length !== 3
                  : !d.selected,
            );
            setRig(d.rig);
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
    try {
      await action();
    } catch (e) {
      if (e instanceof ImageProviderError) setFailure(e.failure);
      setError(e instanceof Error ? e.message : '操作失败，请重试');
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
    void run('正在整理图层', async () => {
      const next = await runtime.visuals.select(cid, index);
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
    void run(mode === 'animate' ? '正在保存参考图' : '正在确认角色', async () => {
      await saveConfig(!options.planOnly && draft?.candidates.length !== 3);
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
            onStage: (stage) =>
              setBusy(
                {
                  brief: '正在确认角色特征',
                  reference: '正在找参考并核对角色',
                  generation: '正在生成形象',
                  review: '正在对照参考检查形象',
                }[stage],
              ),
          },
        );
        setDraft(next);
        setReferenceId(next.confirmedReferenceId);
        setSelectedIndex(undefined);
        setRig(undefined);
        setEditing(false);
      } catch (error) {
        const latest = await runtime.store.get('visualDrafts', cid);
        setDraft(latest);
        setEditing(latest?.promptVersion === 3 ? !latest.research : true);
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
  return (
    <Page>
      <Heading>{route.params.onboarding ? '初次见面的样子' : '换个新形象'}</Heading>
      <Note>
        {meshAvatar || rig
          ? '看看她现在的样子。'
          : !editing && draft?.research
            ? `这次画：${draft.research.brief.subject}`
            : '描述你想见到的人，也可以上传一张参考图。'}
      </Note>
      <ErrorText text={error} />
      {failure ? (
        <Details title="错误详情">
          <Note>错误码：{failure.code ?? '服务商未提供'}</Note>
          {failure.parameter ? <Note>参数：{failure.parameter}</Note> : null}
          <Note>请求编号：{failure.requestId ?? '服务商未提供'}</Note>
        </Details>
      ) : null}
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
            <TextButton title="恢复豆包默认配置" onPress={() => setConfig(defaultImageSettings)} />
          </Details>
          <Note>先用聊天模型确认要求；确认参考后才使用豆包额度生图。</Note>
          <Button
            title={mode === 'animate' ? '使用这张参考图' : '先确认角色与参考'}
            disabled={Boolean(busy) || !description.trim() || (mode !== 'text' && !reference)}
            onPress={() => generate(false, { planOnly: mode !== 'animate' })}
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
      {!editing && !rig && !meshAvatar && draft?.research && !draft.candidates.length ? (
        <>
          <Note>
            {draft.research.note ??
              (draft.research.status === 'ready'
                ? '已整理好你的原创角色要求。'
                : '先确认参考中的人物和造型，再开始画。')}
          </Note>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
            {draft.research.references.map((ref, i) => (
              <Pressable
                key={ref.id}
                accessibilityRole="button"
                accessibilityLabel={`选择参考 ${i + 1}`}
                accessibilityState={{ selected: referenceId === ref.id }}
                disabled={Boolean(busy)}
                onPress={() => setReferenceId(ref.id)}
                style={{
                  borderWidth: 2,
                  borderColor: referenceId === ref.id ? palette.accent : palette.line,
                  backgroundColor: palette.paper,
                  borderRadius: 14,
                  padding: 2,
                  alignItems: 'center',
                  flexShrink: 1,
                }}
              >
                <CharacterImage
                  asset={ref.asset}
                  width={candidateWidth}
                  height={Math.min(210, candidateWidth * 1.6)}
                />
                <Text style={{ color: palette.accent, fontSize: 13 }}>参考 {i + 1}</Text>
                <Text style={{ color: palette.muted, fontSize: 12 }}>
                  {ref.check.status === 'match' ? 'DS初检相符' : '请仔细确认'}
                </Text>
              </Pressable>
            ))}
          </View>
          {draft.research.references.find((r) => r.id === referenceId) ? (
            <Note>
              {draft.research.references
                .find((r) => r.id === referenceId)!
                .check.features.slice(0, 3)
                .join(' · ')}
            </Note>
          ) : null}
          {draft.research.references.length ? (
            <Details title="参考来源">
              {draft.research.references.map((ref, i) =>
                ref.sourceUrl ? (
                  <TextButton
                    key={ref.id}
                    title={`${i + 1}. ${ref.title.slice(0, 38)}`}
                    onPress={() =>
                      void Linking.openURL(ref.sourceUrl!).catch(() => setError('无法打开来源网页'))
                    }
                  />
                ) : (
                  <Note key={ref.id}>你上传的参考图</Note>
                ),
              )}
              <Note>DS初检可能有误，请确认不是其他角色或改装图。</Note>
            </Details>
          ) : null}
          {draft.research.status !== 'needs_reference' ? (
            <>
              {!hasKey ? (
                <Field
                  label="豆包 API Key"
                  value={key}
                  onChangeText={setKey}
                  secureTextEntry
                  autoCapitalize="none"
                  placeholder="粘贴火山方舟 API Key"
                />
              ) : null}
              <Button
                title="确认，生成3张候选图"
                disabled={Boolean(busy) || (draft.research.status !== 'ready' && !referenceId)}
                onPress={() => generate(false, { referenceId })}
              />
              <Note>这一步使用豆包额度，生成后由DS逐张检查，不自动付费重画。</Note>
            </>
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <TextButton
              title="上传自己的参考图"
              disabled={Boolean(busy)}
              onPress={() =>
                void run('读取参考图', async () => {
                  const selected = await pickReference();
                  if (selected) {
                    setReference(selected);
                    setMode('reference');
                    setEditing(true);
                  }
                })
              }
            />
            <TextButton
              title="重新找参考"
              disabled={Boolean(busy)}
              onPress={() => generate(false, { planOnly: true, refreshResearch: true })}
            />
          </View>
        </>
      ) : null}
      {!editing &&
      !rig &&
      !meshAvatar &&
      draft &&
      (!draft.research || draft.candidates.length > 0) ? (
        <>
          <Note>{mode === 'animate' ? '参考图已就绪' : '选一张你喜欢的，再让她动起来。'}</Note>
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
                  {draft.promptVersion === 3 ? (
                    <Text
                      style={{
                        color:
                          draft.candidateReviews?.[i]?.status === 'mismatch'
                            ? palette.error
                            : palette.muted,
                        fontSize: 12,
                      }}
                    >
                      {!draft.candidateReviews?.[i]
                        ? '待核对'
                        : draft.candidateReviews[i]?.status === 'match'
                          ? '特征相符'
                          : draft.candidateReviews[i]?.status === 'mismatch'
                            ? '特征不符'
                            : '不确定'}
                    </Text>
                  ) : null}
                </Pressable>
              ),
            )}
          </View>
          <Button
            title="就选这张，整理图层"
            disabled={
              Boolean(busy) ||
              (mode !== 'animate' &&
                (selectedIndex === undefined ||
                  (draft.promptVersion === 3 &&
                    draft.candidateReviews?.[selectedIndex]?.status !== 'match')))
            }
            onPress={() => select(mode === 'animate' ? undefined : selectedIndex)}
          />
          {selectedIndex !== undefined && draft.candidateReviews?.[selectedIndex]?.issues.length ? (
            <Note>{draft.candidateReviews[selectedIndex]!.issues.slice(0, 2).join('；')}</Note>
          ) : null}
          {draft.promptVersion === 3 ? (
            <>
              <Note>DS核对仍可能出错，请以你看图确认为准。未通过的图片不会进入付费拆层。</Note>
              <TextButton
                title={draft.candidates.length < 3 ? '继续完成本批' : '重新核对（不重新生图）'}
                disabled={Boolean(busy)}
                onPress={() => generate(false, { reviewAgain: draft.candidates.length === 3 })}
              />
            </>
          ) : null}
          <Note>整理图层会使用豆包额度，最多可能按17张输出图计费。</Note>
          {mode !== 'animate' ? (
            <TextButton
              title={config.provider === 'seedream' ? '换一批候选图（重新付费）' : '换一批候选图'}
              disabled={Boolean(busy)}
              onPress={() => {
                if (config.provider === 'seedream')
                  Alert.alert(
                    '重新生成3张候选图',
                    '先确认参考，再生成新一批。生成时会使用豆包额度，当前聊天和已保存形象保留。',
                    [
                      { text: '取消', style: 'cancel' },
                      { text: '继续', onPress: () => generate(true, { planOnly: true }) },
                    ],
                  );
                else generate(true, { planOnly: true });
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
          <Note>
            {!meshAvatar && (!rig || rig.source === 'mock')
              ? '可以导入你喜欢的角色形象'
              : !awake.complete
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
              <TextButton
                key={state}
                title={label}
                disabled={!awake.complete || Boolean(busy)}
                onPress={() => setPreviewState(state)}
              />
            ))}
          </View>
          {rig?.source === 'seedream' && draft?.selected && config.provider === 'seedream' ? (
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
      {busy ? <Busy label={`${busy}…`} /> : null}
    </Page>
  );
}
