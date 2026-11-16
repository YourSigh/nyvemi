import { QwenPackCard, useQwenPack } from './qwen-pack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Switch, View, Text } from 'react-native';
import Slider from '@react-native-community/slider';
import * as DocumentPicker from 'expo-document-picker';
import {
  originalQwenSound,
  qwenTuningRanges,
  type QwenSpeaker,
  type QwenTuning,
} from '../domain/qwen-voice';
import { useFocusEffect } from '@react-navigation/native';
import { bridge, type LocalSpeechState } from '../native/android';
import { localSpeechDriver, warmLocalSpeech } from '../speech/native';
import {
  deleteVoiceCompanion,
  getVoiceCompanion,
  loadReferenceWav,
  playReferenceWav,
  readPickedReference,
  saveVoiceCompanion,
} from '../speech/reference-storage';
import {
  qwenSpeaker,
  qwenTuning,
  updateQwenTuning,
  qwenVoices,
  updateVoice,
  voiceOptions,
  voiceProfile,
  type VoiceOptions,
} from '../speech/preferences';
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
const controls = [
  ['rate', '语速'],
  ['pitch', '音高'],
  ['volume', '音量'],
] as const;
const sameTuning = (a: QwenTuning, b: QwenTuning) =>
  a.rate === b.rate && a.pitch === b.pitch && a.volume === b.volume;

function tuningLabel(key: keyof QwenTuning, value: number) {
  if (key === 'rate') return `${value.toFixed(2)}×`;
  if (key === 'volume') return `${Math.round(value * 100)}%`;
  const change = Number(((value - 1) * 100).toFixed(1));
  return change === 0 ? '原声' : `${change > 0 ? '+' : ''}${change}%`;
}

export function VoiceSettingsScreen({ route }: ScreenProps<'VoiceSettings'>) {
  const runtime = useRuntime(),
    palette = usePalette(),
    cid = route.params.characterId;
  const [voices, setVoices] = useState<LocalSpeechState>();
  const pack = useQwenPack(cid);
  const qwen = pack.status?.phase === 'ready';
  const [config, setConfig] = useState<VoiceOptions>(voiceProfile());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingTuning, setSavingTuning] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [token, setToken] = useState('');
  const [connection, setConnection] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceNote, setVoiceNote] = useState('');
  const sampleRun = useRef(0);
  const referenceDriver = useMemo(() => runtime.voiceDriver(setVoiceNote), [runtime]);
  const [draft, setDraft] = useState<{ speaker: QwenSpeaker; tuning: QwenTuning }>();
  const autoplay = useRef(false);
  const speaker = qwen ? qwenSpeaker(config) : undefined;
  const savedTuning = speaker ? qwenTuning(config, speaker) : originalQwenSound;
  const tuning = draft && draft.speaker === speaker ? draft.tuning : savedTuning;
  const dirty = !sameTuning(tuning, savedTuning);
  const refresh = useCallback(async () => {
    const settings = await runtime.store.get('settings', cid);
    const options = voiceOptions(settings?.voice);
    autoplay.current = options.enabled;
    setConfig(options);
    setDraft(undefined);
    warmLocalSpeech(options);
    const native = bridge();
    setVoices(await native.speechState());
  }, [runtime, cid]);
  useFocusEffect(
    useCallback(() => {
      void refresh().catch(() => setError('读取本机声音失败'));
      return () => {
        sampleRun.current++;
        void referenceDriver.stop().catch(() => {});
      };
    }, [refresh, referenceDriver]),
  );
  useEffect(() => {
    if (!qwen) return;
    void runtime.store
      .get('settings', cid)
      .then((settings) => {
        const options = voiceOptions(settings?.voice);
        setConfig(options);
        warmLocalSpeech(options);
      })
      .catch(() => {});
  }, [cid, qwen, runtime]);
  const save = async (patch: Partial<VoiceOptions>) => {
    try {
      const next = await updateVoice(runtime.store, cid, patch);
      setError('');
      autoplay.current = next.enabled;
      setConfig(next);
      if ('voiceId' in patch && patch.voiceId !== config.voiceId) setDraft(undefined);
      if (!next.enabled || !qwenSpeaker(next)) await bridge().releaseQwenVoice();
      else warmLocalSpeech(next);
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
    autoplay.current = next.enabled;
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
    setVoiceNote('已断开换声服务。原有离线语音不受影响。');
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
    if (voiceBusy) return stopReferencePreview();
    const run = ++sampleRun.current;
    setVoiceBusy(true);
    setVoiceNote('');
    try {
      if (candidate && config.referenceCandidate) {
        const bytes = await loadReferenceWav(config.referenceCandidate.id);
        if (sampleRun.current === run) await playReferenceWav(`reference:${Date.now()}`, bytes);
      } else if (config.referenceVoice) {
        await referenceDriver.play(`reference:${Date.now()}`, sample, { ...config, enabled: true });
      }
    } catch {
      if (sampleRun.current === run) setVoiceNote('这段声音暂时无法播放');
    } finally {
      if (sampleRun.current === run) setVoiceBusy(false);
    }
  };
  const applyTuning = async () => {
    if (!speaker || !dirty || savingTuning) return;
    setSavingTuning(true);
    setError('');
    try {
      setConfig(await updateQwenTuning(runtime.store, cid, speaker, tuning));
      setDraft(undefined);
    } catch {
      setError('没有保存成功');
    } finally {
      setSavingTuning(false);
    }
  };
  const preview = async () => {
    setBusy(true);
    setError('');
    try {
      const id = `preview:${Date.now()}`;
      if (speaker)
        await bridge().speakQwen(id, sample, speaker, tuning.rate, tuning.pitch, tuning.volume);
      else
        await localSpeechDriver.play(id, sample, {
          ...config,
          voiceId: config.voiceId ?? 'system:default',
        });
    } catch {
      setError(
        speaker ? '这个声音暂时用不了，可以试试系统音色。' : '请安装中文语音包或换一个音色。',
      );
    } finally {
      if (!autoplay.current) void localSpeechDriver.release?.().catch(() => {});
      setBusy(false);
    }
  };
  return (
    <Page>
      <Heading>声音</Heading>
      <ErrorText text={error} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: palette.ink }}>消息语音</Text>
        <Switch
          accessibilityLabel="消息语音"
          value={config.enabled}
          disabled={busy || savingTuning}
          onValueChange={(enabled) => void save({ enabled, playbackSet: true })}
        />
      </View>
      <Card>
        <Text style={{ color: palette.ink, fontWeight: '600' }}>参考音色</Text>
        <Note>
          {config.referenceVoice
            ? `当前：${config.referenceVoice.label}。用 DeepSeek 生成语音，再由你配置的换声服务处理；不可用时回退本机声音。`
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
              disabled={voiceBusy}
              onPress={() => void selectFoundReference()}
            />
            <TextButton
              title="移除找到的录音"
              disabled={voiceBusy}
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
          disabled={voiceBusy}
          onPress={() => void selectWav()}
        />
        {config.referenceVoice ? (
          <>
            <TextButton
              title={voiceBusy ? '停止试听' : '试听换声'}
              onPress={() => void previewReference(false)}
            />
            <TextButton
              title="恢复本机音色"
              disabled={voiceBusy}
              onPress={() =>
                void runtime.referenceVoice
                  .clear(cid)
                  .then(syncVoice)
                  .catch(() => setVoiceNote('没有保存成功'))
              }
            />
          </>
        ) : null}
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
      <QwenPackCard pack={pack} />
      {qwen ? (
        <Details title={qwenVoices.find(({ id }) => id === speaker)?.label ?? 'Qwen 音色'}>
          {qwenVoices.map(({ id, label }) => (
            <TextButton
              key={id}
              title={`${id === speaker ? '✓ ' : ''}${label}`}
              disabled={busy || savingTuning}
              onPress={() => void save({ voiceId: `qwen:${id}` })}
            />
          ))}
        </Details>
      ) : null}
      {speaker ? (
        <Card>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text style={{ color: palette.ink, fontWeight: '600' }}>微调音色</Text>
            <TextButton
              title="恢复原声"
              disabled={busy || savingTuning || sameTuning(tuning, originalQwenSound)}
              onPress={() => setDraft({ speaker, tuning: originalQwenSound })}
            />
          </View>
          {controls.map(([key, label]) => {
            const range = qwenTuningRanges[key];
            const value = tuningLabel(key, tuning[key]);
            return (
              <View key={key}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: palette.ink }}>{label}</Text>
                  <Text style={{ color: palette.muted, fontVariant: ['tabular-nums'] }}>
                    {value}
                  </Text>
                </View>
                <Slider
                  testID={`qwen-voice-${key}`}
                  accessibilityLabel={label}
                  accessibilityValue={{ text: value }}
                  style={{ height: 44 }}
                  minimumValue={range.min}
                  maximumValue={range.max}
                  step={range.step}
                  value={tuning[key]}
                  minimumTrackTintColor={palette.accent}
                  maximumTrackTintColor={palette.line}
                  thumbTintColor={palette.accent}
                  disabled={busy || savingTuning}
                  onValueChange={(number) =>
                    setDraft((previous) => ({
                      speaker,
                      tuning: {
                        ...(previous?.speaker === speaker ? previous.tuning : savedTuning),
                        [key]: Math.max(
                          range.min,
                          Math.min(range.max, Math.round(number * 1000) / 1000),
                        ),
                      },
                    }))
                  }
                />
              </View>
            );
          })}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button
                title={busy ? '停止试听' : '试听'}
                secondary
                disabled={savingTuning}
                onPress={() => {
                  if (busy) void localSpeechDriver.stop().catch(() => {});
                  else void preview();
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="应用到聊天"
                disabled={!dirty || busy || savingTuning}
                onPress={() => void applyTuning()}
              />
            </View>
          </View>
        </Card>
      ) : null}
      <Details title={speaker ? '系统音色' : '换个系统音色'}>
        {!voices ? (
          <Note>正在找本机音色…</Note>
        ) : voices.available ? (
          <>
            <TextButton
              title="系统默认"
              disabled={busy || savingTuning}
              onPress={() => void save({ voiceId: 'system:default' })}
            />
            {voices.voices.map((voice) => (
              <TextButton
                key={voice.id}
                title={`${voice.id === config.voiceId ? '✓ ' : ''}${voice.label}`}
                disabled={busy || savingTuning}
                onPress={() => void save({ voiceId: voice.id })}
              />
            ))}
            {!speaker ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {[
                  ['gentle', '轻柔'],
                  ['bright', '清亮'],
                  ['calm', '自然'],
                  ['low', '低缓'],
                ].map(([style, label]) => (
                  <TextButton
                    key={style}
                    title={label}
                    onPress={() => {
                      const { rate, pitch } = voiceProfile(style);
                      void save({ rate, pitch });
                    }}
                  />
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Button
              title="安装系统语音包"
              onPress={() =>
                void bridge()
                  .installSpeechData()
                  .catch(() => setError('请在系统设置中打开文字转语音'))
              }
            />
            <TextButton
              title="重新检查"
              onPress={() => void refresh().catch(() => setError('读取失败'))}
            />
          </>
        )}
      </Details>
      {!speaker && voices?.available ? (
        <Button
          title={busy ? '停止试听' : '听听这个声音'}
          onPress={() => {
            if (busy) void localSpeechDriver.stop();
            else void preview();
          }}
        />
      ) : null}
    </Page>
  );
}
