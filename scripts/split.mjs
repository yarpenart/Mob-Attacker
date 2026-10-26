import {integer} from './logic.mjs';
import {ID,syncPopulation,hordeSize,syncHordeName} from './population.mjs';
/** Bounded integer partitions preserve the total in both modes. */
export function distributeHP(total,count,max,mode='equal',random=Math.random) {
  integer(count,1,200,'count');integer(max,1,Number.MAX_SAFE_INTEGER,'max');
  integer(total,count,count*max,'total HP');
  if(mode==='equal') return Array.from({length:count},(_,i)=>Math.floor(total/count)+(i<total%count?1:0));
  if(mode!=='random') throw Error('Unknown HP distribution');
  let remaining=total;const result=[];
  for(let i=0;i<count;i++) {
    const rest=count-i-1,low=Math.max(1,remaining-rest*max),high=Math.min(max,remaining-rest);
    const hp=low+Math.floor(Math.min(0.999999999,Math.max(0,random()))*(high-low+1));
    result.push(hp);remaining-=hp;
  }
  for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}
  return result;
}
export function splitPositions(doc,count,width,scene) {
  const grid=scene.grid?.size ?? 100,step=Math.max(1,width)*grid;
  const bounds=scene.dimensions?.sceneRect ?? {x:0,y:0,width:scene.width ?? 100000,height:scene.height ?? 100000};
  const occupied=Array.from(scene.tokens?.values?.() ?? scene.tokens ?? []).filter(t=>t.id!==doc.id)
    .map(t=>({x:t.x,y:t.y,w:t.width*grid,h:t.height*grid}));
  const positions=[];
  for(let ring=0;ring<100 && positions.length<count;ring++) for(let y=-ring;y<=ring;y++) for(let x=-ring;x<=ring;x++) {
    if(Math.max(Math.abs(x),Math.abs(y))!==ring)continue;
    const p={x:doc.x+x*step,y:doc.y+y*step},w=width*grid;
    if(p.x<bounds.x||p.y<bounds.y||p.x+w>bounds.x+bounds.width||p.y+w>bounds.y+bounds.height)continue;
    if(occupied.some(o=>p.x<o.x+o.w&&p.x+w>o.x&&p.y<o.y+o.h&&p.y+w>o.y))continue;
    positions.push(p);occupied.push({...p,w,h:w});if(positions.length===count)return positions;
  }
  throw Error('Not enough free scene space to split this Horde');
}
export async function splitToken(doc,{mode='equal',requireAuthority=()=>{},random=Math.random}={}) {
  requireAuthority();await syncPopulation(doc);
  const pop=doc.getFlag(ID,'population'),config=doc.getFlag(ID,'horde');
  if(!config?.enabled||!pop||pop.current<2)throw Error('A Horde needs at least two living creatures to split');
  if(doc.getFlag(ID,'splitLock'))throw Error('This Horde is already being split');
  const scene=doc.parent,count=pop.current,hp=distributeHP(doc.actor.system.attributes.hp.value,count,pop.baseHP,mode,random);
  const shape=hordeSize(1,pop.baseSize),positions=splitPositions(doc,count,shape.width,scene);
  const actorData=doc.actor.toObject(),template=doc.toObject();
  const provenance={source:doc.uuid,initial:pop.initial,count,totalHP:hp.reduce((a,b)=>a+b,0),mode};
  const make=(i)=>{
    const data=foundry.utils.deepClone(template);delete data._id;delete data._stats;
    data.actorLink=false;data.name=`${pop.baseName} ${i+1}`;Object.assign(data,positions[i],{width:shape.width,height:shape.width});
    data.flags??={};data.flags[ID]={...data.flags[ID],horde:{...config,count:1},
      population:{...pop,initial:1,current:1,soloName:data.name},splitOrigin:provenance};delete data.flags[ID].splitLock;
    data.delta={...(data.delta ?? {}),name:actorData.name,system:foundry.utils.deepClone(actorData.system),
      items:foundry.utils.deepClone(actorData.items ?? []),effects:foundry.utils.deepClone(actorData.effects ?? []),flags:foundry.utils.deepClone(actorData.flags ?? {})};
    data.delta.system.attributes.hp={...data.delta.system.attributes.hp,max:pop.baseHP,value:hp[i],temp:i===0?(actorData.system.attributes.hp.temp??0):0};
    data.delta.system.traits.size=shape.size;
    return data;
  };
  const combats=Array.from(game.combats?.values?.() ?? (game.combat?[game.combat]:[]));
  const parents=combats.flatMap(combat=>Array.from(combat.combatants?.values?.() ?? []).filter(c=>c.tokenId===doc.id && (!c.sceneId||c.sceneId===scene.id)).map(c=>({combat,c})));
  const active=game.combat?.combatant?.id;
  let retainLock=false;
  const newTokens=[],newCombatants=[],ledgers=new Map();
  for(const {combat} of parents)ledgers.set(combat,foundry.utils.deepClone(combat.getFlag(ID,'ledger')));
  await doc.setFlag(ID,'splitLock',true);
  try {
    newTokens.push(...await scene.createEmbeddedDocuments('Token',Array.from({length:count-1},(_,i)=>make(i+1))));
    for(const {combat,c} of parents) {
      const data=newTokens.map(token=>{const d=c.toObject();delete d._id;delete d._stats;return {...d,tokenId:token.id,sceneId:scene.id,actorId:token.actorId,name:token.name,initiative:c.initiative};});
      const created=await combat.createEmbeddedDocuments('Combatant',data);newCombatants.push({combat,ids:created.map(c=>c.id)});
      const ledger=combat.getFlag(ID,'ledger');
      if(ledger?.turns?.length) {
        const used=ledger.turns.filter(row=>row.combatant===(c.uuid??c.id));
        if(used.length)await combat.setFlag(ID,'ledger',{...ledger,turns:[...ledger.turns,...created.flatMap(next=>used.map(row=>({...row,combatant:next.uuid??next.id})))]});
      }
    }
    // Retain the original token and combatant identities; convert them only after copies exist.
    const first=make(0);
    await doc.actor.update({'system.attributes.hp.max':pop.baseHP,'system.attributes.hp.value':hp[0],
      'system.traits.size':shape.size},{yaHordePopulation:true});
    await doc.update({name:first.name,x:first.x,y:first.y,width:first.width,height:first.height,
      [`flags.${ID}.horde`]:first.flags[ID].horde,[`flags.${ID}.population`]:first.flags[ID].population,
      [`flags.${ID}.splitOrigin`]:provenance});
    await syncHordeName(doc,1,first.flags[ID].population);
    // Equal initiative sorting can reorder entries; preserve the active combatant.
    if(active&&game.combat?.started){const turn=game.combat.turns.findIndex(c=>c.id===active);if(turn>=0&&turn!==game.combat.turn)await game.combat.update({turn});}
    return {tokens:[doc,...newTokens],hp};
  } catch(error) {
    // Restore the original before removing copies, so a failed operation cannot lose HP.
    try {
      await doc.actor.update({'system.attributes.hp.max':actorData.system.attributes.hp.max,'system.attributes.hp.value':actorData.system.attributes.hp.value,'system.traits.size':actorData.system.traits.size},{yaHordePopulation:true});
      await doc.update({name:template.name,x:template.x,y:template.y,width:template.width,height:template.height,
        [`flags.${ID}.horde`]:config,[`flags.${ID}.population`]:pop,...(template.flags?.[ID]?.splitOrigin ? {[`flags.${ID}.splitOrigin`]:template.flags[ID].splitOrigin} : {[`flags.${ID}.-=splitOrigin`]:null})});
    } catch(restoreError) {retainLock=true;throw new AggregateError([error,restoreError],'Split interrupted; copies retained. Check the original Horde before retrying.');}
    for(const {combat,ids} of newCombatants)await combat.deleteEmbeddedDocuments('Combatant',ids);
    if(newTokens.length)await scene.deleteEmbeddedDocuments('Token',newTokens.map(t=>t.id));
    for(const [combat,ledger] of ledgers) {if(ledger)await combat.setFlag(ID,'ledger',ledger);else await combat.unsetFlag(ID,'ledger');}
    throw error;
  } finally {if(!retainLock)await doc.unsetFlag(ID,'splitLock');}
}
