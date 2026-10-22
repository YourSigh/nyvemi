import { fetch as nativeFetch } from 'expo/fetch';
import { openStore,secretStore } from '../storage/native';
import { Diagnostics } from '../storage/diagnostics';
import { OpenAICompatibleProvider } from '../providers/openai';
import { type LLMProvider } from '../providers/provider';
import type { ProviderConfig } from '../domain/models';
import { CharacterService } from '../characters/service';
import { ChatService } from '../chat/service';
import { saveProviderSettings } from './provider-settings';
async function createRuntime(){
 const store=await openStore();const diagnostics=new Diagnostics(store);
 const provider=async():Promise<LLMProvider>=>{const config=await store.get('provider','provider');if(!config)throw new Error('请先配置 Provider');return new OpenAICompatibleProvider(config,secretStore,metric=>diagnostics.record('api','',{...metric}),nativeFetch as unknown as typeof fetch);};
 const saveProvider=(config:ProviderConfig,key:string)=>saveProviderSettings(store,secretStore,config,key);
 return {store,diagnostics,provider,saveProvider,characters:new CharacterService(store,provider),chat:new ChatService(store,provider,diagnostics)};
}
export type Runtime=Awaited<ReturnType<typeof createRuntime>>;
let pending:Promise<Runtime>|undefined;
export function getRuntime():Promise<Runtime>{return pending??=(createRuntime().catch(error=>{pending=undefined;throw error;}));}
