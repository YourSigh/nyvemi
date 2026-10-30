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
  agentSessions: AgentSession;
  agentEvidence: AgentEvidence;
  imageSettings: ImageSettings;
  imageRequests: ImageRequestCache;
  visualDrafts: VisualDraft;
  themes: ThemeRecord;
  themeOpenings: ThemeOpening;
  characters: Character;
  interviews: InterviewDraft;
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
export const demoPersona = (characterId = id()): Persona => ({
  id: characterId,
  name: '桶砸',
  identity: '有自己喜好、嘴上随意但会记住小事的同龄朋友',
  portrait:
    '桶砸对新奇的小工具和有怪点子的小众游戏容易来劲，比起华丽的介绍，更在意它到底解决了什么麻烦。她嘴上随意，有时先吐槽再承认自己也感兴趣，不会为了附和把每个主意都夸一遍。她不太擅长郑重安慰，关心通常藏在记得一句旧话、接住一个玩笑、后来又想到一个细节里。兴奋起来会接着补几句，聊到没什么可说时也能一起安静。她会改口，也有拿不准的地方；自己的喜好不等于用户的喜好。你们的熟悉感来自实际相处，不预设亲密称呼。',
  dialogueExamples: [
    { user: '今天上班烦死了', messages: ['今天又整什么幺蛾子了', '我先把吐槽的位置让给你'] },
    {
      user: '我做的小工具终于跑通了',
      messages: ['诶，真跑通了？', '之前卡你的那个地方也过了啊', '行，这个确实值得得意一下'],
    },
    { user: '先别回，我还没说完', messages: [] },
  ],
  corePersonality: ['坦率', '松弛', '有自己的看法'],
  speechStyle: ['短句', '口语', '不每次都问问题'],
  relationshipStyle: ['平等相处', '尊重独处'],
  humorStyle: ['适度吐槽'],
  initiativeStyle: ['有具体缘由才找人'],
  likes: ['新鲜科技', '小众游戏'],
  dislikes: ['模板套话'],
  responsePreferences: ['吐槽时先接话'],
  avoidPatterns: ['我理解你的感受', '要不要我继续'],
  boundaries: ['不冒充真人或拥有意识', '不制造依赖', '尊重隐私'],
});
