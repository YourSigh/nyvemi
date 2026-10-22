import { fetch as nativeFetch } from 'expo/fetch';
import type { Runtime } from '../../application/runtime';
import { LocalTimeExperienceSource,ConversationExperienceSource,RSSExperienceSource,type ExperienceSource } from '../../experience/sources';
import { ExperienceEngine } from '../../experience/engine';
export async function runBackgroundCycle(runtime:Runtime):Promise<void>{
 const now=Date.now();if(!await runtime.store.lease('background-cycle',now,540000))return;
 try{
  if(await runtime.store.get('provider','provider'))await runtime.extraction.drain(now,1);
  const engine=new ExperienceEngine(runtime.store);
  for(const character of await runtime.store.list('characters')){
   if(Date.now()-now>240000)break;
   const settings=await runtime.store.get('settings',character.id);if(!settings)continue;
   const sources:ExperienceSource[]=[new LocalTimeExperienceSource(character.id,now),new ConversationExperienceSource(runtime.store,character.id,now)];
   if(settings.proactiveEnabled && settings.rssUrls.length && now-(settings.lastRssAt??0)>=4*3600000){sources.push(...settings.rssUrls.map(url=>new RSSExperienceSource(character.id,url,now,nativeFetch as unknown as typeof fetch)));await runtime.store.atomic(async tx=>{const fresh=await tx.get('settings',character.id);if(fresh)await tx.put('settings',{...fresh,lastRssAt:now});});}
   await engine.ingest(character,sources,now,source=>runtime.diagnostics.error(character.id,`experience_source:${source.startsWith('rss:')?'rss':source}`));
  }
  await runtime.heartbeat.run();
 }finally{await runtime.store.release('background-cycle');}
}
