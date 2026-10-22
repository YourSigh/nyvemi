import { DatabaseSync } from 'node:sqlite';
import type { Database } from '../src/storage/store';
export class TestDatabase implements Database {
  private db=new DatabaseSync(':memory:');
  async exec(sql:string):Promise<void>{this.db.exec(sql);}
  async run(sql:string,...params:(string|number|null)[]):Promise<void>{this.db.prepare(sql).run(...params);}
  async all<T>(sql:string,...params:(string|number|null)[]):Promise<T[]>{return this.db.prepare(sql).all(...params) as T[];}
  async transaction<T>(work:(db:Database)=>Promise<T>):Promise<T>{this.db.exec('BEGIN IMMEDIATE');try{const result=await work(this);this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
}
