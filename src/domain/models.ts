import type { MediaAsset, MediaSettings, ImageAnalysis, MediaDrawRequest } from '../media/model';
import type { InstalledPlugin, PluginPolicy } from '../extensions/model';
import type { AgentSession, AgentEvidence } from '../agent/model';
import { MeshAvatarSchema } from '../avatar/model';
import {
  RigSchema,
  type ImageSettings,
  type ImageRequestCache,
  type VisualDraft,
} from '../appearance/model';
import { expressionFields } from '../character/interaction';
import { z } from 'zod';
import type { ThemeRecord, ThemeOpening } from '../theme/model';
import type { HatchingDraft } from '../characters/hatching';
import type { InterviewDraft } from '../characters/interview';

export const PersonaSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(80),
    identity: z.string(),
    portrait: z.string().max(2400).optional(),
    dialogueExamples: z
      .array(
        z
          .object({
            user: z.string().max(300),
            messages: z.array(z.string().min(1).max(400)).max(4),
          })
          .strict(),
      )
      .max(4)
      .optional(),
    appearance: z.string().max(2000).optional(),
    corePersonality: z.array(z.string()),
    speechStyle: z.array(z.string()),
    relationshipStyle: z.array(z.string()),
    humorStyle: z.array(z.string()),
    initiativeStyle: z.array(z.string()),
    likes: z.array(z.string()),
    dislikes: z.array(z.string()),
    responsePreferences: z.array(z.string()),
    avoidPatterns: z.array(z.string()),
    boundaries: z.array(z.string()),
  })
  .strict();
export type Persona = z.infer<typeof PersonaSchema>;
export const StateSchema = z
  .object({
    mood: z.string().optional(),
    contactMode: z.enum(['open', 'quiet']).optional(),
    energy: z.number().min(0).max(1),
    relationshipCloseness: z.number().min(0).max(1),
    recentFocus: z.array(z.string()),
    curiosityTopics: z.array(z.string()),
  })
  .strict();
export type CharacterState = z.infer<typeof StateSchema>;
export const InterestSchema = z
  .object({
    topic: z.string(),
    score: z.number().min(0).max(1),
    source: z.enum(['initial', 'experience', 'conversation']),
    updatedAt: z.number(),
  })
  .strict();
export type Interest = z.infer<typeof InterestSchema>;
export const CharacterSchema = z
  .object({
    id: z.string(),
    persona: PersonaSchema,
    state: StateSchema,
    interests: z.array(InterestSchema),
    avatar: z.string().optional(),
    rig: RigSchema.optional(),
    meshAvatar: MeshAvatarSchema.optional(),
    appearancePending: z.boolean().optional(),
    egg: z.boolean().optional(),
    creationActive: z.boolean().optional(),
    createdAt: z.number(),
  })
  .strict();
export type Character = z.infer<typeof CharacterSchema>;
export const MemorySchema = z
  .object({
    id: z.string(),
    characterId: z.string(),
    type: z.enum(['semantic', 'episodic', 'relationship', 'open_loop', 'experience']),
    content: z.string().min(1),
    importance: z.number().min(0).max(1),
    createdAt: z.number(),
    updatedAt: z.number(),
    lastAccessedAt: z.number().optional(),
    accessCount: z.number().int().nonnegative(),
    expiresAt: z.number().optional(),
    source: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();
export type Memory = z.infer<typeof MemorySchema>;
export type MemoryType = Memory['type'];
export const MessageSchema = z
  .object({
    ...expressionFields,
    id: z.string(),
    characterId: z.string(),
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    createdAt: z.number(),
    origin: z.enum(['chat', 'proactive']),
    status: z.enum(['pending', 'complete', 'error']),
    groupId: z.string().optional(),
    replyDisposition: z.enum(['reply', 'silence']).optional(),
    attachments: z.array(z.string()).max(3).optional(),
  })
  .strict();
export type Message = z.infer<typeof MessageSchema>;
export const IntentionSchema = z
  .object({
    id: z.string(),
    characterId: z.string(),
    type: z.enum(['follow_up', 'share', 'requested', 'continuation', 'reconnect']),
    sourceMessageId: z.string().optional(),
    agentWakeup: z.boolean().optional(),
    topic: z.string(),
    earliestAt: z.number(),
    requestedDueAt: z.number().optional(),
    attempts: z.number().int().min(0).optional(),
    latestAt: z.number(),
    importance: z.number().min(0).max(1),
    reason: z.string(),
    status: z.enum(['pending', 'completed', 'expired', 'cancelled']),
    openLoopId: z.string().optional(),
    experienceId: z.string().optional(),
    createdAt: z.number(),
  })
  .strict();
export type Intention = z.infer<typeof IntentionSchema>;
export const AppraisalSchema = z
  .object({
    selfInterest: z.number().min(0).max(1),
    userRelevance: z.number().min(0).max(1),
    novelty: z.number().min(0).max(1),
    emotionalValue: z.number().min(0).max(1),
    memoryAssociation: z.string().optional(),
    shareImpulse: z.number().min(0).max(1),
  })
  .strict();
export type ExperienceAppraisal = z.infer<typeof AppraisalSchema>;
export const ExperienceSchema = z
  .object({
    id: z.string(),
    characterId: z.string(),
    source: z.string(),
    externalId: z.string(),
    title: z.string(),
    content: z.string(),
    url: z.string().optional(),
    topics: z.array(z.string()),
    createdAt: z.number(),
    appraisal: AppraisalSchema.optional(),
  })
  .strict();
export type Experience = z.infer<typeof ExperienceSchema>;
export const SettingsSchema = z
  .object({
    id: z.string(),
    characterId: z.string(),
    quietStart: z.number().int().min(0).max(23),
    quietEnd: z.number().int().min(0).max(23),
    dailyLimit: z.number().int().min(0).max(10),
    minIntervalMinutes: z.number().min(30),
    recentActiveMinutes: z.number().min(5),
    proactiveEnabled: z.boolean(),
    rssUrls: z.array(z.string().url()).max(5),
    developerMode: z.boolean(),
    lastActiveAt: z.number(),
    lastRssAt: z.number().optional(),
    lastExplorationAt: z.number().optional(),
    voice: z
      .object({
        enabled: z.boolean(),
        voiceId: z.string().max(200).optional(),
        rate: z.number().min(0.65).max(1.3),
        pitch: z.number().min(0.7).max(1.4),
        description: z.string().max(1000).optional(),
      })
      .strict()
      .optional(),
    explorationEnabled: z.boolean().optional(),
  })
  .strict();
export type Settings = z.infer<typeof SettingsSchema>;
export const ProviderConfigSchema = z
  .object({
    id: z.literal('provider'),
    provider: z.literal('openai-compatible'),
    baseUrl: z.string().trim().url(),
    model: z.string().trim().min(1).max(150),
    thinking: z.boolean().default(false),
  })
  .strict();
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export const NotificationSchema = z
  .object({
    id: z.string(),
    characterId: z.string(),
    messageId: z.string(),
    messageIds: z.array(z.string()).min(1).max(6).optional(),
    deliveryKind: z.enum(['initiative', 'requested', 'continuation', 'reconnect']).optional(),
    title: z.string(),
    body: z.string(),
    createdAt: z.number(),
    openedAt: z.number().optional(),
    deliveredAt: z.number().optional(),
    status: z.enum(['pending', 'delivered', 'error']),
  })
  .strict();
export type NotificationRecord = z.infer<typeof NotificationSchema>;
export interface Diagnostic {
  id: string;
  characterId: string;
  kind: 'heartbeat' | 'api' | 'retrieval' | 'prompt' | 'error';
  createdAt: number;
  data: Record<string, unknown>;
}
export interface ExtractionJob {
  id: string;
  characterId: string;
  userMessageId: string;
  assistantMessageIds: string[];
  status: 'pending' | 'done' | 'failed';
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
}
export interface Entities {
  mediaAssets: MediaAsset;
  mediaDrawRequests: MediaDrawRequest;
  mediaSettings: MediaSettings;
  imageAnalyses: ImageAnalysis;
  plugins: InstalledPlugin;
  pluginPolicies: PluginPolicy;
  agentSessions: AgentSession;
  agentEvidence: AgentEvidence;
  imageSettings: ImageSettings;
  imageRequests: ImageRequestCache;
  visualDrafts: VisualDraft;
  themes: ThemeRecord;
  themeOpenings: ThemeOpening;
  characters: Character;
  interviews: InterviewDraft;
  hatchings: HatchingDraft;
  memories: Memory;
  messages: Message;
  intentions: Intention;
  experiences: Experience;
  settings: Settings;
  provider: ProviderConfig;
  notifications: NotificationRecord;
  diagnostics: Diagnostic;
  extractions: ExtractionJob;
}
export type EntityKind = keyof Entities;
export const id = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
export const defaultSettings = (characterId: string): Settings => ({
  id: characterId,
  characterId,
  quietStart: 23,
  quietEnd: 8,
  dailyLimit: 2,
  minIntervalMinutes: 180,
  recentActiveMinutes: 30,
  proactiveEnabled: false,
  rssUrls: [],
  developerMode: false,
  lastActiveAt: Date.now(),
});
