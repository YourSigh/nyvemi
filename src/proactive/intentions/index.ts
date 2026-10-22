import type { Storage } from '../../storage/store';
export async function expireIntentions(store:Storage,characterId:string,now:number):Promise<number>{let count=0;for(const i of await store.list('intentions',characterId,10000))if(i.status==='pending'&&i.latestAt<=now){await store.put('intentions',{...i,status:'expired'});count++;}return count;}
