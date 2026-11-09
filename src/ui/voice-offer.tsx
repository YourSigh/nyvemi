import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { AppState, Text, View } from 'react-native';
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
  const active = useRef(false);
  const [packReady, setPackReady] = useState(!offer.requiresPack);
  const [downloading, setDownloading] = useState(false);
  const [playing, setPlaying] = useState(false);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      if (offer.requiresPack) {
        void bridge()
          .speechState()
          .then((value) => {
            if (active.current) setPackReady(Boolean(value.expanded));
          })
          .catch(() => {});
      }
      return () => {
        active.current = false;
      };
    }, [offer.requiresPack]),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const preview = async () => {
    if (playing) {
      await bridge()
        .stopSpeech()
        .catch(() => {});
      return;
    }
    setError('');
    if (!packReady) {
      setDownloading(true);
      try {
        await bridge().downloadVoicePack();
        if (active.current) setPackReady(true);
      } catch {
        setError('音色下载失败，请检查网络和剩余空间');
        return;
      } finally {
        setDownloading(false);
      }
    }
    if (!active.current || AppState.currentState !== 'active') return;
    beforePreview();
    setPlaying(true);
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
          title={
            downloading
              ? '正在下载…'
              : playing
                ? '停止试听'
                : packReady
                  ? '试听'
                  : '下载试听 · 54 MB'
          }
          disabled={saving || downloading}
          onPress={() => void preview()}
        />
        <TextButton
          title="就用这个"
          disabled={saving || downloading || !packReady}
          onPress={() => void decide(true)}
        />
        <TextButton
          title="先不换"
          disabled={saving || downloading}
          onPress={() => void decide(false)}
        />
      </View>
    </View>
  );
}
