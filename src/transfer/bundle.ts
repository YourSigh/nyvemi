import { validateRig, type CharacterRig } from '../appearance/model';
import { z } from 'zod';
import { ThemeRecordSchema } from '../theme/model';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import {
  CharacterSchema,
  MemorySchema,
  MessageSchema,
  IntentionSchema,
  ExperienceSchema,
  SettingsSchema,
  NotificationSchema,
  id,
  type Character,
} from '../domain/models';
import type { Storage } from '../storage/store';
import { redactKnownSecret } from '../domain/privacy';
const JobSchema = z
  .object({
    id: z.string(),
    characterId: z.string(),
    userMessageId: z.string(),
    assistantMessageIds: z.array(z.string()),
    status: z.enum(['pending', 'done', 'failed']),
    attempts: z.number().int().nonnegative(),
    nextAttemptAt: z.number(),
    createdAt: z.number(),
  })
  .strict();
const ManifestSchema = z
  .object({
    format: z.literal('nyvemi'),
    version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    theme: ThemeRecordSchema.optional(),
    exportedAt: z.number(),
    character: CharacterSchema.omit({ avatar: true }).extend({
      avatar: z.literal('avatar.bin').optional(),
    }),
    memories: z.array(MemorySchema).max(100000),
    messages: z.array(MessageSchema).max(100000),
    intentions: z.array(IntentionSchema).max(100000),
    experiences: z.array(ExperienceSchema).max(100000),
    notifications: z.array(NotificationSchema).max(100000),
    extractions: z.array(JobSchema).max(100000),
    settings: SettingsSchema,
  })
  .strict();
export type BundleManifest = z.infer<typeof ManifestSchema>;
export interface BundleAssets {
  readAvatar(uri: string): Promise<Uint8Array>;
  writeAvatar(characterId: string, bytes: Uint8Array): Promise<string>;
  removeAvatar(uri: string): Promise<void>;
}
const MAX_ZIP = 100 * 1024 * 1024,
  MAX_JSON = 12 * 1024 * 1024,
  MAX_AVATAR = 5 * 1024 * 1024,
  MAX_IMAGE = 12 * 1024 * 1024;
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value))
      if (!/^(api.?key|authorization|password|secret|access.?token|refresh.?token)$/i.test(key))
        result[key] = clean(v);
    return result;
  }
  return value;
}
export function isAvatar(bytes: Uint8Array): boolean {
  return (
    (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) ||
    (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (strFromU8(bytes.slice(0, 4)) === 'RIFF' && strFromU8(bytes.slice(8, 12)) === 'WEBP')
  );
}
export function readBundle(bytes: Uint8Array): {
  manifest: BundleManifest;
  avatar?: Uint8Array;
  images: Record<string, Uint8Array>;
} {
  if (bytes.byteLength > MAX_ZIP) throw new Error('Bundle 不能超过 100 MB');
  let total = 0;
  const names = new Set<string>();
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (
        (!['manifest.json', 'avatar.bin'].includes(file.name) &&
          !/^rig\/\d{1,2}\.bin$/.test(file.name)) ||
        names.has(file.name) ||
        names.size >= 34
      )
        throw new Error('Bundle 包含不支持或重复的文件');
      names.add(file.name);
      total += file.originalSize;
      if (
        file.originalSize >
          (file.name === 'manifest.json'
            ? MAX_JSON
            : file.name === 'avatar.bin'
              ? MAX_AVATAR
              : MAX_IMAGE) ||
        total > MAX_ZIP
      )
        throw new Error('Bundle 解压尺寸过大');
      return true;
    },
  });
  if (!files['manifest.json']) throw new Error('Bundle 缺少 manifest.json');
  const manifest = ManifestSchema.parse(JSON.parse(strFromU8(files['manifest.json'])));
  const avatar = files['avatar.bin'];
  if (Boolean(avatar) !== Boolean(manifest.character.avatar))
    throw new Error('头像资产与清单不一致');
  if (avatar && !isAvatar(avatar)) throw new Error('不支持的头像格式');
  const cid = manifest.character.id;
  if (manifest.character.persona.id !== cid || manifest.settings.characterId !== cid)
    throw new Error('角色引用不一致');
  const all = [
    ...manifest.memories,
    ...manifest.messages,
    ...manifest.intentions,
    ...manifest.experiences,
    ...manifest.notifications,
    ...manifest.extractions,
  ];
  if (all.some((item) => item.characterId !== cid)) throw new Error('Bundle 混入了其它角色的数据');
  const ids = new Map<string, Set<string>>();
  for (const [kind, rows] of Object.entries({
    memories: manifest.memories,
    messages: manifest.messages,
    intentions: manifest.intentions,
    experiences: manifest.experiences,
    notifications: manifest.notifications,
    extractions: manifest.extractions,
  })) {
    const set = new Set(rows.map((r) => r.id));
    if (set.size !== rows.length) throw new Error('Bundle 包含重复实体 ID');
    ids.set(kind, set);
  }
  for (const i of manifest.intentions)
    if (
      (i.openLoopId && !ids.get('memories')?.has(i.openLoopId)) ||
      (i.experienceId && !ids.get('experiences')?.has(i.experienceId))
    )
      throw new Error('意图引用的事件不存在');
  for (const n of manifest.notifications)
    if (![n.messageId, ...(n.messageIds ?? [])].every((mid) => ids.get('messages')?.has(mid)))
      throw new Error('通知引用的消息不存在');
  for (const job of manifest.extractions)
    if (
      !ids.get('messages')?.has(job.userMessageId) ||
      job.assistantMessageIds.some((mid) => !ids.get('messages')?.has(mid))
    )
      throw new Error('抽取任务引用的消息不存在');
  const images = Object.fromEntries(
    Object.entries(files).filter(([name]) => name.startsWith('rig/')),
  );
  const used = new Set<string>();
  if (manifest.character.rig) {
    if (manifest.version !== 3) throw new Error('分层形象需要 Bundle v3');
    const rig = validateRig(manifest.character.rig);
    for (const layer of rig.layers) {
      if (layer.asset.svg) {
        if (rig.source !== 'mock' || !layer.asset.uri.startsWith('mock:'))
          throw new Error('演示图层格式不正确');
      } else {
        const bytes = images[layer.asset.uri];
        if (!bytes || !isAvatar(bytes)) throw new Error('形象资产缺失或格式不支持');
        used.add(layer.asset.uri);
      }
    }
  }
  if (Object.keys(images).some((name) => !used.has(name)))
    throw new Error('Bundle 包含未引用的形象文件');
  return { manifest, avatar, images };
}
export class CharacterBundleService {
  constructor(
    private store: Storage,
    private assets: BundleAssets,
  ) {}
  async exportCharacter(characterId: string, knownSecret?: string): Promise<Uint8Array> {
    const manifest = await this.store.atomic(async (tx) => {
      const character = await tx.get('characters', characterId);
      const settings = await tx.get('settings', characterId);
      if (!character || !settings) throw new Error('角色不存在');
      const portable = {
        ...character,
        avatar: character.avatar ? ('avatar.bin' as const) : undefined,
      };
      return {
        format: 'nyvemi' as const,
        version: character.rig ? (3 as const) : (2 as const),
        theme: await tx.get('themes', 'app'),
        exportedAt: Date.now(),
        character: portable,
        settings,
        memories: await tx.list('memories', characterId, 100001),
        messages: await tx.list('messages', characterId, 100001),
        intentions: await tx.list('intentions', characterId, 100001),
        experiences: await tx.list('experiences', characterId, 100001),
        notifications: await tx.list('notifications', characterId, 100001),
        extractions: await tx.list('extractions', characterId, 100001),
      };
    });
    const rigFiles: Record<string, Uint8Array> = {};
    if (manifest.character.rig) {
      const rig = validateRig(manifest.character.rig);
      const mapped = new Map<string, string>();
      for (const layer of rig.layers) {
        if (layer.asset.svg) continue;
        const old = layer.asset.uri;
        if (!mapped.has(old)) {
          const data = await this.assets.readAvatar(old);
          if (data.length > MAX_IMAGE || !isAvatar(data))
            throw new Error('形象图层过大或格式不支持');
          const name = `rig/${mapped.size}.bin`;
          mapped.set(old, name);
          rigFiles[name] = data;
        }
        layer.asset = { ...layer.asset, uri: mapped.get(old)! };
      }
      manifest.character.rig = rig;
    }
    const json = JSON.stringify(redactKnownSecret(clean(manifest), knownSecret));
    ManifestSchema.parse(JSON.parse(json));
    const content = strToU8(json);
    if (content.length > MAX_JSON) throw new Error('角色数据超过首版 Bundle 的 12 MB 上限');
    const files: Record<string, Uint8Array> = { 'manifest.json': content, ...rigFiles };
    const character = await this.store.get('characters', characterId);
    if (character?.avatar) {
      const avatar = await this.assets.readAvatar(character.avatar);
      if (avatar.length > MAX_AVATAR || !isAvatar(avatar)) throw new Error('头像过大或格式不支持');
      files['avatar.bin'] = avatar;
    }
    const bytes = zipSync(files, { level: 6 });
    readBundle(bytes);
    return bytes;
  }
  async importCharacter(bytes: Uint8Array): Promise<Character> {
    const { manifest: m, avatar, images } = readBundle(bytes);
    const cid = id();
    const maps = new Map<string, string>();
    const remap = (kind: string, old: string): string => {
      const key = `${kind}:${old}`;
      if (!maps.has(key)) maps.set(key, id());
      return maps.get(key)!;
    };
    let avatarUri: string | undefined;
    const imageUris: string[] = [];
    let rig: CharacterRig | undefined;
    try {
      if (avatar) avatarUri = await this.assets.writeAvatar(cid, avatar);
      if (m.character.rig) {
        const mapped = new Map<string, string>();
        for (const [name, data] of Object.entries(images)) {
          const uri = await this.assets.writeAvatar(cid, data);
          imageUris.push(uri);
          mapped.set(name, uri);
        }
        rig = validateRig({
          ...m.character.rig,
          layers: m.character.rig.layers.map((layer) => ({
            ...layer,
            asset: {
              ...layer.asset,
              uri: layer.asset.svg ? layer.asset.uri : mapped.get(layer.asset.uri)!,
            },
          })),
        });
      }
      const received = new Set(
        m.notifications
          .filter((n) => n.status === 'delivered' || n.openedAt !== undefined)
          .flatMap((n) => n.messageIds ?? [n.messageId]),
      );
      const character: Character = {
        ...m.character,
        id: cid,
        persona: { ...m.character.persona, id: cid },
        avatar: avatarUri,
        rig,
        appearancePending: false,
      };
      await this.store.atomic(async (tx) => {
        await tx.put('characters', character);
        // Restore appearance on a fresh installation; an existing user's app preference wins.
        if (m.theme && !(await tx.get('themes', 'app'))) await tx.put('themes', m.theme);
        await tx.put('settings', {
          ...m.settings,
          id: cid,
          characterId: cid,
          proactiveEnabled: false,
          lastActiveAt: Date.now(),
          lastRssAt: undefined,
        });
        for (const memory of m.memories)
          await tx.put('memories', {
            ...memory,
            id: remap('memories', memory.id),
            characterId: cid,
            source:
              memory.source && m.messages.some((msg) => msg.id === memory.source)
                ? remap('messages', memory.source)
                : memory.source,
          });
        for (const message of m.messages)
          await tx.put('messages', {
            ...message,
            id: remap('messages', message.id),
            characterId: cid,
            groupId: message.groupId ? remap('messages', message.groupId) : undefined,
            status:
              message.status === 'pending'
                ? received.has(message.id)
                  ? 'complete'
                  : 'error'
                : message.status,
          });
        for (const experience of m.experiences)
          await tx.put('experiences', {
            ...experience,
            id: remap('experiences', experience.id),
            characterId: cid,
            externalId:
              experience.source === 'conversation'
                ? remap('memories', experience.externalId)
                : experience.externalId,
          });
        for (const intention of m.intentions)
          await tx.put('intentions', {
            ...intention,
            id: remap('intentions', intention.id),
            sourceMessageId: intention.sourceMessageId
              ? remap('messages', intention.sourceMessageId)
              : undefined,
            // A transfer must not silently re-arm a timed notification from another installation.
            status:
              ['requested', 'continuation', 'reconnect'].includes(intention.type) &&
              intention.status === 'pending'
                ? 'expired'
                : intention.status,
            characterId: cid,
            openLoopId: intention.openLoopId ? remap('memories', intention.openLoopId) : undefined,
            experienceId: intention.experienceId
              ? remap('experiences', intention.experienceId)
              : undefined,
          });
        for (const notification of m.notifications)
          await tx.put('notifications', {
            ...notification,
            id: remap('notifications', notification.id),
            characterId: cid,
            messageId: remap('messages', notification.messageId),
            messageIds: notification.messageIds?.map((mid) => remap('messages', mid)),
            status: notification.status === 'pending' ? 'error' : notification.status,
            openedAt: notification.openedAt ?? Date.now(),
          });
        for (const job of m.extractions)
          await tx.put('extractions', {
            ...job,
            id: remap('messages', job.userMessageId),
            characterId: cid,
            userMessageId: remap('messages', job.userMessageId),
            assistantMessageIds: job.assistantMessageIds.map((mid) => remap('messages', mid)),
            nextAttemptAt: Date.now(),
          });
      });
      return character;
    } catch (error) {
      for (const uri of [...imageUris, ...(avatarUri ? [avatarUri] : [])])
        await this.assets.removeAvatar(uri).catch(() => undefined);
      throw error;
    }
  }
}
