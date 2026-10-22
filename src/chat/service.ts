import { z } from 'zod';
import { id,type Memory,type Message } from '../domain/models';
import type { LLMProvider } from '../providers/provider';
import type { Storage } from '../storage/store';
import { Diagnostics } from '../storage/diagnostics';
import { buildChatPrompt } from './prompt';
const ReplySchema=z.object({messages:z.array(z.string().trim().min(1).max(6000)).min(1).max(4)});
export function parseReply(raw:string):string[]{
 const trimmed=raw.trim().replace(/^```(?:json)?\s*|\s*```$/g,'');
 try{return ReplySchema.parse(JSON.parse(trimmed)).messages;}catch{if(trimmed && !/^[{[]/.test(trimmed) && trimmed.length<=6000)return [trimmed];throw new Error('回复格式不完整，请重试本轮');}
}
export function streamingPreview(raw:string):string{
 if(!raw.trimStart().startsWith('{') && !raw.trimStart().startsWith('```'))return raw;
 const match=/"messages"\s*:\s*\[\s*"((?:\\.|[^"\\])*)/.exec(raw);
 if(!match)return '';try{return JSON.parse(`"${match[1]}"`) as string;}catch{return match[1].replace(/\\n/g,'\n').replace(/\\"/g,'"').replace(/\\$/,'');}
}
export interface ChatHooks {
 retrieve:(characterId:string,query:string)=>Promise<Memory[]>;
 afterRound:(characterId:string,user:Message,assistant:Message[])=>Promise<void>;
}
const noHooks:ChatHooks={retrieve:async()=>[],afterRound:async()=>{}};
export class ChatService {
 constructor(private store:Storage,private provider:()=>Promise<LLMProvider>,private diagnostics:Diagnostics,private hooks:ChatHooks=noHooks,private pause:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){}
 async history(characterId:string):Promise<Message[]>{return (await this.store.list('messages',characterId,100)).filter(m=>m.status!=='pending'&&!(m.origin==='proactive'&&m.status==='error')).sort((a,b)=>a.createdAt-b.createdAt);}
 async send(characterId:string,text:string,onPreview:(text:string)=>void,onSaved:()=>void=()=>{},signal?:AbortSignal,retryId?:string):Promise<void>{
  const content=text.trim();if(!content || content.length>6000)throw new Error('请输入 1～6000 字消息');
  const lease=`chat:${characterId}`;if(!await this.store.lease(lease,Date.now(),180000))throw new Error('这一轮还没聊完，请稍候');
  let user:Message|undefined; let hasReply=false;
  try {
   const character=await this.store.get('characters',characterId);if(!character)throw new Error('角色不存在');
   const settings=await this.store.get('settings',characterId);if(settings)await this.store.put('settings',{...settings,lastActiveAt:Date.now()});
   user=retryId?await this.store.get('messages',retryId):undefined;
   if(user && (user.characterId!==characterId || user.role!=='user' || user.status!=='error'))throw new Error('这条消息不能重试');
   user=user?{...user,status:'complete'}:{id:id(),characterId,role:'user',content,createdAt:Date.now(),origin:'chat',status:'complete'};
   await this.store.put('messages',user);onSaved();
   const history=(await this.history(characterId)).filter(m=>m.status==='complete');const memories=await this.hooks.retrieve(characterId,content);
   const prompt=buildChatPrompt(character,history,memories);if(settings?.developerMode)await this.diagnostics.record('prompt',characterId,{purpose:'chat',messages:prompt});
   let raw='';const result=await (await this.provider()).streamChat(prompt,delta=>{raw+=delta;onPreview(streamingPreview(raw));},signal);
   const replies=parseReply(result.content);const saved:Message[]=[];const base=Date.now();
   for(let n=0;n<replies.length;n++){
    if(n>0)await this.pause(400+Math.floor(Math.random()*600));
    const message:Message={id:id(),characterId,role:'assistant',content:replies[n],createdAt:base+n,origin:'chat',status:'complete',groupId:user.id};
    await this.store.put('messages',message);hasReply=true;saved.push(message);onPreview('');onSaved();
   }
   // Hooks persist their durable work before returning; actual extraction does not block the composer.
   try{await this.hooks.afterRound(characterId,user,saved);}catch{await this.diagnostics.error(characterId,'post_round');}
  }catch(error){if(user && !hasReply)await this.store.put('messages',{...user,status:'error'});onPreview('');onSaved();await this.diagnostics.error(characterId,'chat');throw error;}
  finally{await this.store.release(lease);}
 }
}
