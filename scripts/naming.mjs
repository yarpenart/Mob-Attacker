import {serialQueue} from './logic.mjs';
const ID='yarpenart-mob-attacker',enqueue=serialQueue();
export const NAMING_DEFAULTS={splitNaming:'horde',splitNamePattern:'{adjective} {name} {horde}.{member}',splitAdjectives:false,
  hordeNaming:'plain',hordeNamePattern:'{adjective} {name} {horde} (Horde)',hordeAdjectives:false,namingAdjectives:''};
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
function identityExists(doc,horde,key){return documents(doc).some(t=>{const n=t.getFlag(ID,'naming');return n?.key===key&&n.horde===horde;});}
/** Persist monotonic world counters; UUIDs/base IDs remain values inside arrays. */
async function reserve(doc,base,{members=0,newHorde=false}={}){
 return enqueue(async()=>{
  const key=keyFor(doc,base),old=doc.getFlag(ID,'naming');
  const raw=game.settings.get(ID,'namingCounters'),entries=Array.isArray(raw?.entries)?foundry.utils.deepClone(raw.entries):[];
  const record=entries.find(entry=>entry.key===key)??{key,horde:0,number:0};if(!entries.includes(record))entries.push(record);
  for(const token of documents(doc)){
    const n=token.getFlag(ID,'naming');if(n?.key===key){record.horde=Math.max(record.horde,n.horde??0);record.number=Math.max(record.number,n.number??0);}
    const match=String(token.name??'').match(new RegExp('^'+base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' (\\d+)$'));
    if(match)record.number=Math.max(record.number,Number(match[1]));
  }
  const needs=newHorde||!old?.horde||old.member;
  let horde=needs?record.horde+1:old.horde;
  if(needs)while(identityExists(doc,horde,key))horde++;
  record.horde=Math.max(record.horde,horde);
  const start=record.number+1;record.number+=members;
  const identity=needs?{key,horde}: {...old,key,horde};delete identity.member;delete identity.number;
  identity.adjective??=adjective();
  await game.settings.set(ID,'namingCounters',{entries});
  await doc.setFlag(ID,'naming',identity);
  return {identity,start};
 });
}
export async function hordeLabel(doc,base){
 const options=namingOptions();
 if(options.hordeNaming==='plain'&&!options.hordeAdjectives)return `${base} (Horde)`;
 let identity=doc.getFlag(ID,'naming');
 if(!identity?.horde||identity.member)({identity}=await reserve(doc,base));
 const adj=options.hordeAdjectives||options.hordeNaming==='adjective'||options.hordeNaming==='custom'?identity.adjective:'';
 const pattern=options.hordeNaming==='custom'?options.hordeNamePattern:options.hordeNaming==='number'?'{adjective} {name} {horde} (Horde)':'{adjective} {name} (Horde)';
 let name=formatName(pattern,{name:base,horde:identity.horde,adjective:adj});
 if(!name.endsWith('(Horde)'))name+=' (Horde)';
 if(documents(doc).some(token=>token.id!==doc.id&&token.name===name))name=name.replace(/\s*\(Horde\)$/,'')+` ${identity.horde} (Horde)`;
 return name;
}
export async function splitNames(doc,base,count){
 const options=namingOptions(),{identity,start}=await reserve(doc,base,{members:count});
 const taken=new Set(documents(doc).filter(t=>t.id!==doc.id).map(t=>t.name));
 const pattern=options.splitNaming==='custom'?options.splitNamePattern:options.splitNaming==='continuous'?'{adjective} {name} {number}':'{adjective} {name} {horde}.{member}';
 return Array.from({length:count},(_,index)=>{
   const meta={...identity,member:index+1,number:start+index,adjective:adjective(options)};
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
