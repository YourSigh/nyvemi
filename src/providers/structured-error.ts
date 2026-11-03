import type { ZodIssue } from 'zod';
const stages: Record<string, string> = {
  visual_identity_planning: '角色要求理解',
  visual_reference_review: '参考图核对',
  visual_reference_selection: '参考筛选',
  visual_candidate_review: '候选图核对',
  visual_prompt_composition: '绘图描述整理',
};
const fields = new Set([
  'brief',
  'queries',
  'subject',
  'namedCharacter',
  'recognizableFeatures',
  'style',
  'confidence',
  'status',
  'features',
  'issues',
  'checks',
  'indices',
  'prompt',
]);
/** Keeps schema locations and error kinds only, never returned values, prose or image bytes. */
export class StructuredOutputError extends Error {
  readonly details: {
    purpose: string;
    stage: string;
    reason: 'json' | 'schema' | 'empty' | 'truncated';
    issues: { path: (string | number)[]; code: string }[];
  };
  constructor(
    purpose: string,
    reason: 'json' | 'schema' | 'empty' | 'truncated',
    issues: ZodIssue[] = [],
  ) {
    const stage = stages[purpose] ?? '模型';
    const hint =
      reason === 'truncated' ? '回复不完整' : reason === 'empty' ? '返回为空' : '返回格式有误';
    super(`${stage}${hint}，请重试${stages[purpose] ? '；本步未调用生图接口' : ''}`);
    this.name = 'StructuredOutputError';
    this.details = {
      purpose: /^[a-z][a-z0-9_]{0,63}$/.test(purpose) ? purpose : 'structured_output',
      stage,
      reason,
      issues: issues
        .slice(0, 8)
        .map((issue) => ({
          code: issue.code,
          path: issue.path
            .slice(0, 6)
            .map((part) => (typeof part === 'number' ? part : fields.has(part) ? part : '$field')),
        })),
    };
  }
}
