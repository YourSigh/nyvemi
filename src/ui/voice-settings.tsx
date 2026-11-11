import { useCallback, useState } from 'react';
import { Switch, View, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { bridge, type LocalSpeechState } from '../native/android';
import { updateVoice, voiceOptions, voiceProfile, type VoiceOptions } from '../speech/preferences';
import { useRuntime } from './context';
import { usePalette } from '../theme/context';
import { Page, Heading, Note, Details, Button, TextButton, ErrorText } from './components';
import type { ScreenProps } from './navigation';
export function VoiceSettingsScreen({ route }: ScreenProps<'VoiceSettings'>) {
  const runtime = useRuntime(),
    palette = usePalette(),
    cid = route.params.characterId;
  const [voices, setVoices] = useState<LocalSpeechState>();
  const [config, setConfig] = useState<VoiceOptions>(voiceProfile());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const settings = await runtime.store.get('settings', cid);
    setConfig(voiceOptions(settings?.voice));
    setVoices(await bridge().speechState());
  }, [runtime, cid]);
  useFocusEffect(
    useCallback(() => {
      void refresh().catch(() => setError('读取本机声音失败'));
      return () => {
        void bridge()
          .stopSpeech()
          .catch(() => {});
      };
    }, [refresh]),
  );
  const save = async (patch: Partial<VoiceOptions>) => {
    setConfig(await updateVoice(runtime.store, cid, patch));
  };
  const preview = async () => {
    setBusy(true);
    setError('');
    try {
      await bridge().speakLocal(
        `preview:${Date.now()}`,
        '嗨，我在这儿。今天想和我聊点什么？',
        config.voiceId ?? null,
        config.rate,
        config.pitch,
      );
    } catch {
      setError('这个声音暂时用不了，试着安装语音包或换一个音色。');
    } finally {
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
          onValueChange={(enabled) => {
            void save({ enabled, playbackSet: true }).catch(() => setError('没有保存成功'));
          }}
        />
      </View>
      {!voices ? (
        <Note>正在找本机音色…</Note>
      ) : !voices.available ? (
        <>
          <Note>还没有可用的中文离线音色。</Note>
          <Button
            title="安装本机语音包"
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
      ) : (
        <>
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
                  void save({ rate, pitch }).catch(() => setError('没有保存成功'));
                }}
              />
            ))}
          </View>
          <Details title="换个音色">
            {voices.voices.map((voice) => (
              <TextButton
                key={voice.id}
                title={`${voice.id === (config.voiceId ?? voices.preferred) ? '✓ ' : ''}${voice.label}`}
                onPress={() =>
                  void save({ voiceId: voice.id }).catch(() => setError('没有保存成功'))
                }
              />
            ))}
          </Details>
          {error ? (
            <TextButton
              title="安装或修复语音包"
              onPress={() =>
                void bridge()
                  .installSpeechData()
                  .catch(() => setError('请在系统设置中打开文字转语音'))
              }
            />
          ) : null}
          <Button
            title={busy ? '停止试听' : '听听这个声音'}
            onPress={() => {
              if (busy) {
                void bridge().stopSpeech();
                setBusy(false);
              } else void preview();
            }}
          />
        </>
      )}
    </Page>
  );
}
