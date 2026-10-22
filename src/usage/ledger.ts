import { z } from 'zod';
import type { ApiMetric, Usage } from '../providers/provider';
import type { Database } from '../storage/store';
export const PriceSchema = z
  .object({
    currency: z.enum(['CNY', 'USD']),
    inputPerMillion: z.number().finite().min(0).max(1e6),
    cachedInputPerMillion: z.number().finite().min(0).max(1e6),
    outputPerMillion: z.number().finite().min(0).max(1e6),
    label: z.string().max(200),
  })
  .strict();
export type TokenPrice = z.infer<typeof PriceSchema>;
export interface UsageRecord extends ApiMetric {
  price?: TokenPrice;
  estimatedCost?: number;
  currency?: TokenPrice['currency'];
}
export interface UsageSummary {
  endpoint: string;
  model: string;
  currency: string;
  requests: number;
  failures: number;
  unknownUsage: number;
  unpriced: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  estimatedCost: number;
}
export function normalizeUsage(raw: unknown): Usage {
  if (!raw || typeof raw !== 'object') return {};
  const u = raw as Record<string, unknown>;
  const count = (v: unknown) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
  const inputTokens = count(u.prompt_tokens);
  const outputTokens = count(u.completion_tokens);
  const details = u.prompt_tokens_details as Record<string, unknown> | undefined;
  let cachedInputTokens = count(u.prompt_cache_hit_tokens) ?? count(details?.cached_tokens);
  const miss = count(u.prompt_cache_miss_tokens);
  if (
    cachedInputTokens === undefined &&
    inputTokens !== undefined &&
    miss !== undefined &&
    miss <= inputTokens
  )
    cachedInputTokens = inputTokens - miss;
  if (
    inputTokens !== undefined &&
    cachedInputTokens !== undefined &&
    cachedInputTokens > inputTokens
  )
    cachedInputTokens = undefined;
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
  };
}
export function estimateCost(usage: Usage, price?: TokenPrice): number | undefined {
  if (!price || usage.inputTokens === undefined || usage.outputTokens === undefined)
    return undefined;
  // A missing cache split cannot be priced accurately if cached input has a different rate.
  if (
    usage.cachedInputTokens === undefined &&
    price.cachedInputPerMillion !== price.inputPerMillion
  )
    return undefined;
  const cached = usage.cachedInputTokens ?? 0;
  if (cached < 0 || cached > usage.inputTokens) return undefined;
  return (
    ((usage.inputTokens - cached) * price.inputPerMillion +
      cached * price.cachedInputPerMillion +
      usage.outputTokens * price.outputPerMillion) /
    1e6
  );
}
export class UsageLedger {
  constructor(private db: Database) {}
  async price(endpoint: string, model: string): Promise<TokenPrice | undefined> {
    const rows = await this.db.all<{ payload: string }>(
      'SELECT payload FROM token_prices WHERE endpoint=? AND model=?',
      endpoint,
      model,
    );
    return rows[0] ? PriceSchema.parse(JSON.parse(rows[0].payload)) : undefined;
  }
  async setPrice(endpoint: string, model: string, value: unknown): Promise<void> {
    const price = PriceSchema.parse(value);
    await this.db.run(
      'INSERT INTO token_prices(endpoint,model,payload) VALUES(?,?,?) ON CONFLICT(endpoint,model) DO UPDATE SET payload=excluded.payload',
      endpoint,
      model,
      JSON.stringify(price),
    );
  }
  async record(metric: ApiMetric, price?: TokenPrice): Promise<void> {
    const cost = estimateCost(metric, price);
    const record: UsageRecord = {
      ...metric,
      price,
      estimatedCost: cost,
      currency: price?.currency,
    };
    await this.db.run(
      'INSERT OR IGNORE INTO api_usage(id,created_at,endpoint,model,purpose,payload) VALUES(?,?,?,?,?,?)',
      metric.requestId,
      metric.startedAt,
      metric.endpoint,
      metric.model,
      metric.purpose,
      JSON.stringify(record),
    );
  }
  async recent(limit = 40): Promise<UsageRecord[]> {
    const rows = await this.db.all<{ payload: string }>(
      'SELECT payload FROM api_usage ORDER BY created_at DESC,id DESC LIMIT ?',
      limit,
    );
    return rows.map((r) => JSON.parse(r.payload) as UsageRecord);
  }
  async summary(since = 0): Promise<UsageSummary[]> {
    return this.db.all<UsageSummary>(
      `SELECT endpoint, model, COALESCE(json_extract(payload,'$.currency'),'未计价') AS currency,
      COUNT(*) AS requests, SUM(CASE WHEN json_extract(payload,'$.success')=0 THEN 1 ELSE 0 END) AS failures,
      SUM(CASE WHEN json_extract(payload,'$.inputTokens') IS NULL OR json_extract(payload,'$.outputTokens') IS NULL THEN 1 ELSE 0 END) AS unknownUsage,
      SUM(CASE WHEN json_extract(payload,'$.estimatedCost') IS NULL THEN 1 ELSE 0 END) AS unpriced,
      COALESCE(SUM(json_extract(payload,'$.inputTokens')),0) AS inputTokens,
      COALESCE(SUM(json_extract(payload,'$.outputTokens')),0) AS outputTokens,
      COALESCE(SUM(json_extract(payload,'$.cachedInputTokens')),0) AS cachedInputTokens,
      COALESCE(SUM(json_extract(payload,'$.estimatedCost')),0) AS estimatedCost
      FROM api_usage WHERE created_at>=? GROUP BY endpoint,model,currency ORDER BY requests DESC`,
      since,
    );
  }
}
// Verified 2026-10-22. Explicit fixed-rate presets; users select their billed tariff.
export const deepSeekPrices: { label: string; model: string; price: TokenPrice }[] = [
  {
    label: 'Flash · 高峰单价',
    model: 'deepseek-flash',
    price: {
      currency: 'CNY',
      inputPerMillion: 2,
      cachedInputPerMillion: 0.04,
      outputPerMillion: 8,
      label: 'DeepSeek 官方高峰单价 · 2026-10-22',
    },
  },
  {
    label: 'Flash · 空闲单价',
    model: 'deepseek-flash',
    price: {
      currency: 'CNY',
      inputPerMillion: 1,
      cachedInputPerMillion: 0.02,
      outputPerMillion: 4,
      label: 'DeepSeek 官方空闲单价 · 2026-10-22',
    },
  },
  {
    label: 'V4 Pro · 高峰单价',
    model: 'deepseek-v4-pro',
    price: {
      currency: 'CNY',
      inputPerMillion: 9,
      cachedInputPerMillion: 0.3,
      outputPerMillion: 27,
      label: 'DeepSeek 官方高峰单价 · 2026-10-22',
    },
  },
  {
    label: 'V4 Pro · 空闲单价',
    model: 'deepseek-v4-pro',
    price: {
      currency: 'CNY',
      inputPerMillion: 4.5,
      cachedInputPerMillion: 0.15,
      outputPerMillion: 13.5,
      label: 'DeepSeek 官方空闲单价 · 2026-10-22',
    },
  },
];
