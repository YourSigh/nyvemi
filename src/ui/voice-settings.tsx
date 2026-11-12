import { useCallback, useRef, useState } from 'react';
import { Switch, View, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { bridge, type LocalSpeechState } from '../native/android';
import { localSpeechDriver, warmLocalSpeech } from '../speech/native';
import {
  qwenSpeaker,
  qwenVoices,
  updateVoice,
  voiceOptions,
  voiceProfile,
  type VoiceOptions,
} from '../speech/preferences';
import { useRuntime } from './context';
import { usePalette } from '../theme/context';
import { Page, Heading, Note, Details, Button, TextButton, ErrorText } from './components';
import type { ScreenProps } from './navigation';

const sample = '嗨，我在这儿。今天想和我聊点什么？';

export function VoiceSettingsScreen({ route }: ScreenProps<'VoiceSettings'>) {
  const runtime = useRuntime(),
    palette = usePalette(),
    cid = route.params.characterId;
  const [voices, setVoices] = useState<LocalSpeechState>();
  const [qwen, setQwen] = useState(false);
  const [config, setConfig] = useState<VoiceOptions>(voiceProfile());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const autoplay = useRef(false);
  const speaker = qwen ? qwenSpeaker(config) : undefined;
  const refresh = useCallback(async () => {
    const settings = await runtime.store.get('settings', cid);
    const options = voiceOptions(settings?.voice);
    autoplay.current = options.enabled;
    setConfig(options);
    warmLocalSpeech(options);
    const native = bridge();
    setQwen(await native.qwenVoiceAvailable());
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
  const save = async (patch: Partial<VoiceOptions>) => {
    try {
      const next = await updateVoice(runtime.store, cid, patch);
      setError('');
      autoplay.current = next.enabled;
      setConfig(next);
      if (!next.enabled || !qwenSpeaker(next)) await bridge().releaseQwenVoice();
      else warmLocalSpeech(next);
    } catch {
      setError('没有保存成功');
    }
  };
  const preview = async () => {
    setBusy(true);
    setError('');
    try {
      const id = `preview:${Date.now()}`;
      if (speaker) await bridge().speakQwen(id, sample, speaker);
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
          onValueChange={(enabled) => void save({ enabled, playbackSet: true })}
        />
      </View>
      {qwen ? (
        <Details title={qwenVoices.find(({ id }) => id === speaker)?.label ?? 'Qwen 音色'}>
          {qwenVoices.map(({ id, label }) => (
            <TextButton
              key={id}
              title={`${id === speaker ? '✓ ' : ''}${label}`}
              onPress={() => void save({ voiceId: `qwen:${id}` })}
            />
          ))}
        </Details>
      ) : null}
      <Details title={speaker ? '系统音色' : '换个系统音色'}>
        {!voices ? (
          <Note>正在找本机音色…</Note>
        ) : voices.available ? (
          <>
            <TextButton title="系统默认" onPress={() => void save({ voiceId: 'system:default' })} />
            {voices.voices.map((voice) => (
              <TextButton
                key={voice.id}
                title={`${voice.id === config.voiceId ? '✓ ' : ''}${voice.label}`}
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
      {speaker || voices?.available ? (
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
