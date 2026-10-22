import type { Entities, EntityKind } from '../domain/models';

export interface Database {
  exec(sql: string): Promise<void>;
  run(sql: string, ...params: (string | number | null)[]): Promise<void>;
  all<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
  transaction<T>(work: (db: Database) => Promise<T>): Promise<T>;
}
export const migrations = [
  `CREATE TABLE IF NOT EXISTS entities (kind TEXT NOT NULL, id TEXT NOT NULL, character_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,id));
   CREATE INDEX IF NOT EXISTS entities_character ON entities(kind,character_id,created_at);
   CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY, until_at INTEGER NOT NULL);`,
];
export async function migrate(db: Database): Promise<void> {
  await db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  await db.transaction(async (tx) => {
    const rows = await tx.all<{ user_version: number }>('PRAGMA user_version');
    const version = rows[0]?.user_version ?? 0;
    if (version > migrations.length) throw new Error('数据库版本高于当前 App，请升级 App');
    for (let n = version; n < migrations.length; n++) {
      await tx.exec(migrations[n]);
      await tx.exec(`PRAGMA user_version = ${n + 1}`);
    }
  });
}
export interface Storage {
  get<K extends EntityKind>(kind: K, id: string): Promise<Entities[K] | undefined>;
  list<K extends EntityKind>(kind: K, characterId?: string, limit?: number): Promise<Entities[K][]>;
  put<K extends EntityKind>(kind: K, value: Entities[K]): Promise<void>;
  remove(kind: EntityKind, id: string): Promise<void>;
  atomic<T>(work: (store: Storage) => Promise<T>): Promise<T>;
  lease(name: string, now: number, durationMs: number): Promise<boolean>;
  release(name: string): Promise<void>;
}
export class SQLiteStore implements Storage {
  constructor(private db: Database) {}
  async get<K extends EntityKind>(kind: K, id: string): Promise<Entities[K] | undefined> {
    const rows = await this.db.all<{ payload: string }>(
      'SELECT payload FROM entities WHERE kind=? AND id=?',
      kind,
      id,
    );
    return rows[0] ? (JSON.parse(rows[0].payload) as Entities[K]) : undefined;
  }
  async list<K extends EntityKind>(
    kind: K,
    characterId?: string,
    limit = 500,
  ): Promise<Entities[K][]> {
    const rows = await this.db.all<{ payload: string }>(
      `SELECT payload FROM entities WHERE kind=? ${characterId === undefined ? '' : 'AND character_id=?'} ORDER BY created_at DESC, id DESC LIMIT ?`,
      kind,
      ...(characterId === undefined ? [] : [characterId]),
      limit,
    );
    return rows.map((row) => JSON.parse(row.payload) as Entities[K]);
  }
  async put<K extends EntityKind>(kind: K, value: Entities[K]): Promise<void> {
    const characterId =
      'characterId' in value ? value.characterId : kind === 'characters' ? value.id : '';
    await this.db.run(
      'INSERT INTO entities(kind,id,character_id,created_at,payload) VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET character_id=excluded.character_id, created_at=excluded.created_at, payload=excluded.payload',
      kind,
      value.id,
      characterId,
      'createdAt' in value ? value.createdAt : 0,
      JSON.stringify(value),
    );
  }
  async remove(kind: EntityKind, id: string): Promise<void> {
    await this.db.run('DELETE FROM entities WHERE kind=? AND id=?', kind, id);
  }
  atomic<T>(work: (store: Storage) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new SQLiteStore(tx)));
  }
  async lease(name: string, now: number, durationMs: number): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.all<{ until_at: number }>(
        'SELECT until_at FROM leases WHERE name=?',
        name,
      );
      if ((rows[0]?.until_at ?? 0) > now) return false;
      await tx.run(
        'INSERT OR REPLACE INTO leases(name,until_at) VALUES(?,?)',
        name,
        now + durationMs,
      );
      return true;
    });
  }
  async release(name: string): Promise<void> {
    await this.db.run('DELETE FROM leases WHERE name=?', name);
  }
}
