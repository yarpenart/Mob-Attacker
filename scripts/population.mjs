/** Population is token-local; never scale a shared world actor. */
export const ID='yarpenart-mob-attacker';
export function livingCount(hp,base,initial) {
  return Math.max(0,Math.min(initial,Math.ceil(Math.max(0,Number(hp))/base)));
}
export function hordeSize(count,base='med') {
  const rank={tiny:0,sm:1,med:2,lg:3,huge:4,grg:5};
  const desired=count>=10?5:count>=6?4:count>=3?3:count===2?2:(rank[base]??2);
  const index=Math.max(rank[base]??2,desired);
  return {size:['tiny','sm','med','lg','huge','grg'][index],width:[0.5,1,1,2,3,4][index]};
}
export async function syncPopulation(doc,options={}) {
  if (!doc?.actor || doc.documentName==='Actor') return;
  let actor=doc.actor;
  if (!actor.system?.attributes?.hp) return;
  const config=options.config ?? doc.getFlag(ID,'horde') ?? actor.getFlag(ID,'horde') ?? {};
  let population=doc.getFlag(ID,'population');
  if (!config.enabled && !population) return;
  if (doc.actorLink) {
    // A synthetic actor gives this token its own HP and size.
    await doc.update({actorLink:false,delta:{system:foundry.utils.deepClone(actor.toObject().system)}});
    actor=doc.actor;
  }
  const hp=actor.system.attributes.hp;
  if (!config.enabled) {
    const remaining=hp.value>0 ? ((hp.value-1)%population.baseHP)+1 : 0;
    await actor.update({'system.attributes.hp.max':population.baseHP,'system.attributes.hp.value':remaining,
      'system.traits.size':population.baseSize},{yaHordePopulation:true});
    await doc.update({width:population.width,height:population.height,[`flags.${ID}.horde`]:{...config,count:1},
      [`flags.${ID}.-=population`]:null});
    return;
  }
  const requested=Number(config.count ?? 1);
  const resize=!population || options.reconfigure && requested!==population.current;
  if (!population) {
    const baseHP=Number(hp.max);
    if (!(baseHP>0)) throw Error('Horde requires positive maximum HP');
    population={baseHP,baseSize:actor.system.traits.size,width:doc.width ?? 1,height:doc.height ?? 1,
      initial:requested,current:requested};
  }
  let currentHP=Number(hp.value);
  if (resize) {
    population.initial=requested;
    // Keep existing damage when changing population, rather than healing it.
    const oldMax=population.current===requested && !doc.getFlag(ID,'population') ? population.baseHP : Number(hp.max);
    currentHP=Math.max(0,population.baseHP*requested-Math.max(0,oldMax-currentHP));
  }
  population.current=livingCount(currentHP,population.baseHP,population.initial);
  const shape=hordeSize(population.current,population.baseSize);
  const max=population.baseHP*population.initial;
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
  return population;
}
export async function populationActorUpdated(actor,changes,options={}) {
  if (options.yaHordePopulation) return;
  const doc=actor.token;
  if (doc?.getFlag(ID,'population')) await syncPopulation(doc);
}
