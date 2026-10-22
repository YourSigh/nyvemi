import { SettingsSchema,type Settings } from '../domain/models';
import type { Storage } from '../storage/store';
export type EditableSettings=Pick<Settings,'quietStart'|'quietEnd'|'dailyLimit'|'minIntervalMinutes'|'recentActiveMinutes'|'proactiveEnabled'|'rssUrls'|'developerMode'>;
export async function updateSettings(store:Storage,characterId:string,patch:Partial<EditableSettings>):Promise<Settings>{return store.atomic(async tx=>{const current=await tx.get('settings',characterId);if(!current)throw new Error('角色设置不存在');const next=SettingsSchema.parse({...current,...patch});for(const url of next.rssUrls){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw new Error('RSS 需要不含凭据的 HTTPS 地址');}await tx.put('settings',next);return next;});}
export async function markAppActive(store:Storage,now=Date.now()):Promise<void>{await store.atomic(async tx=>{for(const settings of await tx.list('settings'))await tx.put('settings',{...settings,lastActiveAt:now});});}
