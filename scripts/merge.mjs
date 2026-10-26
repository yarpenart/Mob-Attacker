import {withTokenOperation,tokenOperationActive} from './token-operations.mjs';
import {rememberInitiatives} from './combat-memory.mjs';
import {assignMergedName} from './naming.mjs';
import {ID,hordeSize,creatureName} from './population.mjs';
const clone=value=>foundry.utils.deepClone(value);
const combats=()=>Array.from(game.combats?.values?.() ?? (game.combat?[game.combat]:[]));
const combatants=(combat,docs)=>Array.from(combat.combatants?.values?.() ?? []).filter(c=>docs.some(doc=>c.tokenId===doc.id&&(!c.sceneId||c.sceneId===doc.parent.id)));
export function mergedInitiative(values,mode='median') {
  if(!['highest','median','lowest'].includes(mode))throw Error('Invalid merged Horde initiative mode');
  const rolled=values.filter(value=>typeof value==='number'&&Number.isFinite(value)).sort((a,b)=>a-b);
  if(!rolled.length)return null;
  if(mode==='highest')return rolled.at(-1);
  if(mode==='lowest')return rolled[0];
  const middle=Math.floor(rolled.length/2);
  return rolled[middle];
}
export function mergePlan(tokens,preferred,{owned=false}={}) {
  const docs=[...new Map(tokens.map(t=>t.document ?? t).map(d=>[d.uuid,d])).values()];
  if(docs.length<2||docs.length>200)throw Error('Select 2–200 individual NPC tokens to merge');
  const active=game.combat?.combatant?.tokenId;
  const anchor=docs.find(d=>d.id===active) ?? docs.find(d=>d.uuid===preferred?.uuid) ?? docs[0];
  const members=docs.map(doc=>{
    const actor=doc.actor,pop=doc.getFlag(ID,'population'),config={...(actor?.getFlag(ID,'horde')??{}),...(doc.getFlag(ID,'horde')??{})};
    if(actor?.type!=='npc'||doc.parent?.id!==anchor.parent?.id)throw Error('Select NPC tokens on the same scene');
    if(!owned&&tokenOperationActive(doc))throw Error('A selected token is already being split or merged');
    if(config.enabled&&Number(config.count??1)!==1)throw Error('Merge only individual living creatures; split larger Hordes first');
    const livingIndex=pop?.members?.findIndex(hp=>hp>0)??0;
    const single=Number(pop?.initial??1)===1;
    const hp=Number(actor.system.attributes.hp.value),max=Number(single?actor.system.attributes.hp.max:(pop?.maxima?.[Math.max(0,livingIndex)] ?? pop?.baseHP ?? actor.system.attributes.hp.max)),size=pop?.baseSize ?? actor.system.traits.size;
    if(!Number.isSafeInteger(hp)||!Number.isSafeInteger(max)||hp<1||hp>max)throw Error('Each selected creature must have 1 to its base maximum HP');
    const baseActorId=doc.baseActor?.id??doc.actorId,attackLimit=Number(config.attackLimit??1);
    if(!baseActorId||!Number.isSafeInteger(attackLimit)||attackLimit<1||attackLimit>10)throw Error('Selected creatures have invalid base actor or attack limits');
    return {doc,actor,hp,max,size,config,pop,baseActorId,attackLimit};
  });
  const source=members.find(m=>m.doc===anchor);
  // Synthetic actor names belong to individual tokens; they do not identify the base NPC.
  if(members.some(m=>m.baseActorId!==source.baseActorId))throw Error('Merge creatures based on the same NPC actor');
  if(members.some(m=>m.size!==source.size))throw Error('Merge creatures with the same base size');
  if(members.some(m=>m.attackLimit!==source.attackLimit))throw Error('Merge creatures with the same attack limit');
  return {docs,anchor,members,source,count:members.length,hp:members.reduce((n,m)=>n+m.hp,0),max:members.reduce((sum,m)=>sum+m.max,0)};
}
export async function mergeTokens(tokens,options={}){
 options.requireAuthority?.();
 const docs=[...new Map(tokens.map(t=>t.document??t).map(doc=>[doc.uuid,doc])).values()];
 return withTokenOperation(docs,()=>mergeTokensWork(docs,options));
}
async function mergeTokensWork(tokens,{preferred,requireAuthority=()=>{},initiativeMode}={}) {
  requireAuthority();const plan=mergePlan(tokens,preferred,{owned:true}),{docs,anchor,members,source,count,hp,max}=plan;
  const scene=anchor.parent,removed=docs.filter(d=>d!==anchor),shape=hordeSize(count,source.size);
  const tokenBackups=docs.map(doc=>{const data=clone(doc.toObject());if(data.flags?.[ID])delete data.flags[ID].mergeOrigin;return data;});
  const records=combats().map(combat=>({combat,rows:combatants(combat,docs),ledger:clone(combat.getFlag(ID,'ledger')),active:combat.combatant?.id})).filter(r=>r.rows.length);
  initiativeMode??=game.settings.get(ID,'mergeInitiative')??'median';
  for(const record of records){record.backups=record.rows.map(c=>clone(c.toObject()));record.initiative=mergedInitiative(record.rows.map(c=>c.initiative),initiativeMode);}
  for(const {combat} of records)await rememberInitiatives(docs,combat);
  const battle=docs.map(doc=>doc.getFlag(ID,'battle')),common=battle[0];
  const mergedBattle=common&&battle.every(b=>b?.combat===common.combat&&b.session===common.session)?{...common,ids:battle.flatMap((b,i)=>b.ids.filter((id,j)=>id&&(!members[i].pop?.members||members[i].pop.members[j]>0)))}:null;
  const baseName=source.pop?.baseName||anchor.baseActor?.name||creatureName(anchor);
  const group=source.config.group||baseName;
  const statblockHP=Number(anchor.baseActor?.system.attributes.hp.max??source.pop?.statblockHP??source.pop?.baseHP??source.max);
  const population={baseHP:statblockHP,statblockHP,baseSize:source.size,baseName,soloName:source.pop?.soloName||anchor.name,
    width:source.pop?.width??anchor.width,height:source.pop?.height??anchor.height,initial:count,current:count,members:members.map(m=>m.hp),maxima:members.map(m=>m.max)};
  const actorData=source.actor.toObject();
  let name=`${population.baseName} (Horde)`;
  const system=clone(actorData.system);system.attributes.hp={...system.attributes.hp,max,value:hp,temp:members.reduce((n,m)=>n+Number(m.actor.system.attributes.hp.temp??0),0)};system.traits.size=shape.size;
  let deleting=false;
  try {
    await anchor.update({actorLink:false,name,width:shape.width,height:shape.width,
      delta:{system},...(mergedBattle?{[`flags.${ID}.battle`]:mergedBattle}:{}),[`flags.${ID}.horde`]:{...source.config,enabled:true,count,attackLimit:source.attackLimit,group},
      [`flags.${ID}.population`]:population,[`flags.${ID}.mergeLock`]:true,
      [`flags.${ID}.mergeOrigin`]:{members:docs.map((d,i)=>({uuid:d.uuid,name:d.name,hp:members[i].hp,max:members[i].max})),
        // Keep recoverable snapshots before replacing the source tokens.
        tokens:tokenBackups,combats:records.map(r=>({uuid:r.combat.uuid,combatants:r.backups}))}});
    ({name}=await assignMergedName(anchor,population.baseName));
    if(anchor.name!==name)await anchor.update({name});
    for(const record of records){
      const {combat,rows}=record;
      let keep=rows.find(c=>c.tokenId===anchor.id);
      if(!keep){const data=clone(rows[0].toObject());delete data._id;delete data._stats;[keep]=await combat.createEmbeddedDocuments('Combatant',[{...data,tokenId:anchor.id,actorId:anchor.actorId,sceneId:scene.id,name,initiative:record.initiative}]);}
      record.keep=keep;
      await combat.updateEmbeddedDocuments('Combatant',[{_id:keep.id,name,initiative:record.initiative}]);
      const ledger=record.ledger;
      if(ledger?.turns){
        const ids=new Set(rows.map(c=>c.uuid??c.id)),slots=new Map();
        for(const row of ledger.turns.filter(r=>ids.has(r.combatant))){
          const key=JSON.stringify([row.round,row.slot]),old=slots.get(key);
          slots.set(key,{...row,combatant:keep.uuid??keep.id,group,hits:Math.max(old?.hits??0,row.hits??0),forced:!!(old?.forced||row.forced)});
        }
        await combat.setFlag(ID,'ledger',{...ledger,turns:[...ledger.turns.filter(r=>!ids.has(r.combatant)),...slots.values()]});
      }
    }
    deleting=true;
    // Token deletion also removes its combatants in Foundry. Keep explicit cleanup
    // for worlds/modules that leave those entries behind.
    await scene.deleteEmbeddedDocuments('Token',removed.map(d=>d.id));
    for(const {combat,rows,keep,active} of records){
      const stale=rows.filter(c=>c.id!==keep.id&&combat.combatants.has(c.id));if(stale.length)await combat.deleteEmbeddedDocuments('Combatant',stale.map(c=>c.id));
      const wanted=rows.some(c=>c.id===active)?keep.id:active;
      const turn=combat.turns?.findIndex(c=>c.id===wanted);if(combat.started&&turn>=0&&combat.turn!==turn)await combat.update({turn});
    }
    await anchor.unsetFlag(ID,'mergeLock');
    return {token:anchor,count,hp,max};
  } catch(error){
    if(deleting&&!removed.every(doc=>scene.tokens.has(doc.id)))throw new Error(`Merge interrupted during token cleanup. Source snapshots are stored on the retained token; inspect the scene before retrying. ${error.message}`);
    // Nothing has been deleted: restore the retained token and turn counters.
    const backup=tokenBackups[docs.indexOf(anchor)];
    await anchor.update({...backup,[`flags.${ID}.-=mergeLock`]:null,[`flags.${ID}.-=mergeOrigin`]:null,
      ...(!backup.flags?.[ID]?.naming?{[`flags.${ID}.-=naming`]:null}:{}),...(!backup.flags?.[ID]?.population?{[`flags.${ID}.-=population`]:null}:{}),...(!backup.flags?.[ID]?.horde?{[`flags.${ID}.-=horde`]:null}:{})},{diff:false,recursive:false});
    for(const record of records){
      if(record.ledger)await record.combat.setFlag(ID,'ledger',record.ledger);
      if(record.keep&&!record.rows.some(c=>c.id===record.keep.id))await record.combat.deleteEmbeddedDocuments('Combatant',[record.keep.id]);
      await record.combat.updateEmbeddedDocuments('Combatant',record.backups);
    }
    throw error;
  }
}
