import { z } from 'zod';
export const PermissionSchema = z.enum([
  'context',
  'web',
  'memory',
  'experience',
  'schedule',
  'images',
]);
export type PluginPermission = z.infer<typeof PermissionSchema>;
export const operationPermissions: Record<string, PluginPermission> = {
  read_context: 'context',
  web_search: 'web',
  web_fetch: 'web',
  browse_bilibili: 'web',
  recall_memory: 'memory',
  remember_experience: 'experience',
  schedule_wakeup: 'schedule',
  inspect_image: 'images',
  draw_image: 'images',
};
const safeName = z.string().regex(/^[a-z][a-z0-9_-]{1,23}$/);
export type PluginValue =
  | string
  | number
  | boolean
  | null
  | PluginValue[]
  | { [key: string]: PluginValue };
const scalar = z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.null()]);
const makeValue = (depth: number): z.ZodType<PluginValue> =>
  depth
    ? z.union([
        scalar,
        z.array(makeValue(depth - 1)).max(16),
        z
          .record(
            z
              .string()
              .max(60)
              .refine((k) => !['__proto__', 'constructor', 'prototype'].includes(k)),
            makeValue(depth - 1),
          )
          .refine((v) => Object.keys(v).length <= 16),
      ])
    : scalar;
export const PluginValueSchema = makeValue(4);
const Value = PluginValueSchema;
export const PluginManifestSchema = z
  .object({
    format: z.literal('nyvemi-plugin/v1'),
    id: safeName,
    name: z.string().trim().min(1).max(60),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    description: z.string().max(300),
    instructions: z.string().max(12000).default(''),
    permissions: z.array(PermissionSchema).max(6),
    tools: z
      .array(
        z
          .object({
            name: safeName,
            description: z.string().min(1).max(500),
            inputs: z
              .record(safeName, z.enum(['string', 'number', 'boolean']))
              .refine((v) => Object.keys(v).length <= 8),
            steps: z
              .array(
                z
                  .object({
                    operation: z.string().refine((v) => v in operationPermissions, '不支持的工具'),
                    args: z.record(z.string(), Value),
                  })
                  .strict(),
              )
              .min(1)
              .max(4),
          })
          .strict(),
      )
      .max(6),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (!m.instructions.trim() && !m.tools.length)
      ctx.addIssue({ code: 'custom', message: '技能说明和工具流程不能都为空' });
    if (new Set(m.tools.map((t) => t.name)).size !== m.tools.length)
      ctx.addIssue({ code: 'custom', message: '工具名称重复' });
    for (const tool of m.tools)
      for (const step of tool.steps)
        if (!m.permissions.includes(operationPermissions[step.operation]))
          ctx.addIssue({
            code: 'custom',
            message: `缺少权限 ${operationPermissions[step.operation]}`,
          });
    for (const tool of m.tools)
      for (const key of Object.keys(tool.inputs))
        if (['constructor', 'prototype', '__proto__'].includes(key))
          ctx.addIssue({ code: 'custom', message: '不支持的参数名' });
  });
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export interface InstalledPlugin {
  id: string;
  characterId: string;
  createdAt: number;
  updatedAt: number;
  manifest: PluginManifest;
  enabled: boolean;
  source: string;
  granted: PluginPermission[];
  history: { manifest: PluginManifest; source: string; at: number }[];
  lastError?: string;
  lastUsedAt?: number;
}
export interface PluginPolicy {
  id: string;
  characterId: string;
  autonomy: boolean;
  allowed: PluginPermission[];
}
export const defaultPluginPolicy = (cid: string): PluginPolicy => ({
  id: cid,
  characterId: cid,
  autonomy: true,
  allowed: ['context', 'web', 'memory', 'experience', 'schedule'],
});
