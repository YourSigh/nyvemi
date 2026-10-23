import { expect, it } from 'vitest';
import { serializeDatabase } from '../src/storage/serialized';
import type { Database } from '../src/storage/store';

it('keeps polling and headless queries outside an exclusive transaction, and recovers after errors', async () => {
  const operations: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const raw: Database = {
    exec: async (sql) => {
      operations.push(sql);
    },
    run: async (sql) => {
      operations.push(sql);
      if (sql === 'fail') throw new Error('disk');
    },
    all: async () => [],
    transaction: async (work) => {
      operations.push('begin');
      await gate;
      const result = await work(raw);
      operations.push('commit');
      return result;
    },
  };
  const db = serializeDatabase(raw);
  const transaction = db.transaction(async (tx) => {
    await tx.exec('inside');
    return 'saved';
  });
  const polling = db.exec('poll');
  await Promise.resolve();
  expect(operations).toEqual(['begin']);
  release();
  expect(await transaction).toBe('saved');
  await polling;
  expect(operations).toEqual(['begin', 'inside', 'commit', 'poll']);
  await expect(db.run('fail')).rejects.toThrow('disk');
  await db.exec('after-error');
  expect(operations.at(-1)).toBe('after-error');
});
