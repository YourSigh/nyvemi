import { LocalVoicePrepare } from './local-voice-prepare';
import { localVoiceState, importLocalVoicePack, setLocalVoiceEnabled } from '../speech/local-voice';
import type { LocalVoiceState } from '../native/android';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Switch, View, Text } from 'react-native';
import Slider from '@react-native-community/slider';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect } from '@react-navigation/native';
import {
  deleteVoiceCompanion,
  getVoiceCompanion,
  loadReferenceWav,
  playReferenceWav,
  readPickedReference,
  saveVoiceCompanion,
} from '../speech/reference-storage';
import { updateVoice, voiceOptions, voiceProfile, type VoiceOptions } from '../speech/preferences';
import { useRuntime } from './context';
import { usePalette } from '../theme/context';
import {
  Page,
  Heading,
  Note,
  Details,
  Button,
  TextButton,
  ErrorText,
  Card,
  Field,
} from './components';
import type { ScreenProps } from './navigation';

const sample = '嗨，我在这儿。今天想和我聊点什么？';
type LocalVoiceTuning = {
  pitch: number;
  warmth: number;
  brightness: number;
  presence: number;
  air: number;
  speed: number;
  volume: number;
};
const defaultLocalVoiceTuning: LocalVoiceTuning = {
  pitch: 0,
  warmth: 0,
  brightness: 0,
  presence: 0,
  air: 0,
  speed: 1,
  volume: 1,
};
const controls = [
  ['pitch', '音高', -4, 4, 0.5],
  ['warmth', '温暖', -100, 100, 5],
  ['brightness', '明亮', -100, 100, 5],
  ['presence', '清晰', -100, 100, 5],
  ['air', '空气感', -100, 100, 5],
  ['speed', '语速', 0.7, 1.3, 0.05],
  ['volume', '音量', 0, 1.5, 0.05],
] as const;
const presets: { label: string; tuning: LocalVoiceTuning }[] = [
  { label: '自然', tuning: defaultLocalVoiceTuning },
  {
    label: '温柔',
    tuning: {
      pitch: -0.5,
      warmth: 25,
      brightness: -10,
      presence: 5,
      air: 10,
      speed: 0.95,
      volume: 1,
    },
  },
  {
    label: '清亮',
    tuning: {
      pitch: 1,
      warmth: -10,
      brightness: 20,
      presence: 15,
      air: 15,
      speed: 1.05,
      volume: 1,
    },
  },
];
const sameTuning = (a: LocalVoiceTuning, b: LocalVoiceTuning) =>
  controls.every(([key]) => a[key] === b[key]);
function tuningLabel(key: keyof LocalVoiceTuning, value: number) {
  if (key === 'speed') return `${value.toFixed(2)}×`;
  if (key === 'volume') return `${Math.round(value * 100)}%`;
  if (key === 'pitch') return value === 0 ? '原调' : `${value > 0 ? '+' : ''}${value} 半音`;
  return value === 0 ? '中性' : `${value > 0 ? '+' : ''}${value}`;
}

export function VoiceSettingsScreen({ route }: ScreenProps<'VoiceSettings'>) {
  const runtime = useRuntime(),
    palette = usePalette(),
    cid = route.params.characterId;
  const [config, setConfig] = useState<VoiceOptions>(voiceProfile());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingTuning, setSavingTuning] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');
  const [connection, setConnection] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');
  const [localModel, setLocalModel] = useState<LocalVoiceState>();
  const [modelBusy, setModelBusy] = useState(false);
  const sampleRun = useRef(0);
  const referenceDriver = useMemo(() => runtime.voiceDriver(setVoiceNote), [runtime]);
  const [draft, setDraft] = useState<LocalVoiceTuning>();
  const savedTuning: LocalVoiceTuning = { ...defaultLocalVoiceTuning, ...config.localTuning };
  const tuning = draft ?? savedTuning;
  const dirty = !sameTuning(tuning, savedTuning);
  const refresh = useCallback(async () => {
    const settings = await runtime.store.get('settings', cid);
    const options = voiceOptions(settings?.voice);
    setConfig(options);
    setDraft(undefined);
    setLocalModel(await localVoiceState());
  }, [runtime, cid]);
  useFocusEffect(
    useCallback(() => {
      void refresh().catch(() => setError('读取声音设置失败'));
      return () => {
        sampleRun.current++;
        setBusy(false);
        setVoiceBusy(false);
        void referenceDriver.stop().catch(() => {});
      };
    }, [refresh, referenceDriver]),
  );
  const save = async (patch: Partial<VoiceOptions>) => {
    try {
      const next = await updateVoice(runtime.store, cid, patch);
      setError('');
      setConfig(next);
      if (!next.enabled) await referenceDriver.stop();
    } catch {
      setError('没有保存成功');
    }
  };
  useEffect(() => {
    let alive = true;
    void getVoiceCompanion()
      .then((saved) => {
        if (alive && saved) {
          setConnection(true);
          setEndpoint(saved.baseUrl);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const syncVoice = async () => {
    const next = voiceOptions((await runtime.store.get('settings', cid))?.voice);
    setConfig(next);
  };
  const applyCompanion = async () => {
    try {
      await referenceDriver.stop();
      await saveVoiceCompanion(endpoint, token);
      setConnection(true);
      setToken('');
      const available = await runtime.referenceTransport.checkCompanion();
      const ready = available && (await runtime.referenceTransport.checkCompanion(undefined, true));
      setVoiceNote(
        ready
          ? '已连接，换声模型就绪。'
          : available
            ? '已连接，换声模型尚未启动。'
            : '地址已保存，但还连不上换声服务。',
      );
    } catch (e) {
      setVoiceNote(e instanceof Error ? e.message : '没有保存成功');
    }
  };
  const clearCompanion = async () => {
    await referenceDriver.stop();
    await deleteVoiceCompanion();
    setConnection(false);
    setToken('');
    setVoiceNote('已断开换声服务。普通 DeepSeek 朗读不受影响。');
  };
  const importModel = async () => {
    setModelBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
        copyToCacheDirectory: false,
        multiple: false,
      });
      if (result.canceled) return;
      await referenceDriver.stop();
      const next = await importLocalVoicePack(result.assets[0].uri);
      setLocalModel(next);
      setVoiceNote(
        next.enabled
          ? '模型包已校验并导入，本机换声仍保持启用。参考录音只留在手机。'
          : '模型包已校验并导入。请手动开启本机换声；参考录音只留在手机。',
      );
    } catch (e) {
      setVoiceNote(e instanceof Error ? e.message : '模型包导入失败');
    } finally {
      setModelBusy(false);
    }
  };
  const toggleLocalModel = async (enabled: boolean) => {
    setModelBusy(true);
    try {
      await referenceDriver.stop();
      setLocalModel(await setLocalVoiceEnabled(enabled));
      setVoiceNote(
        enabled
          ? '已启用本机换声。换声失败时播放同一次 DeepSeek 原声，不会发送参考录音到远程服务。'
          : '已关闭本机换声。若配置了远程服务，之后的参考换声会使用该服务。',
      );
    } catch (e) {
      setVoiceNote(e instanceof Error ? e.message : '本机换声设置未保存');
    } finally {
      setModelBusy(false);
    }
  };
  const selectWav = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const { uri, name } = result.assets[0];
      await referenceDriver.stop();
      const bytes = await readPickedReference(uri);
      await runtime.referenceVoice.importOwn(cid, bytes, name.replace(/\.wav$/i, ''));
      await syncVoice();
      setVoiceNote('参考音色已保存。');
    } catch (e) {
      setVoiceNote(e instanceof Error ? e.message : '没有导入成功');
    }
  };
  const selectFoundReference = async () => {
    try {
      const selected = config.referenceCandidate;
      if (!selected) return;
      await loadReferenceWav(selected.id);
      await referenceDriver.stop();
      await runtime.referenceVoice.useCandidate(cid);
      await syncVoice();
      setVoiceNote('参考音色已保存。');
    } catch {
      setVoiceNote('无法启用这段参考声音');
    }
  };
  const stopReferencePreview = async () => {
    sampleRun.current++;
    setVoiceBusy(false);
    await referenceDriver.stop();
  };
  const previewReference = async (candidate: boolean) => {
    if (busy) return;
    if (voiceBusy) return stopReferencePreview();
    const run = ++sampleRun.current;
    setVoiceBusy(true);
    setVoiceNote('');
    try {
      if (candidate && config.referenceCandidate) {
        const bytes = await loadReferenceWav(config.referenceCandidate.id);
        if (sampleRun.current === run) await playReferenceWav(`reference:${Date.now()}`, bytes);
      } else if (config.referenceVoice) {
        await referenceDriver.play(`reference:${Date.now()}`, sample, {
          ...config,
          localTuning: tuning,
          enabled: true,
        });
      }
    } catch {
      if (sampleRun.current === run) setVoiceNote('这段声音暂时无法播放');
    } finally {
      if (sampleRun.current === run) setVoiceBusy(false);
    }
  };
  const applyTuning = async () => {
    if (!dirty || savingTuning) return;
    setSavingTuning(true);
    setError('');
    try {
      setConfig(await updateVoice(runtime.store, cid, { localTuning: tuning }));
      setDraft(undefined);
    } catch {
      setError('没有保存成功');
    } finally {
      setSavingTuning(false);
    }
  };
  const stopPreview = async () => {
    sampleRun.current++;
    setBusy(false);
    setVoiceBusy(false);
    await referenceDriver.stop();
  };
  const preview = async () => {
    const run = ++sampleRun.current;
    setBusy(true);
    setError('');
    setVoiceNote('');
    try {
      await referenceDriver.stop();
      if (sampleRun.current !== run) return;
      const played = await referenceDriver.play(`preview:${Date.now()}`, sample, {
        ...config,
        localTuning: tuning,
        referenceVoice: undefined,
        enabled: true,
      });
      if (!played && sampleRun.current === run) setError('这次试听未完成，请稍后重试。');
    } catch {
      if (sampleRun.current === run) setError('这次试听暂时不可用，请检查官方语音配置。');
    } finally {
      if (sampleRun.current === run) setBusy(false);
    }
  };
  return (
    <Page>
      <Heading>声音</Heading>
      <Note>默认使用 DeepSeek 语音。普通朗读无需换声服务；网络不可用时自动尝试本机离线声音。</Note>
      <ErrorText text={error} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: palette.ink }}>消息语音</Text>
        <Switch
          accessibilityLabel="消息语音"
          value={config.enabled}
          disabled={busy || voiceBusy || savingTuning}
          onValueChange={(enabled) => void save({ enabled, playbackSet: true })}
        />
      </View>
      <Card>
        <Text style={{ color: palette.ink, fontWeight: '600' }}>DeepSeek 基础声音</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['stella', 'tide'] as const).map((id) => (
            <TextButton
              key={id}
              title={`${(config.deepSeekVoice ?? 'stella') === id ? '✓ ' : ''}${id === 'stella' ? 'Stella' : 'Tide'}`}
              disabled={busy || voiceBusy || savingTuning}
              onPress={() => void save({ deepSeekVoice: id })}
            />
          ))}
        </View>
        <Note>基础声音选择会直接保存；下方微调可以先试听再应用。</Note>
      </Card>
      <Card>
        <Text style={{ color: palette.ink, fontWeight: '600' }}>本地声音微调</Text>
        <Note>
          DeepSeek 生成语音后在本机调整，不需要换声服务。试听不会保存；点「应用到聊天」后生效。
        </Note>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {presets.map((preset) => (
            <TextButton
              key={preset.label}
              title={preset.label}
              disabled={busy || voiceBusy || savingTuning}
              onPress={() => setDraft({ ...preset.tuning })}
            />
          ))}
          <TextButton
            title="重置"
            disabled={
              busy || voiceBusy || savingTuning || sameTuning(tuning, defaultLocalVoiceTuning)
            }
            onPress={() => setDraft({ ...defaultLocalVoiceTuning })}
          />
        </View>
        {controls.map(([key, label, min, max, step]) => {
          const value = tuningLabel(key, tuning[key]);
          return (
            <View key={key}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: palette.ink }}>{label}</Text>
                <Text style={{ color: palette.muted, fontVariant: ['tabular-nums'] }}>{value}</Text>
              </View>
              <Slider
                testID={`local-voice-${key}`}
                accessibilityLabel={label}
                accessibilityValue={{ text: value }}
                style={{ height: 44 }}
                minimumValue={min}
                maximumValue={max}
                step={step}
                value={tuning[key]}
                minimumTrackTintColor={palette.accent}
                maximumTrackTintColor={palette.line}
                thumbTintColor={palette.accent}
                disabled={busy || voiceBusy || savingTuning}
                onValueChange={(number) =>
                  setDraft((previous) => ({
                    ...(previous ?? savedTuning),
                    [key]: Math.max(min, Math.min(max, Math.round(number * 100) / 100)),
                  }))
                }
              />
            </View>
          );
        })}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              title={busy ? '停止试听' : '普通试听'}
              secondary
              disabled={savingTuning || voiceBusy}
              onPress={() => void (busy ? stopPreview() : preview())}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="应用到聊天"
              disabled={!dirty || busy || voiceBusy || savingTuning}
              onPress={() => void applyTuning()}
            />
          </View>
        </View>
      </Card>
      <Card>
        <Text style={{ color: palette.ink, fontWeight: '600' }}>参考音色</Text>
        <Note>
          {config.referenceVoice
            ? `当前：${config.referenceVoice.label}。DeepSeek 生成语音后${localModel?.enabled ? '仅在本机换声' : '由已配置的远程服务换声'}；换声不可用时保留同一次 DeepSeek 原声。`
            : '在聊天里说「我希望你的声音跟某个角色一样」可查找。也可以选择有权使用的 WAV。'}
        </Note>
        {config.referenceCandidate ? (
          <>
            <Note>{`已找到：${config.referenceCandidate.label}（尚未换声）`}</Note>
            <TextButton
              title={voiceBusy ? '停止试听' : '试听找到的声音'}
              onPress={() => void previewReference(true)}
            />
            <TextButton
              title="我有权使用，设为参考音色"
              disabled={busy || voiceBusy}
              onPress={() => void selectFoundReference()}
            />
            <TextButton
              title="移除找到的录音"
              disabled={busy || voiceBusy}
              onPress={() =>
                void runtime.referenceVoice
                  .clearCandidate(cid)
                  .then(syncVoice)
                  .catch(() => setVoiceNote('没能移除这段录音'))
              }
            />
          </>
        ) : null}
        <TextButton
          title="导入有权使用的参考 WAV"
          disabled={busy || voiceBusy}
          onPress={() => void selectWav()}
        />
        {config.referenceVoice ? (
          <>
            <TextButton
              title={voiceBusy ? '停止试听' : '试听换声'}
              onPress={() => void previewReference(false)}
            />
            <TextButton
              title="恢复 DeepSeek 原声"
              disabled={busy || voiceBusy}
              onPress={() =>
                void runtime.referenceVoice
                  .clear(cid)
                  .then(syncVoice)
                  .catch(() => setVoiceNote('没有保存成功'))
              }
            />
          </>
        ) : null}
        <Details title={localModel?.enabled ? '本机换声 · 已启用（实验）' : '本机换声（实验）'}>
          <Note>
            ARM64 安装包附带经校验的 OpenVoice V2 模型，无需联网下载。首次使用需准备到手机私有目录。
            开启后，参考录音和换声运算留在手机；DeepSeek 朗读仍需要联网。
            换声失败只播放原声，不自动改用远程换声。音质仍在验证中。
          </Note>
          <LocalVoicePrepare
            onReady={() => {
              void localVoiceState()
                .then(setLocalModel)
                .catch(() => {});
            }}
          />
          <Note>{localModel?.detail ?? '正在读取本机模型状态…'}</Note>
          <TextButton
            title={modelBusy ? '正在处理模型…' : '导入本机模型 ZIP'}
            disabled={modelBusy || busy || voiceBusy}
            onPress={() => void importModel()}
          />
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text style={{ color: palette.ink }}>启用本机参考换声</Text>
            <Switch
              accessibilityLabel="启用本机参考换声"
              value={!!localModel?.enabled}
              disabled={modelBusy || (!localModel?.available && !localModel?.enabled)}
              onValueChange={(value) => void toggleLocalModel(value)}
            />
          </View>
        </Details>
        <Details title={connection ? '换声服务 · 已保存' : '连接换声服务'}>
          <Note>
            请使用你信任的服务。换声时会把合成音频和参考音频发送给它，不会发 DeepSeek Key。
          </Note>
          <Field
            label="换声服务地址"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="url"
            placeholder={__DEV__ ? 'http://127.0.0.1:4319 或 HTTPS' : 'https://你的换声服务'}
            value={endpoint}
            onChangeText={setEndpoint}
          />
          <Field
            label="换声服务令牌"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="off"
            value={token}
            onChangeText={setToken}
          />
          <TextButton title="保存服务连接" onPress={() => void applyCompanion()} />
          {connection ? (
            <TextButton
              title="断开换声服务"
              onPress={() => void clearCompanion().catch(() => setVoiceNote('没有断开成功'))}
            />
          ) : null}
        </Details>
        {voiceNote ? <Note>{voiceNote}</Note> : null}
      </Card>
    </Page>
  );
}
