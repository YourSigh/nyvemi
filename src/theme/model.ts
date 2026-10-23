import { z } from 'zod';
export const ThemePreferenceSchema = z
  .object({
    base: z.enum(['pink', 'blue', 'purple', 'peach', 'mint', 'red', 'amber', 'neutral']),
    mood: z.enum(['gentle', 'calm', 'playful', 'dreamy', 'minimal']),
    saturation: z.enum(['low', 'medium']),
    brightness: z.enum(['light', 'dark']),
    temperature: z.enum(['warm', 'cool', 'neutral']),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;
export const ThemeRecordSchema = z
  .object({
    id: z.literal('app'),
    version: z.literal(1),
    preference: ThemePreferenceSchema,
    description: z.string().max(500),
    source: z.enum(['model', 'local', 'default']),
    createdAt: z.number(),
  })
  .strict();
export type ThemeRecord = z.infer<typeof ThemeRecordSchema>;
export interface Palette {
  background: string;
  paper: string;
  ink: string;
  muted: string;
  accent: string;
  onAccent: string;
  tint: string;
  line: string;
  error: string;
}
export const defaultPreference: ThemePreference = {
  base: 'pink',
  mood: 'gentle',
  saturation: 'low',
  brightness: 'light',
  temperature: 'warm',
  confidence: 1,
};
