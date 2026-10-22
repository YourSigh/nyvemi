import { id, type Diagnostic } from '../domain/models';
import type { Storage } from './store';
export class Diagnostics {
  constructor(
    private store: Storage,
    private redact?: (json: string) => Promise<string>,
  ) {}
  async record(
    kind: Diagnostic['kind'],
    characterId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    // Callers pass structured allowlisted fields. Never pass request headers, provider bodies or raw exceptions.
    if (this.redact) {
      try {
        data = JSON.parse(await this.redact(JSON.stringify(data))) as Record<string, unknown>;
      } catch {
        data = { message: 'diagnostic_redaction_unavailable' };
      }
    }
    await this.store.put('diagnostics', {
      id: id(),
      characterId,
      kind,
      createdAt: Date.now(),
      data,
    });
    const rows = await this.store.list('diagnostics', undefined, 10000);
    for (const row of rows.slice(200)) await this.store.remove('diagnostics', row.id);
  }
  async error(characterId: string, operation: string): Promise<void> {
    await this.record('error', characterId, {
      operation,
      message: '操作失败；请检查网络、Provider 配置或重试。',
    });
  }
}
