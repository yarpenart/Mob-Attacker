import {serialQueue} from './logic.mjs';
const ID='yarpenart-mob-attacker',enqueue=serialQueue(),finished=new Set();
const clone=value=>foundry.utils.deepClone(value);
const rows=combat=>Array.from(combat.combatants?.values?.()??[]);
const matches=(row,doc)=>row.tokenId===doc.id&&(!row.sceneId||row.sceneId===doc.parent?.id);
const rolled=value=>typeof value==='number'&&Number.isFinite(value);
export function memoryScope(){
 const combat=globalThis.game?.combat;
 return combat?.started?`${combat.uuid}:${combat.getFlag(ID,'session')?.id??'legacy'}`:globalThis.canvas?.scene?.uuid??'scene';
}
export function tokenCombats(doc){return Array.from(game.combats?.values?.()??(game.combat?[game.combat]:[])).filter(c=>c.started&&rows(c).some(row=>matches(row,doc)));}
async function sessionFor(combat){
 let session=clone(combat.getFlag(ID,'session'));
 if(!session||session.finished)session={id:foundry.utils.randomID?.()??`${Date.now()}-${Math.random()}`,next:1,members:[]};
 return session;
}
export async function ensureCombat(combat){
 if(!combat?.started)return;
 return enqueue(async()=>{const fresh=!combat.getFlag(ID,'session'),session=await sessionFor(combat);await combat.setFlag(ID,'session',session);
  if(fresh&&combat.scene?.unsetFlag)for(const key of ['ledger','saveLedger'])if(combat.scene.getFlag(ID,key))await combat.scene.unsetFlag(ID,key);
  return session;});
}
/** IDs follow creatures through token replacement. HP snapshots live only on this Combat. */
export async function trackPopulation(doc,pop,{combat}={}){
 if(!pop||doc.getFlag(ID,'splitLock')||doc.getFlag(ID,'mergeLock'))return;
 for(const encounter of combat?[combat]:tokenCombats(doc))await enqueue(async()=>{
  const session=await sessionFor(encounter),old=doc.getFlag(ID,'battle');
  const same=!!old&&old.combat===encounter.uuid&&old.session===session.id;
  const ids=same?[...old.ids]:[],limits=pop.maxima??Array(pop.initial).fill(pop.baseHP);
  let remaining=Number(doc.actor.system.attributes.hp.value);
  const hp=pop.members??limits.map((max,i)=>{const value=Math.min(max,Math.max(0,remaining-limits.slice(i+1).reduce((a,b)=>a+b,0)));remaining-=value;return value;});
  for(let i=0;i<limits.length;i++){
   let member=ids[i]&&session.members.find(m=>m.id===ids[i]);
   if(!member&&hp[i]>0){ids[i]=`${session.id}-${session.next++}`;member={id:ids[i],name:pop.baseName??doc.actor.name,max:limits[i]};session.members.push(member);}
   if(member){member.hp=hp[i];member.max=limits[i];}
  }
  await doc.setFlag(ID,'battle',{combat:encounter.uuid,session:session.id,ids});
  await encounter.setFlag(ID,'session',session);
 });
}
/** Record each singleton's current initiative before replacing its combatant. */
export async function rememberInitiatives(docs,combat){
 for(const doc of docs){
  const pop=doc.getFlag(ID,'population')??{baseHP:Number(doc.actor.system.attributes.hp.max),initial:1,current:1,baseName:doc.baseActor?.name??doc.actor.name,members:[Number(doc.actor.system.attributes.hp.value)]};
  await trackPopulation(doc,pop,{combat});
 }
 await enqueue(async()=>{
  const session=await sessionFor(combat);
  for(const doc of docs){const battle=doc.getFlag(ID,'battle');if(battle?.session!==session.id)continue;
   const live=battle.ids.filter(id=>session.members.find(m=>m.id===id)?.hp>0),row=rows(combat).find(row=>matches(row,doc));
   if(live.length===1&&rolled(row?.initiative)){const member=session.members.find(m=>m.id===live[0]);member.initiative=row.initiative;}
  }
  await combat.setFlag(ID,'session',session);
 });
}
export async function restoreInitiatives(combat,docs){
 const session=combat.getFlag(ID,'session'),updates=[],missing=[];
 for(const doc of docs){const row=rows(combat).find(row=>matches(row,doc));if(!row)continue;
  const battle=doc.getFlag(ID,'battle'),member=battle?.combat===combat.uuid&&battle.session===session?.id?session.members.find(m=>m.id===battle.ids[0]):null;
  if(rolled(member?.initiative))updates.push({_id:row.id,initiative:member.initiative});else missing.push(row.id);
 }
 if(updates.length)await combat.updateEmbeddedDocuments('Combatant',updates);
 if(missing.length)await combat.rollInitiative(missing,{updateTurn:true});
 await rememberInitiatives(docs,combat);
 return {restored:updates.length,rolled:missing.length};
}
export async function trackInitiative(row){
 const combat=row.parent,doc=row.token;if(!combat?.started||!doc||doc.getFlag(ID,'splitLock')||doc.getFlag(ID,'mergeLock'))return;
 if(doc.getFlag(ID,'horde')?.enabled)await rememberInitiatives([doc],combat);
}
/** Base creature names are independent of numbered token/Horde labels. */
export function summaryByUnit(members){
 const groups=new Map();
 for(const member of members){
  const name=String(member.name??'NPC').trim()||'NPC';
  const row=groups.get(name)??{name,total:0,killed:0,survived:0};
  row.total++;if(member.hp<=0)row.killed++;else row.survived++;
  groups.set(name,row);
 }
 return Array.from(groups.values()).sort((a,b)=>a.name.localeCompare(b.name));
}
export async function finishCombat(combat,{deleted=false,t=key=>key,esc=value=>String(value)}={}){
 return enqueue(async()=>{
  const session=clone(combat.getFlag(ID,'session'));if(!session||session.finished||finished.has(session.id))return;
  finished.add(session.id);
  const total=session.members.length,killed=session.members.filter(m=>m.hp<=0).length;
  const scope=`${combat.uuid}:${session.id}`;
  // Preserve current physical HP/population; discard encounter-only provenance and rolls.
  for(const scene of game.scenes?.values?.()??[])for(const token of scene.tokens.values()){
   const battle=token.getFlag(ID,'battle');if(battle?.combat!==combat.uuid||battle.session!==session.id)continue;
   for(const key of ['battle','mergeOrigin','splitOrigin'])if(token.getFlag(ID,key))await token.unsetFlag(ID,key);
  }
  for(const message of game.messages?.contents??[]){
   const save=message.getFlag(ID,'save');
   if(save?.scope===scope&&['pending','applying'].includes(save.status))await message.update({[`flags.${ID}.save.status`]:'expired'});
   if(message.getFlag(ID,'saveDamage')?.scope===scope)await message.unsetFlag(ID,'saveDamage');
  }
  if(!deleted){for(const key of ['session','ledger','saveLedger'])if(combat.getFlag(ID,key))await combat.unsetFlag(ID,key);}
  if(combat.scene?.unsetFlag)for(const key of ['ledger','saveLedger'])if(combat.scene.getFlag(ID,key))await combat.scene.unsetFlag(ID,key);
  const units=summaryByUnit(session.members);
  const table=`<table><thead><tr>${['summaryUnit','summaryTotal','summarySurvived','summaryKilled'].map(key=>`<th scope="col">${esc(t(key))}</th>`).join('')}</tr></thead><tbody>${units.map(row=>`<tr><th scope="row">${esc(row.name)}</th><td>${row.total}</td><td>${row.survived}</td><td>${row.killed}</td></tr>`).join('')}</tbody></table>`;
  if(total&&game.settings.get(ID,'combatSummary')!==false)await ChatMessage.create({
   content:`<div class="ya-horde-card"><strong>${esc(t('combatSummaryTitle'))}</strong><p>${esc(t('combatSummaryText',{total,killed,survived:total-killed}))}</p>${table}</div>`,
   whisper:game.users.filter(user=>user.isGM).map(user=>user.id)});
  return {total,killed,survived:total-killed};
 });
}
