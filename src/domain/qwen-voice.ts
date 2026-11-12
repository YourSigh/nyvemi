import { z } from 'zod';

export const QwenSpeakerSchema = z.enum([
  'serena',
  'vivian',
  'uncle_fu',
  'dylan',
  'eric',
  'ryan',
  'aiden',
  'ono_anna',
  'sohee',
]);
export type QwenSpeaker = z.infer<typeof QwenSpeakerSchema>;

export const qwenTuningRanges = {
  rate: { min: 0.8, max: 1.2, step: 0.05 },
  pitch: { min: 0.9, max: 1.1, step: 0.025 },
  volume: { min: 0.25, max: 1, step: 0.05 },
} as const;

export const QwenTuningSchema = z
  .object({
    rate: z.number().min(qwenTuningRanges.rate.min).max(qwenTuningRanges.rate.max),
    pitch: z.number().min(qwenTuningRanges.pitch.min).max(qwenTuningRanges.pitch.max),
    volume: z.number().min(qwenTuningRanges.volume.min).max(qwenTuningRanges.volume.max),
  })
  .strict();

export type QwenTuning = z.infer<typeof QwenTuningSchema>;
export const originalQwenSound: QwenTuning = { rate: 1, pitch: 1, volume: 1 };
