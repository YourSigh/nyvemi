import { useCallback, useState } from 'react';
import { Switch, View, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { bridge, type LocalSpeechState } from '../native/android';
import { voiceProfile } from '../characters/hatching';
import { useRuntime } from './context';
import { usePalette } from '../theme/context';
import { Page, Heading, Note, Details, Button, TextButton, ErrorText } from './components';
import type { ScreenProps } from './navigation';
import type { VoiceOptions } from '../speech/queue';
export function VoiceSettingsScreen({ route }: ScreenProps<'VoiceSettings'>) {
  const runtime = useRuntime(),
    palette = usePalette(),
    cid = route.params.characterId;
  const [voices, setVoices] = useState<LocalSpeechState>();
  const [config, setConfig] = useState<VoiceOptions>({ ...voiceProfile(), enabled: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const settings = await runtime.store.get('settings', cid);
    if (settings?.voice) setConfig(settings.voice);
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
  const save = async (next: VoiceOptions) => {
    const settings = await runtime.store.get('settings', cid);
    if (!settings) throw Error('角色不存在');
    await runtime.store.put('settings', { ...settings, voice: next });
    setConfig(next);
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
      <Note>本机朗读，不消耗模型额度。</Note>
      <ErrorText text={error} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: palette.ink }}>自动读出新消息</Text>
        <Switch
          accessibilityLabel="自动读出新消息"
          value={config.enabled}
          onValueChange={(enabled) => {
            void save({ ...config, enabled }).catch(() => setError('没有保存成功'));
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
                onPress={() =>
                  void save({ ...config, ...voiceProfile(style), enabled: config.enabled }).catch(
                    () => setError('没有保存成功'),
                  )
                }
              />
            ))}
          </View>
          <Details title="换个音色">
            {voices.voices.map((voice) => (
              <TextButton
                key={voice.id}
                title={`${voice.id === (config.voiceId ?? voices.preferred) ? '✓ ' : ''}${voice.label}`}
                onPress={() =>
                  void save({ ...config, voiceId: voice.id }).catch(() => setError('没有保存成功'))
                }
              />
            ))}
          </Details>
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
