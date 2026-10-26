const ID='yarpenart-mob-attacker';
export function packetAvailable(){return typeof game.dnd5e?.dice?.aggregateDamageRolls==='function'&&typeof CONFIG.Dice.DamageRoll.toMessage==='function';}
/** Aggregate evaluated native rolls without multiplying a single result or rolling dice again. */
export async function postDamagePacket(rolls,{actor,activity,options,target,partial=false}){
 if(!rolls.length)return null;
 if(!packetAvailable())throw Error('Native D&D5e damage aggregation is unavailable');
 if(rolls.some(roll=>!Number.isFinite(roll.total)))throw Error('Invalid collected damage roll');
 const aggregate=game.dnd5e.dice.aggregateDamageRolls(rolls,{respectProperties:true});
 if(!aggregate.length)throw Error('Damage aggregation returned no rolls');
 return CONFIG.Dice.DamageRoll.toMessage(aggregate,{
  speaker:ChatMessage.getSpeaker({actor}),flavor:activity?.item.name??options.attackName??actor.name,
  flags:{dnd5e:{...(activity?.messageFlags??{}),messageType:'roll',roll:{type:'damage'}},[ID]:{damagePacket:true,target,partial}}
 },{rollMode:options.rollMode});
}
