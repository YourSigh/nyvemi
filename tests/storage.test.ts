import { it,expect } from 'vitest';
import { TestDatabase } from './database';
import { migrate,SQLiteStore } from '../src/storage/store';
import { demoPersona } from '../src/domain/models';
it('rolls back partial writes and prevents overlapping background jobs',async()=>{
 const db=new TestDatabase();await migrate(db);const store=new SQLiteStore(db);
 await expect(store.atomic(async tx=>{await tx.put('characters',{id:'x',persona:demoPersona('x'),state:{energy:1,relationshipCloseness:0,recentFocus:[],curiosityTopics:[]},interests:[],createdAt:1});throw new Error('fail');})).rejects.toThrow('fail');
 expect(await store.get('characters','x')).toBeUndefined();
 expect(await store.lease('heartbeat',1000,3000)).toBe(true);expect(await store.lease('heartbeat',1100,3000)).toBe(false);expect(await store.lease('heartbeat',4001,3000)).toBe(true);await store.release('heartbeat');expect(await store.lease('heartbeat',4002,3000)).toBe(true);
});
it('isolates per-character settings and rejects a newer database without overwriting it',async()=>{
 const {defaultSettings}=await import('../src/domain/models');const db=new TestDatabase();await migrate(db);const store=new SQLiteStore(db);await store.put('settings',{...defaultSettings('a'),quietStart:21});await store.put('settings',{...defaultSettings('b'),quietStart:23});expect((await store.get('settings','a'))?.quietStart).toBe(21);expect((await store.list('settings','b'))[0].quietStart).toBe(23);
 await db.exec('PRAGMA user_version=99');await expect(migrate(db)).rejects.toThrow('请升级');expect((await store.get('settings','a'))?.quietStart).toBe(21);
});
