import { z } from 'zod';
import { PersonaSchema, demoPersona, defaultSettings, id, type Character } from '../domain/models';
import type { LLMProvider } from '../providers/provider';
import type { Storage } from '../storage/store';
export const AnswersSchema=z.object({name:z.string().trim().min(1).max(80),gender:z.string(),ageFeeling:z.string(),relationship:z.string(),talkativeness:z.string(),initiative:z.string(),quietTimes:z.string(),dislikedAI:z.string(),ventResponse:z.string(),tone:z.string(),inspiration:z.string()});
export type CharacterAnswers=z.infer<typeof AnswersSchema>;
export const defaultAnswers:CharacterAnswers={name:'',gender:'由相处决定',ageFeeling:'成年同龄人',relationship:'平等的朋友',talkativeness:'随话题自然变化',initiative:'有具体缘由再找我',quietTimes:'夜间不要打扰',dislikedAI:'每轮总结、模板共情、结尾问要不要继续',ventResponse:'先跟我一起吐槽两句',tone:'随意、有一点幽默',inspiration:''};
export class CharacterService {
 constructor(private store:Storage,private provider:()=>Promise<LLMProvider>){}
 async create(input:CharacterAnswers,useDemo=false):Promise<Character>{
  const answers=AnswersSchema.parse(input);const characterId=id();
  const persona=useDemo?{...demoPersona(characterId),name:answers.name}:await (await this.provider()).structuredOutput([
   {role:'system',content:'根据自然问答创造有边界、可长期相处的数字人格。不宣称意识，不强迫亲密，不创建未成年人色情设定。只输出 Persona JSON，字段和类型与示例一致，所有数组为字符串数组。示例：'+JSON.stringify(demoPersona(characterId))},
   {role:'user',content:JSON.stringify(answers)},
  ],PersonaSchema,'persona_generation');
  const now=Date.now();const character:Character={id:characterId,persona:{...persona,id:characterId,name:answers.name},state:{energy:0.7,relationshipCloseness:0.1,recentFocus:[],curiosityTopics:[]},interests:persona.likes.map(topic=>({topic,score:0.4,source:'initial',updatedAt:now})),createdAt:now};
  await this.store.atomic(async tx=>{await tx.put('characters',character);await tx.put('settings',defaultSettings(characterId));});return character;
 }
}
