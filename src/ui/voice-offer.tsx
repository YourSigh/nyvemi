import { useState } from 'react';
import { Text, View } from 'react-native';
import type { VoiceOffer } from '../domain/models';
import { bridge } from '../native/android';
import { usePalette } from '../theme/context';
import { ErrorText, TextButton } from './components';

export function VoiceOfferCard({
  offer,
  beforePreview,
  onDecision,
}: {
  offer: VoiceOffer;
  beforePreview(): void;
  onDecision(accept: boolean): Promise<void>;
}) {
  const palette = usePalette();
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const preview = async () => {
    if (playing) {
      await bridge().stopSpeech();
      return;
    }
    beforePreview();
    setPlaying(true);
    setError('');
    try {
      await bridge().speakLocal(
        `voice-offer:${Date.now()}`,
        '嗨，这个声音怎么样？',
        offer.voiceId,
        offer.rate,
        1,
      );
    } catch {
      setError('试听失败，点一下再试');
    } finally {
      setPlaying(false);
    }
  };
  const decide = async (accept: boolean) => {
    setSaving(true);
    try {
      if (playing) await bridge().stopSpeech();
      await onDecision(accept);
    } catch {
      setError('没有保存成功，请重试');
      setSaving(false);
    }
  };
  return (
    <View style={{ backgroundColor: palette.paper, padding: 8, borderRadius: 14 }}>
      <Text style={{ color: palette.ink, paddingHorizontal: 8 }}>试试这个声音 · {offer.label}</Text>
      <ErrorText text={error} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <TextButton
          title={playing ? '停止试听' : '试听'}
          disabled={saving}
          onPress={() => void preview()}
        />
        <TextButton title="就用这个" disabled={saving} onPress={() => void decide(true)} />
        <TextButton title="先不换" disabled={saving} onPress={() => void decide(false)} />
      </View>
    </View>
  );
}
