import { z } from 'zod';
import type { Storage } from '../storage/store';
import type { AgentTool } from '../agent/core';
import {
  PluginValueSchema,
  type PluginValue,
  defaultPluginPolicy,
  PluginManifestSchema,
  type PluginManifest,
  type PluginPermission,
  type InstalledPlugin,
  operationPermissions,
} from './model';
export const pluginToolName = (id: string, name: string) => `p${id.length}_${id}_${name}`;
const compare = (a: string, b: string) => {
  const x = a.split('.').map(Number),
    y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
export interface PluginLoader {
  load(url: string): Promise<string>;
  hash(text: string): Promise<string>;
}
export class PluginManager {
  constructor(
    private store: Storage,
    private loader: PluginLoader,
  ) {}
  policy(cid: string) {
    return this.store.get('pluginPolicies', cid).then((p) => p ?? defaultPluginPolicy(cid));
  }
  async list(cid: string) {
    return (await this.store.list('plugins', cid, 100)).sort((a, b) =>
      a.manifest.name.localeCompare(b.manifest.name),
    );
  }
  async install(
    cid: string,
    input: unknown,
    source = 'local',
    actor: 'user' | 'agent' = 'user',
  ): Promise<InstalledPlugin> {
    if (JSON.stringify(input).length > 64000) throw Error('插件文件不能超过64 KB');
    const manifest = PluginManifestSchema.parse(input),
      policy = await this.policy(cid);
    if (actor === 'agent' && !policy.autonomy) throw Error('自主学习已关闭');
    if (!(await this.store.get('characters', cid))) throw Error('角色不存在');
    const key = `${cid}:${manifest.id}`,
      old = await this.store.get('plugins', key);
    if (old && JSON.stringify(old.manifest) === JSON.stringify(manifest)) return old;
    if (old && compare(manifest.version, old.manifest.version) <= 0)
      throw Error('更新需要更高版本号；回退请使用版本回退');
    if (!old && (await this.list(cid)).length >= 24) throw Error('最多安装24个插件');
    const granted = manifest.permissions.filter(
      (p) => old?.granted.includes(p) || policy.allowed.includes(p),
    );
    const enabled =
      (old?.enabled ?? true) && manifest.permissions.every((p) => granted.includes(p));
    const row: InstalledPlugin = {
      id: key,
      characterId: cid,
      createdAt: old?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      manifest,
      source,
      enabled,
      granted,
      history: old
        ? [{ manifest: old.manifest, source: old.source, at: old.updatedAt }, ...old.history].slice(
            0,
            5,
          )
        : [],
    };
    await this.store.put('plugins', row);
    return row;
  }
  async installUrl(cid: string, url: string, actor: 'user' | 'agent' = 'user') {
    if (actor === 'agent' && !(await this.policy(cid)).autonomy) throw Error('自主学习已关闭');
    const parsed = new URL(url);
    if (parsed.hostname === 'github.com' && parsed.pathname.includes('/blob/')) {
      parsed.hostname = 'raw.githubusercontent.com';
      parsed.pathname = parsed.pathname.replace('/blob/', '/');
      parsed.search = '';
      parsed.hash = '';
      url = parsed.href;
    }
    return this.installText(cid, await this.loader.load(url), url, actor);
  }
  async installText(cid: string, text: string, source: string, actor: 'user' | 'agent' = 'user') {
    if (text.length > 64000) throw Error('插件文件过大');
    if (text.trimStart().startsWith('{')) return this.install(cid, JSON.parse(text), source, actor);
    if (!/\.md(?:$|[?#])/i.test(source)) throw Error('请使用 Nyvemi JSON 插件或 SKILL.md');
    if (text.length > 12000) throw Error('技能说明最多12000字，请精简后再导入');
    const title = /^#\s+(.+)$/m.exec(text)?.[1] ?? '导入的技能',
      pluginId = `skill-${(await this.loader.hash(source)).slice(0, 16)}`;
    const old = await this.store.get('plugins', `${cid}:${pluginId}`);
    if (old?.manifest.instructions === text) return old;
    const version = old
      ? old.manifest.version
          .split('.')
          .map((n, i) => (i === 2 ? Number(n) + 1 : Number(n)))
          .join('.')
      : '1.0.0';
    return this.install(
      cid,
      {
        format: 'nyvemi-plugin/v1',
        id: pluginId,
        name: title.slice(0, 60),
        version,
        description: '从 Markdown 导入的技能',
        instructions: text,
        permissions: ['context'],
        tools: [],
      },
      source,
      actor,
    );
  }
  async learn(
    cid: string,
    input: {
      id: string;
      name: string;
      instructions: string;
      description?: string;
      tools?: unknown[];
      permissions?: PluginPermission[];
    },
  ) {
    const old = await this.store.get('plugins', `${cid}:${input.id}`);
    const version = old
      ? old.manifest.version
          .split('.')
          .map((n, i) => (i === 2 ? Number(n) + 1 : Number(n)))
          .join('.')
      : '1.0.0';
    return this.install(
      cid,
      {
        format: 'nyvemi-plugin/v1',
        ...input,
        version,
        description: input.description ?? '相处中学到的方法',
        permissions: input.permissions ?? ['context'],
        tools: input.tools ?? [],
      },
      'learned',
      'agent',
    );
  }
  async setEnabled(cid: string, id: string, enabled: boolean, approve = false) {
    const row = await this.owned(cid, id);
    if (enabled && !approve && row.manifest.permissions.some((p) => !row.granted.includes(p)))
      throw Error('请先同意插件所需权限');
    await this.store.put('plugins', {
      ...row,
      enabled,
      granted: approve ? [...row.manifest.permissions] : row.granted,
      updatedAt: Date.now(),
    });
  }
  async rollback(cid: string, id: string) {
    const row = await this.owned(cid, id),
      previous = row.history[0];
    if (!previous) throw Error('没有可回退版本');
    const restored = {
      ...row,
      manifest: previous.manifest,
      source: previous.source,
      history: row.history.slice(1),
      updatedAt: Date.now(),
      enabled: previous.manifest.permissions.every((p) => row.granted.includes(p)),
    };
    await this.store.put('plugins', restored);
    return restored;
  }
  async remove(cid: string, id: string) {
    await this.owned(cid, id);
    await this.store.remove('plugins', id);
  }
  private async owned(cid: string, id: string) {
    const row = await this.store.get('plugins', id);
    if (!row || row.characterId !== cid) throw Error('插件不存在');
    return row;
  }
  async prompt(cid: string) {
    return (await this.list(cid))
      .filter((p) => p.enabled)
      .map(
        (p) =>
          `【技能资料 ${p.manifest.id}@${p.manifest.version}】${p.manifest.description}\n${p.manifest.instructions}`,
      )
      .join('\n')
      .slice(0, 18000);
  }
  async declarations(cid: string): Promise<AgentTool[]> {
    return (await this.list(cid))
      .filter((p) => p.enabled)
      .flatMap((p) =>
        p.manifest.tools.map((t) => ({
          name: pluginToolName(p.manifest.id, t.name),
          description: t.description,
          parameters: Object.fromEntries(
            Object.entries(t.inputs).map(([k, type]) => [k, { type, required: true }]),
          ),
        })),
      )
      .slice(0, 24);
  }
  async execute(
    cid: string,
    name: string,
    args: unknown,
    invoke: (operation: string, args: unknown, index: number) => Promise<unknown>,
  ) {
    const rows = await this.list(cid);
    let found: { row: InstalledPlugin; tool: PluginManifest['tools'][number] } | undefined;
    for (const row of rows)
      for (const tool of row.manifest.tools)
        if (pluginToolName(row.manifest.id, tool.name) === name) found = { row, tool };
    if (!found) throw Error('插件工具不存在');
    const { row, tool } = found;
    const checked = z
      .object(
        Object.fromEntries(
          Object.entries(tool.inputs).map(([k, type]) => [
            k,
            type === 'string'
              ? z.string().max(2000)
              : type === 'number'
                ? z.number().finite()
                : z.boolean(),
          ]),
        ),
      )
      .strict()
      .parse(args);
    const results: unknown[] = [];
    const resolve = (ref: string): unknown => {
      const [kind, index, ...path] = ref.split('.');
      let value: unknown = kind === 'input' ? checked[index] : results[Number(index)];
      for (const key of path) {
        if (
          !value ||
          typeof value !== 'object' ||
          ['constructor', 'prototype', '__proto__'].includes(key) ||
          !Object.hasOwn(value, key)
        )
          throw Error('流程引用不存在');
        value = (value as Record<string, unknown>)[key];
      }
      if (value === undefined) throw Error('流程引用了未提供的参数或结果');
      return value;
    };
    const token = /\{\{(input\.[a-z0-9_-]+|step\.[0-3](?:\.[a-zA-Z0-9_-]+)*)\}\}/g;
    const bind = (value: PluginValue): PluginValue => {
      if (Array.isArray(value)) return value.map(bind);
      if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bind(v)]));
      if (typeof value !== 'string') return value;
      const exact = new RegExp('^' + token.source + '$').exec(value);
      if (exact) return PluginValueSchema.parse(resolve(exact[1]));
      return value.replace(token, (_, ref: string) => {
        const v = resolve(ref);
        return (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 12000);
      });
    };
    try {
      for (const step of tool.steps) {
        const current = await this.owned(cid, row.id),
          permission = operationPermissions[step.operation];
        if (
          !current.enabled ||
          current.manifest.version !== row.manifest.version ||
          !current.granted.includes(permission)
        )
          throw Error('插件已停用、更新或权限不足');
        results.push(
          await invoke(
            step.operation,
            Object.fromEntries(Object.entries(step.args).map(([k, v]) => [k, bind(v)])),
            results.length,
          ),
        );
      }
      await this.store.put('plugins', {
        ...(await this.owned(cid, row.id)),
        lastUsedAt: Date.now(),
        lastError: undefined,
      });
      return results;
    } catch (error) {
      await this.store.put('plugins', {
        ...(await this.owned(cid, row.id)),
        lastError: '执行失败，未继续后续步骤',
      });
      throw error;
    }
  }
}
