import type { Character,Intention } from '../../domain/models';
export interface InitiativeScore {score:number;threshold:number;components:Record<string,number>}
export function scoreIntention(intention:Intention,character:Character,now:number,lastActiveAt:number):InitiativeScore{
 const window=Math.max(1,intention.latestAt-intention.earliestAt);const urgency=Math.min(1,Math.max(0,(now-intention.earliestAt)/window));
 const awayHours=Math.max(0,(now-lastActiveAt)/3600000);const interruptionCost=awayHours<1?0.25:awayHours<3?0.10:0.04;
 const components={relevance:intention.importance*0.55,urgency:urgency*0.15,emotionalValue:0.08,novelty:intention.type==='share'?0.10:0.06,relationshipValue:character.state.relationshipCloseness*0.12,interruptionCost:interruptionCost+(character.state.energy<0.3?0.12:0),recentMessagePenalty:0};
 const score=Math.max(0,Math.min(1,components.relevance+components.urgency+components.emotionalValue+components.novelty+components.relationshipValue-components.interruptionCost));
 return {score,threshold:0.58,components};
}
