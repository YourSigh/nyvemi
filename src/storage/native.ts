import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { migrate, SQLiteStore, type Database } from './store';
import type { SecretStore } from '../providers/provider';
function adapt(db:SQLite.SQLiteDatabase):Database {
  return {
    exec:sql=>db.execAsync(sql),
    run:async(sql,...params)=>{await db.runAsync(sql,...params);},
    all:<T>(sql:string,...params:(string|number|null)[])=>db.getAllAsync<T>(sql,...params),
    transaction:async<T>(work:(tx:Database)=>Promise<T>):Promise<T>=>{
      let result:T|undefined;
      await db.withExclusiveTransactionAsync(async tx=>{result=await work(adapt(tx));});
      return result as T;
    },
  };
}
let pending:Promise<SQLiteStore>|undefined;
export function openStore():Promise<SQLiteStore> {
  pending ??= (async()=>{const db=adapt(await SQLite.openDatabaseAsync('nyvemi.db'));await migrate(db);return new SQLiteStore(db);})().catch(error=>{pending=undefined;throw error;});
  return pending;
}
const KEY='nyvemi.provider.api-key';
export const secretStore:SecretStore={get:()=>SecureStore.getItemAsync(KEY),set:key=>SecureStore.setItemAsync(KEY,key,{keychainAccessible:SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY}),remove:()=>SecureStore.deleteItemAsync(KEY)};
