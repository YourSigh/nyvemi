import { z } from 'zod';
import catalog from './catalog.json';
import expandedCatalog from './expanded-catalog.json';

export const VoiceRequestSchema = z.object({
  tone: z.enum(['gentle', 'bright', 'calm', 'low']).optional(),
  gender: z.enum(['feminine', 'masculine']).optional(),
  pace: z.enum(['slow', 'natural', 'fast']).optional(),
});

export type VoiceRequest = z.infer<typeof VoiceRequestSchema>;

export function chooseVoice(request: VoiceRequest, expanded = false) {
  const candidates = (expanded ? expandedCatalog : catalog).filter(
    (voice) => !request.gender || request.gender === voice.gender,
  );
  const voice =
    candidates.find((candidate) => candidate.tone === request.tone) ??
    (request.tone === 'low'
      ? candidates.find((candidate) => candidate.tone === 'calm')
      : undefined) ??
    candidates[0];
  if (!voice) throw Error('当前没有匹配的音色');
  const rate =
    request.pace === 'slow'
      ? 0.85
      : request.pace === 'fast'
        ? 1.12
        : request.pace === 'natural'
          ? 1
          : voice.rate;
  return {
    voiceId: `kokoro:${voice.sid}`,
    label: voice.name,
    rate,
    ...(expanded ? { requiresPack: true as const } : {}),
  };
}

export const openingVoiceChoices: VoiceRequest[] = [
  { tone: 'gentle', gender: 'feminine', pace: 'slow' },
  { tone: 'bright' },
  { tone: 'calm' },
  { tone: 'low', pace: 'slow' },
];
