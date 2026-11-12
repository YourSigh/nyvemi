import { QwenPackCard, useQwenPack } from './qwen-pack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Switch, View, Text } from 'react-native';
import Slider from '@react-native-community/slider';
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
import { Page, Heading, Note, Details, Button, TextButton, ErrorText, Card } from './components';
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
        void localSpeechDriver.stop().catch(() => {});
      };
    }, [refresh]),
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
