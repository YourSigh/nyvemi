import type { Database } from './store';

// Expo exclusive transactions use another SQLite connection. Serialize operations on our
// shared adapter so reads/writes outside a transaction cannot race it and get SQLITE_BUSY.
// The transaction callback receives the raw transaction adapter, never this outer queue.
export function serializeDatabase(database: Database): Database {
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work);
    tail = result.catch(() => undefined);
    return result;
  }
  return {
    exec: (sql) => enqueue(() => database.exec(sql)),
    run: (sql, ...params) => enqueue(() => database.run(sql, ...params)),
    all: <T>(sql: string, ...params: (string | number | null)[]) =>
      enqueue(() => database.all<T>(sql, ...params)),
    transaction: (work) => enqueue(() => database.transaction(work)),
  };
}
