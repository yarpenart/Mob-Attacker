import {serialQueue} from './logic.mjs';
const ID='yarpenart-mob-attacker',enqueue=serialQueue();
export const NAMING_DEFAULTS={splitNaming:'continuous',splitNamePattern:'{adjective} {name} {horde}.{member}',splitAdjectives:false,
  hordeNaming:'number',hordeNamePattern:'{adjective} {name} {horde} (Horde)',hordeAdjectives:false,namingAdjectives:''};
const words={en:['Angry','Bold','Cunning','Fierce','Grim','Restless','Wild','Wary','Swift','Stubborn','Scarred','Silent','Ruthless','Lucky','Loud','Crafty'],
  pl:['Gniewny','Śmiały','Przebiegły','Zaciekły','Ponury','Niespokojny','Dziki','Czujny','Szybki','Uparty','Bliznowaty','Cichy','Bezwzględny','Szczęśliwy','Hałaśliwy','Sprytny']};
export function namingOptions(){
  const result={};for(const [key,value] of Object.entries(NAMING_DEFAULTS)){
    const stored=game.settings.get(ID,key);result[key]=typeof stored===typeof value?stored:value;
  }return result;
}
export function formatName(pattern,values){
  return pattern.replace(/\{(name|horde|member|number|adjective)\}/g,(_,key)=>String(values[key]??'')).replace(/\s+/g,' ').trim();
}
export function adjective(options=namingOptions(),random=Math.random){
  const configured=options.namingAdjectives.split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean);
  const list=configured.length?configured:words[game.settings.get(ID,'language')==='pl'?'pl':'en'];
  return list[Math.min(list.length-1,Math.floor(random()*list.length))];
}
const keyFor=(doc,base)=>String(doc.baseActor?.id??doc.actorId??base).toLowerCase();
function documents(doc){return Array.from(doc.parent?.tokens?.values?.()??[]);}
const positive=value=>Number.isSafeInteger(value)&&value>0;
function isHorde(token){
 const pop=token.getFlag(ID,'population'),config=token.getFlag(ID,'horde');
 return config?.enabled ? Number(pop?.current??config.count??1)>1 : /\(Horde\)$/i.test(token.name??'');
}
function sameCreature(token,key,base){return keyFor(token,base)===key;}
function usedNumbers(doc,base,kind){
 const key=keyFor(doc,base),used=new Set();
 const escaped=base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(const token of documents(doc)){
  if(token.id===doc.id||!sameCreature(token,key,base))continue;
  const n=token.getFlag(ID,'naming');
  if(kind==='horde'){
   if(isHorde(token)&&positive(n?.horde))used.add(n.horde);
   const match=String(token.name??'').match(new RegExp('^'+escaped+' (\\d+) \\(Horde\\)$'));
   if(isHorde(token)&&match)used.add(Number(match[1]));
   // Group.member mode needs a distinct split group even after the Horde disappears.
   if(namingOptions().splitNaming==='horde'&&n?.member&&positive(n.horde))used.add(n.horde);
  }else if(!isHorde(token)){
   if(positive(n?.number))used.add(n.number);
   const match=String(token.name??'').match(new RegExp('^'+escaped+' (\\d+)$'));
   if(match)used.add(Number(match[1]));
  }
  // In-flight split reservations belong to this scene and are released on completion.
  if(kind==='number')for(const number of n?.reservedNumbers??[])if(positive(number))used.add(number);
 }
 return used;
}
function nextFree(used){let value=1;while(used.has(value))value++;used.add(value);return value;}
/** Allocate from live scene tokens, never from historical world counters. */
async function reserve(doc,base,{members=0,newHorde=false}={}){
 return enqueue(async()=>{
  const key=keyFor(doc,base),old=doc.getFlag(ID,'naming'),used=usedNumbers(doc,base,'horde');
  const keep=!newHorde&&!old?.member&&old?.sceneVersion===2&&old.sceneId===(doc.parent?.id??null)&&positive(old?.horde)&&!used.has(old.horde);
  const horde=keep?old.horde:nextFree(used),numbers=[],occupied=usedNumbers(doc,base,'number');
  for(let i=0;i<members;i++)numbers.push(nextFree(occupied));
  const identity={key,horde,adjective:old?.adjective??adjective(),sceneVersion:2,sceneId:doc.parent?.id??null};
  if(members)identity.reservedNumbers=numbers;
  // Foundry recursively merges flag objects: explicitly remove prior member metadata.
  if(old)await doc.unsetFlag(ID,'naming');
  await doc.setFlag(ID,'naming',identity);
  return {identity,numbers};
 });
}
export async function hordeLabel(doc,base){
 const options=namingOptions();
 if(options.hordeNaming==='plain'&&!options.hordeAdjectives)return `${base} (Horde)`;
 let identity=doc.getFlag(ID,'naming');
 if(!identity?.horde||identity.member||identity.sceneVersion!==2||identity.sceneId!==(doc.parent?.id??null)||usedNumbers(doc,base,'horde').has(identity.horde))({identity}=await reserve(doc,base));
 const adj=options.hordeAdjectives||options.hordeNaming==='adjective'||options.hordeNaming==='custom'?identity.adjective:'';
 const pattern=options.hordeNaming==='custom'?options.hordeNamePattern:options.hordeNaming==='number'?'{adjective} {name} {horde} (Horde)':'{adjective} {name} (Horde)';
 let name=formatName(pattern,{name:base,horde:identity.horde,adjective:adj});
 if(!name.endsWith('(Horde)'))name+=' (Horde)';
 if(documents(doc).some(token=>token.id!==doc.id&&token.name===name))name=name.replace(/\s*\(Horde\)$/,'')+` ${identity.horde} (Horde)`;
 return name;
}
export async function splitNames(doc,base,count){
 const options=namingOptions(),{identity,numbers}=await reserve(doc,base,{members:count});
 const taken=new Set(documents(doc).filter(t=>t.id!==doc.id).map(t=>t.name));
 const pattern=options.splitNaming==='custom'?options.splitNamePattern:options.splitNaming==='continuous'?'{adjective} {name} {number}':'{adjective} {name} {horde}.{member}';
 return Array.from({length:count},(_,index)=>{
   const meta={...identity,member:index+1,number:numbers[index],adjective:adjective(options)};delete meta.reservedNumbers;
   const values={...meta,name:base,adjective:options.splitAdjectives||options.splitNaming==='custom'?meta.adjective:''};
   const requested=formatName(pattern,values)||`${base} ${identity.horde}.${index+1}`;
   let name=requested,suffix=2;while(taken.has(name))name=`${requested} ${suffix++}`;taken.add(name);
   return {name,meta};
 });
}
/** After merging, a future split is a new group, not a reuse of a member's old group number. */
export async function assignMergedName(doc,base){
 const {identity}=await reserve(doc,base,{newHorde:true});
 return {name:await hordeLabel(doc,base),identity};
}
export async function refreshNaming(){
 for(const scene of game.scenes.values())for(const token of scene.tokens.values()){
  const pop=token.getFlag(ID,'population'),enabled=token.getFlag(ID,'horde')?.enabled;
  if(enabled&&pop?.current>1){const name=await hordeLabel(token,pop.baseName??token.actor.name);if(token.name!==name)await token.update({name});
    for(const combat of game.combats.values()){
      const updates=Array.from(combat.combatants.values()).filter(c=>c.tokenId===token.id&&(!c.sceneId||c.sceneId===scene.id)&&c.name!==name).map(c=>({_id:c.id,name}));
      if(updates.length)await combat.updateEmbeddedDocuments('Combatant',updates);
    }
  }
 }
}

/** One-time upgrade: use map numbering while retaining custom/adjective choices. */
export async function migrateSceneNames(){
 if(game.settings.get(ID,'sceneNamingVersion')===2)return;
 if(game.settings.get(ID,'splitNaming')==='horde')await game.settings.set(ID,'splitNaming','continuous');
 if(game.settings.get(ID,'hordeNaming')==='plain')await game.settings.set(ID,'hordeNaming','number');
 for(const scene of game.scenes.values()){
  const hordes=Array.from(scene.tokens.values()).filter(isHorde);
  for(const token of hordes){const old=token.getFlag(ID,'naming')??{};await token.setFlag(ID,'naming',{...old,horde:0});}
  for(const token of hordes){const pop=token.getFlag(ID,'population');await reserve(token,pop?.baseName??token.baseActor?.name??token.actor?.name??token.name,{newHorde:true});}
 }
 await refreshNaming();
 await game.settings.set(ID,'sceneNamingVersion',2);
}
