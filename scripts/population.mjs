import {hordeLabel} from './naming.mjs';
/** Population is token-local; never scale a shared world actor. */
export const ID='yarpenart-mob-attacker';
export function livingCount(hp,base,initial) {
  return Math.max(0,Math.min(initial,Math.ceil(Math.max(0,Number(hp))/base)));
}
export const SIZE_DEFAULTS={sm:{med:2,lg:3,huge:6,grg:10},med:{lg:3,huge:6,grg:10},lg:{huge:6,grg:10}};
export function sizeThresholds(base) {
  const defaults=SIZE_DEFAULTS[base];if(!defaults)return null;
  const result={};let previous=1;
  for(const [size,fallback] of Object.entries(defaults)) {
    const n=globalThis.game?.settings?.get(ID,`size_${base}_${size}`) ?? fallback;
    if(!Number.isSafeInteger(n)||n<=previous||n>200)throw Error('Horde size thresholds must increase and remain between 2 and 200');
    result[size]=n;previous=n;
  }
  return result;
}
export function hordeSize(count,base='med',thresholds=sizeThresholds(base)) {
  const rank={tiny:0,sm:1,med:2,lg:3,huge:4,grg:5};
  let index=rank[base]??2;
  const rules=thresholds ?? SIZE_DEFAULTS.med;
  for(const [size,min] of Object.entries(rules))if(count>=min)index=Math.max(index,rank[size]);
  return {size:['tiny','sm','med','lg','huge','grg'][index],width:[0.5,1,1,2,3,4][index]};
}
export function creatureName(doc) {
  return String(doc.actor?.name || doc.name || 'NPC').replace(/(?:\s*\(Horde\))+\s*$/i,'').trim();
}
export async function syncHordeName(doc,count,population=doc?.getFlag(ID,'population')) {
  if(!doc?.actor)return;
  const base=population?.baseName || creatureName(doc);
  const name=count>1 ? await hordeLabel(doc,base) : population?.soloName || base;
  if(doc.name!==name)await doc.update({name});
  for(const combat of globalThis.game?.combats?.values?.() ?? (globalThis.game?.combat ? [game.combat] : [])) {
    const updates=Array.from(combat.combatants?.values?.() ?? []).filter(c=>c.tokenId===doc.id && (!c.sceneId || c.sceneId===doc.parent?.id) && c.name!==name).map(c=>({_id:c.id,name}));
    if(updates.length)await combat.updateEmbeddedDocuments('Combatant',updates);
  }
}
/** Merged wounded individuals retain their living count and wounds. */
export function updateMembers(members,hp,baseHP) {
  const limits=Array.isArray(baseHP)?baseHP:members.map(()=>baseHP);
  const result=[...members];let delta=hp-result.reduce((a,b)=>a+b,0);
  if(delta<0)for(let i=0;i<result.length&&delta<0;i++){const loss=Math.min(result[i],-delta);result[i]-=loss;delta+=loss;}
  if(delta>0)for(const alive of [true,false])for(let i=0;i<result.length&&delta>0;i++) {
    if((result[i]>0)!==alive)continue;const gain=Math.min(limits[i]-result[i],delta);result[i]+=gain;delta-=gain;
  }
  return result;
}
export async function rollMemberMaxima(actor,count) {
  const custom=game.settings.get(ID,'hordeHPFormula');
  const formula=(typeof custom==='string'&&custom.trim())||actor.system.attributes.hp.formula;
  if(!formula)throw Error('This NPC has no HP formula. Set a formula in Horde HP settings.');
  const values=[];
  for(let i=0;i<count;i++){
    const roll=await new Roll(formula,actor.getRollData()).evaluate();
    if(!Number.isFinite(roll.total))throw Error('Invalid creature HP roll');
    values.push(Math.max(1,Math.floor(roll.total)));
  }
  return values;
}
export async function syncPopulation(doc,options={}) {
  if (!doc?.actor || doc.documentName==='Actor') return;
  let actor=doc.actor;
  if (!actor.system?.attributes?.hp) return;
  const config=options.config ?? doc.getFlag(ID,'horde') ?? actor.getFlag(ID,'horde') ?? {};
  let population=foundry.utils.deepClone(doc.getFlag(ID,'population'));
  if (!config.enabled && !population) return;
  if (doc.actorLink) {
    // A synthetic actor gives this token its own HP and size.
    await doc.update({actorLink:false,delta:{system:foundry.utils.deepClone(actor.toObject().system)}});
    actor=doc.actor;
  }
  const hp=actor.system.attributes.hp;
  if (!config.enabled) {
    const remaining=population.members?.find(value=>value>0)??(hp.value>0 ? ((hp.value-1)%population.baseHP)+1 : 0);
    const singleMax=population.maxima?.[Math.max(0,population.members.findIndex(hp=>hp>0))]??population.baseHP;
    await actor.update({'system.attributes.hp.max':singleMax,'system.attributes.hp.value':remaining,
      'system.traits.size':population.baseSize},{yaHordePopulation:true});
    await syncHordeName(doc,1,population);
    await doc.update({width:population.width,height:population.height,[`flags.${ID}.horde`]:{...config,count:1},
      [`flags.${ID}.-=population`]:null});
    return;
  }
  const requested=Number(config.count ?? 1);
  const resize=!population || options.reconfigure && requested!==population.current || options.rerollHP;
  if (!population) {
    const baseHP=Number(hp.max);
    if (!(baseHP>0)) throw Error('Horde requires positive maximum HP');
    population={baseHP,baseSize:actor.system.traits.size,width:doc.width ?? 1,height:doc.height ?? 1,
      initial:requested,current:requested};
  }
  population.baseName ??= creatureName(doc);
  population.soloName ??= String(doc.name || population.baseName).replace(/(?:\s*\(Horde\))+\s*$/i,'').trim();
  let currentHP=Number(hp.value);
  if (resize) {
    const oldMax=Number(hp.max),damage=Math.max(0,oldMax-currentHP);
    delete population.members;delete population.maxima;
    population.initial=requested;
    if(options.rerollHP||game.settings.get(ID,'hordeHPMode')==='rolled') {
      population.maxima=await rollMemberMaxima(actor,requested);
      const total=population.maxima.reduce((a,b)=>a+b,0);
      currentHP=Math.max(0,total-damage);
      population.members=updateMembers(population.maxima,currentHP,population.maxima);
    } else currentHP=Math.max(0,population.baseHP*requested-damage);
  }
  if(Array.isArray(population.members)) {population.members=updateMembers(population.members,currentHP,population.maxima??population.baseHP);population.current=population.members.filter(hp=>hp>0).length;}
  else population.current=livingCount(currentHP,population.baseHP,population.initial);
  const shape=hordeSize(population.current,population.baseSize);
  const max=population.maxima?.reduce((a,b)=>a+b,0)??population.baseHP*population.initial;
  const actorUpdate={};
  if (hp.max!==max) actorUpdate['system.attributes.hp.max']=max;
  if (hp.value!==currentHP) actorUpdate['system.attributes.hp.value']=currentHP;
  if (actor.system.traits.size!==shape.size) actorUpdate['system.traits.size']=shape.size;
  if (Object.keys(actorUpdate).length) await actor.update(actorUpdate,{yaHordePopulation:true});
  const changed=JSON.stringify(population)!==JSON.stringify(doc.getFlag(ID,'population'));
  if (changed || config.count!==population.current || doc.width!==shape.width || doc.height!==shape.width) {
    await doc.update({width:shape.width,height:shape.width,[`flags.${ID}.horde`]:{...config,count:population.current},
      [`flags.${ID}.population`]:population});
  }
  await syncHordeName(doc,population.current,population);
  return population;
}
export async function populationActorUpdated(actor,changes,options={}) {
  if (options.yaHordePopulation) return;
  const doc=actor.token;
  if(doc?.getFlag(ID,'mergeLock'))return;
  if (doc?.getFlag(ID,'population')) await syncPopulation(doc);
}
