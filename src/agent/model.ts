import { z } from 'zod';
export const AgentSessionSchema = z
  .object({
    id: z.string(),
    characterId: z.string(),
    sessionId: z.string(),
    version: z.literal(1),
    events: z.array(z.unknown()).max(10000),
    createdAt: z.number(),
    updatedAt: z.number(),
    nextExploreAt: z.number().optional(),
    lastInputId: z.string().optional(),
    lastRunStatus: z.enum(['running', 'complete', 'error']).optional(),
  })
  .strict();
export type AgentSession = z.infer<typeof AgentSessionSchema>;
export const AgentEvidenceSchema = z
  .object({
    id: z.string(),
    characterId: z.string(),
    source: z.string(),
    url: z.string(),
    title: z.string(),
    text: z.string(),
    createdAt: z.number(),
    expiresAt: z.number(),
  })
  .strict();
export type AgentEvidence = z.infer<typeof AgentEvidenceSchema>;
