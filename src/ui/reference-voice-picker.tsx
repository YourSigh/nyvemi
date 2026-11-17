import { LocalVoiceDownload } from './local-voice-download';
import { strictReferencePreview } from '../speech/strict-reference-preview';
import { tuneSpeechWav } from '../speech/local-tuning';
import { voiceOptions } from '../speech/preferences';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { bridge, type LocalVoiceState, type VoiceReferenceCandidate } from '../native/android';
import type { VoiceReference } from '../domain/models';
import { localVoiceState, localVoiceConversion, setLocalVoiceEnabled } from '../speech/local-voice';
import { applyLocalReference } from '../speech/apply-local-reference';
import {
  loadReferenceWav,
  playReferenceWav,
  readPickedReference,
} from '../speech/reference-storage';
import type { ReferenceLookupResult } from '../speech/reference-lookup';
import { useRuntime } from './context';
import { usePalette } from '../theme/context';
import { Button, Note, TextButton } from './components';

export function ReferenceVoicePicker({
  characterId,
  query,
  onSettings,
  onApplied,
}: {
  characterId: string;
  query: string;
  onSettings(): void;
  onApplied?(): void;
}) {
  const runtime = useRuntime(),
    palette = usePalette();
  const [model, setModel] = useState<LocalVoiceState>();
  const [result, setResult] = useState<ReferenceLookupResult>(
    () => runtime.voiceReferenceLookup.peek(characterId, query) ?? { candidates: [] },
  );
  const [selected, setSelected] = useState<VoiceReference>();
  const [applied, setApplied] = useState<VoiceReference>();
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const generation = useRef(0),
    rawPlaying = useRef(false),
    running = useRef(false),
    previewAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    let alive = true;
    const run = ++generation.current;
    setResult(runtime.voiceReferenceLookup.peek(characterId, query) ?? { candidates: [] });
    void Promise.all([localVoiceState(), runtime.store.get('settings', characterId)])
      .then(([state, settings]) => {
        if (!alive || generation.current !== run) return;
        setModel(state);
        if (state.available && runtime.voiceReferenceLookup.takeDeferredModel(characterId, query)) {
          void runtime.voiceReferenceLookup.find(characterId, query).then((found) => {
            if (alive && generation.current === run) setResult(found);
          });
        }
        setSelected(
          settings?.voice?.referenceCandidate?.query === query
            ? settings.voice.referenceCandidate
            : undefined,
        );
        setApplied(
          settings?.voice?.referenceVoice?.query === query
            ? settings.voice.referenceVoice
            : undefined,
        );
      })
      .catch(() => {
        if (alive) setNote('无法读取声音设置，原声未改变。');
      });
    return () => {
      alive = false;
      generation.current = run + 1;
      if (previewAbort.current) {
        previewAbort.current.abort();
        void localVoiceConversion.cancel().catch(() => {});
      }
      if (rawPlaying.current || previewAbort.current) void bridge().stopSpeech();
    };
  }, [runtime, characterId, query]);
  const operate = async (label: string, work: (run: number) => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    const run = generation.current;
    setBusy(label);
    setNote('');
    try {
      await work(run);
    } catch (e) {
      if (generation.current === run)
        setNote(`${e instanceof Error ? e.message : '操作未完成'}。尚未切换参考音色。`);
    } finally {
      running.current = false;
      if (generation.current === run) setBusy('');
    }
  };
  const search = () =>
    operate('查找中文参考录音…', async (run) => {
      const state = await localVoiceState();
      if (generation.current !== run) return;
      setModel(state);
      if (!state.available) throw Error('请先点击下载并安装本机模型');
      const found = await runtime.voiceReferenceLookup.find(characterId, query);
      if (generation.current !== run) return;
      setResult(found);
      if (!found.candidates.length)
        setNote(found.error ?? `没有找到「${query}」的可读取中文录音，不会用其他角色代替。`);
    });
  const preview = (candidate: VoiceReferenceCandidate) =>
    operate('下载并试听原录音…', async (run) => {
      await bridge().stopSpeech();
      const downloaded = await bridge().downloadVoiceReference(
        candidate.audioUrl,
        candidate.sourceUrl,
      );
      if (generation.current !== run) return;
      const bytes = await readPickedReference(downloaded.uri);
      if (generation.current !== run) return;
      const saved = await runtime.referenceVoice.stageCandidate(characterId, bytes, {
        ...candidate,
        query,
      });
      if (generation.current !== run) return;
      setSelected(saved);
      rawPlaying.current = true;
      try {
        const played = await playReferenceWav(`candidate:${saved.id}`, bytes);
        if (generation.current === run)
          setNote(
            played
              ? '原录音试听完成，尚未切换音色。这不是本机转换结果。'
              : '原录音未播放完成，尚未切换音色。',
          );
      } finally {
        rawPlaying.current = false;
      }
    });
  const previewConverted = () =>
    operate('准备本机换声试听…', async (run) => {
      if (!selected) throw Error('请先选中一段参考录音');
      const exactId = selected.id;
      const controller = new AbortController();
      previewAbort.current = controller;
      try {
        await bridge().stopSpeech();
        const options = voiceOptions((await runtime.store.get('settings', characterId))?.voice);
        await strictReferencePreview(
          {
            ready: async () => (await localVoiceState()).available,
            loadReference: loadReferenceWav,
            synthesize: (signal) =>
              runtime.referenceTransport.synthesize(
                '你好，这是本机换声试听。',
                signal,
                options.deepSeekVoice,
              ),
            convert: (source, reference, signal) =>
              localVoiceConversion.preview(source, reference, signal),
            tune: options.localTuning
              ? (bytes, signal) => tuneSpeechWav(bytes, options.localTuning!, signal)
              : undefined,
            play: (bytes) => playReferenceWav(`converted-preview:${exactId}`, bytes),
          },
          exactId,
          controller.signal,
        );
        if (generation.current === run)
          setNote('本机转换试听已播放完成，仅为试听，未应用此参考，也未改变原有设置。');
      } catch {
        if (generation.current === run)
          setNote(
            controller.signal.aborted
              ? '换声试听已停止，未应用此参考。'
              : '本机换声试听未成功，未播放原声替代，也未应用此参考。请检查模型与语音配置后重试。',
          );
      } finally {
        if (previewAbort.current === controller) previewAbort.current = null;
      }
    });
  const stopConvertedPreview = async () => {
    previewAbort.current?.abort();
    await Promise.all([localVoiceConversion.cancel(), bridge().stopSpeech()]);
  };
  const apply = () =>
    operate('正在应用参考音色…', async (run) => {
      if (!selected) throw Error('请先下载并核对一段录音');
      await loadReferenceWav(selected.id);
      if (generation.current !== run) return;
      await applyLocalReference(
        {
          state: localVoiceState,
          enable: setLocalVoiceEnabled,
          apply: runtime.referenceVoice.useCandidate,
        },
        characterId,
        selected.id,
      );
      if (generation.current !== run) return;
      setApplied(selected);
      setSelected(undefined);
      setModel((previous) => ({
        ...(previous ?? { available: true, detail: '本机模型已就绪' }),
        enabled: true,
      }));
      setNote(
        `已应用「${selected.label}」并启用本机换声，之后复用这同一段参考录音。尚未试听转换效果；转换失败会明确提示并播放原声。`,
      );
      try {
        onApplied?.();
      } catch {
        /* Saved state remains authoritative. */
      }
    });
  return (
    <View style={{ gap: 8 }}>
      {applied && model?.enabled ? (
        <Note>{`已应用：${applied.label}。本机换声已开启。`}</Note>
      ) : null}
      {busy ? <Note>{busy}</Note> : null}
      {note ? <Note>{note}</Note> : null}
      {!model?.available ? (
        <LocalVoiceDownload
          onReady={() => {
            void localVoiceState()
              .then((state) => {
                setModel(state);
                if (
                  state.available &&
                  runtime.voiceReferenceLookup.takeDeferredModel(characterId, query)
                )
                  void search();
              })
              .catch(() => setNote('模型已下载，读取状态失败，请重试查找。'));
          }}
        />
      ) : null}
      {result.candidates.map((candidate) => (
        <View key={candidate.id} style={{ gap: 4 }}>
          <Text style={{ color: palette.ink, fontWeight: '600' }}>{candidate.label}</Text>
          <Text selectable style={{ color: palette.muted, fontSize: 12 }}>
            {candidate.sourceUrl}
          </Text>
          <Note>中文 · 公开原录音仅供试听，不代表已获换声授权。</Note>
          <TextButton
            title={`下载并试听：${candidate.label}`}
            disabled={!!busy}
            onPress={() => void preview(candidate)}
          />
        </View>
      ))}
      {selected ? (
        <View style={{ gap: 4 }}>
          <Note>{`待应用：${selected.label}（尚未切换）`}</Note>
          <Text selectable style={{ color: palette.muted, fontSize: 12 }}>
            {selected.sourceUrl}
          </Text>
          <Note>
            换声试听会请求一次 DeepSeek 朗读（按其标准计费），只在本机转换；不会自动应用。
          </Note>
          <Button
            secondary
            title="我有权使用，试听本机换声（不应用）"
            disabled={!!busy || !model?.available}
            onPress={() => void previewConverted()}
          />
          {busy === '准备本机换声试听…' ? (
            <TextButton
              title="停止换声试听"
              onPress={() => void stopConvertedPreview().catch(() => {})}
            />
          ) : null}
          <Button
            title="我有权使用，设为参考音色"
            disabled={!!busy || !model?.available}
            onPress={() => void apply()}
          />
        </View>
      ) : null}
      {model?.available ? (
        <TextButton
          title={result.candidates.length ? '重新查找同一角色' : `重试查找「${query}」中文参考声`}
          disabled={!!busy}
          onPress={() => void search()}
        />
      ) : null}
      <TextButton title="打开声音设置 / 导入自己的 WAV" onPress={onSettings} />
    </View>
  );
}
