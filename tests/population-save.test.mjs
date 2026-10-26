import {memoryScope} from '../scripts/combat-memory.mjs';
import {test,beforeEach} from 'node:test';
import {mockSettings} from './test-settings.mjs';
beforeEach(()=>{globalThis.game={settings:mockSettings({hordeNaming:'plain'})};});
import assert from 'node:assert/strict';
import {updateMembers,livingCount,hordeSize,syncPopulation,syncHordeName,ID} from '../scripts/population.mjs';
import {saveCount,saveDamage,installSaves} from '../scripts/saves.mjs';
globalThis.foundry={utils:{deepClone:structuredClone}};
function update(target,data) {
 for (const [key,value] of Object.entries(data)) {
  const path=key.split('.');let node=target;
  for (const k of path.slice(0,-1)) node=node[k]??={};
  const k=path.at(-1);if(k.startsWith('-=')) delete node[k.slice(2)];else node[k]=structuredClone(value);
 }
}
function token(count=8,linked=false) {
 const actor={system:{attributes:{hp:{max:7,value:7,temp:0}},traits:{size:'sm'}},getFlag:()=>null,
  async update(data){update(this,data);},toObject(){return {system:structuredClone(this.system)};},getRollData:()=>({})};
 const doc={uuid:'Scene.x.Token.goblin',actor,actorLink:linked,width:1,height:1,flags:{[ID]:{horde:{enabled:true,count,group:'Goblins'}}},
  getFlag(id,key){return this.flags[id]?.[key];},async update(data){
   if(data.actorLink===false && this.actorLink) this.actor={...actor,system:structuredClone(data.delta.system)};
   update(this,data);
  }};actor.token=doc;
 return doc;
}
test('population scales HP once, tracks casualties and retains initial count on reload and healing',async()=>{
 const doc=token();await syncPopulation(doc);
 assert.equal(doc.actor.system.attributes.hp.max,56);assert.equal(doc.actor.system.attributes.hp.value,56);
 assert.equal(doc.getFlag(ID,'population').initial,8);assert.equal(doc.width,3);assert.equal(doc.actor.system.traits.size,'huge');
 await syncPopulation(doc);assert.equal(doc.actor.system.attributes.hp.max,56);
 doc.actor.system.attributes.hp.value=50;await syncPopulation(doc);assert.equal(doc.getFlag(ID,'horde').count,8);
 doc.actor.system.attributes.hp.value=49;await syncPopulation(doc);assert.equal(doc.getFlag(ID,'horde').count,7);
 doc.actor.system.attributes.hp.value=35;await syncPopulation(doc);assert.equal(doc.getFlag(ID,'horde').count,5);assert.equal(doc.width,2);
 assert.equal(doc.getFlag(ID,'population').initial,8);assert.equal(doc.actor.system.attributes.hp.max,56);
 doc.actor.system.attributes.hp.value=0;await syncPopulation(doc);assert.equal(doc.getFlag(ID,'horde').count,0);
 doc.actor.system.attributes.hp.value=56;await syncPopulation(doc);assert.equal(doc.getFlag(ID,'horde').count,8);
});
test('linked token becomes independent before changing HP; disabling restores creature stats',async()=>{
 const doc=token(8,true),world=doc.actor;await syncPopulation(doc);
 assert.equal(world.system.attributes.hp.max,7);assert.equal(doc.actor.system.attributes.hp.max,56);assert.equal(doc.actorLink,false);
 doc.flags[ID].horde.enabled=false;await syncPopulation(doc);
 assert.equal(doc.actor.system.attributes.hp.max,7);assert.equal(doc.width,1);assert.equal(doc.actor.system.traits.size,'sm');
 assert.equal(doc.getFlag(ID,'population'),undefined);
});
test('changing count deliberately recalculates max without compounding or discarding damage',async()=>{
 const doc=token();await syncPopulation(doc);doc.actor.system.attributes.hp.value=49;await syncPopulation(doc);
 doc.flags[ID].horde.count=10;await syncPopulation(doc,{reconfigure:true});
 assert.equal(doc.actor.system.attributes.hp.max,70);assert.equal(doc.actor.system.attributes.hp.value,63);
 assert.equal(doc.getFlag(ID,'population').initial,10);assert.equal(doc.getFlag(ID,'horde').count,9);
});
test('small and medium hordes use all requested footprint thresholds',()=>{
 for(const base of ['sm','med']) for(const [count,size,width] of [[2,'med',1],[3,'lg',2],[5,'lg',2],[6,'huge',3],[9,'huge',3],[10,'grg',4],[20,'grg',4]]) assert.deepEqual(hordeSize(count,base),{size,width});
 assert.deepEqual(hordeSize(1,'sm'),{size:'sm',width:1});assert.deepEqual(hordeSize(1,'med'),{size:'med',width:1});
 assert.equal(livingCount(50,7,8),8);assert.equal(livingCount(49,7,8),7);
});
test('save successes use the attack table, support forced counts and shared partial progress',()=>{
 assert.deepEqual(saveCount(14,4,8),{count:8,successes:4,failures:4,threshold:2,required:10});
 assert.equal(saveCount(14,4,8,7).successes,7);assert.equal(saveCount(14,4,8,0).failures,8);
 assert.equal(saveCount(14,4,1,null,1).successes,1);assert.equal(saveCount(25,4,20).successes,1);
});
test('Fireball divides damage between saved and failed creatures, per-creature resistance rounding',()=>{
 const actor={calculateDamage:(parts,{multiplier=1}={})=>({amount:Math.trunc(parts.reduce((n,p)=>n+p.value*multiplier,0))})};
 const result=saveCount(14,4,8);assert.deepEqual(saveDamage(actor,[{value:27,type:'fire'}],result,'half'),{failed:27,passed:13,total:160});
 assert.equal(saveDamage(actor,[{value:27}],result,'none').total,108);
 const resistant={calculateDamage:(parts,{multiplier=1}={})=>({amount:parts.reduce((n,p)=>n+Math.floor(p.value*multiplier/2),0)})};
 assert.deepEqual(saveDamage(resistant,[{value:27,type:'fire'}],result,'half'),{failed:13,passed:6,total:76});
});
function saveFixture() {
 const doc=token(8),messages=[];
 const message=(id='m'+messages.length)=>({id,flags:{},content:'',getFlag(id,key){return this.flags[id]?.[key];},async setFlag(id,key,data){this.flags[id]??={};this.flags[id][key]=structuredClone(data);},async update(data){update(this,data);}});
 const origin=message('spell');origin.getAssociatedActivity=()=>({uuid:'Actor.wizard.Item.fireball.Activity.save'});messages.push(origin);
 globalThis.game={settings:mockSettings({hordeNaming:'plain'}),user:{isGM:true},combat:null,messages:{contents:messages,get:id=>messages.find(m=>m.id===id)}};
 globalThis.canvas={scene:origin};globalThis.fromUuid=async()=>doc;
 globalThis.Roll=class {constructor(formula){this.formula=formula;}async evaluate(){this.total=Number(this.formula);return this;}};
 doc.actor.calculateDamage=(parts,{multiplier=1}={})=>({amount:Math.trunc(parts.reduce((sum,p)=>sum+p.value*multiplier,0))});
 doc.actor.applyDamage=async function(n){this.system.attributes.hp.value=Math.max(0,this.system.attributes.hp.value-n);};
 const api=installSaves({t:(key,v)=>key+JSON.stringify(v??{}),esc:String,card:async(a,text)=>{const m=message();m.content=text;messages.push(m);return m;},
 requireAuthority:()=>{if(!game.user.isGM)throw Error('GM only');},settings:d=>d.getFlag(ID,'horde'),sourceFor:a=>a.token});
 return {doc,origin,messages,api};
}
test('save damage applies once with a durable message lock and updates casualties',async()=>{
 const {doc,api}=saveFixture();
 const {message,result}=await api.resolveSave({doc,actor:doc.actor,options:{dc:14,bonus:'4',ability:'dex',damage:'4',damageType:'fire',onSave:'half'}});
 assert.equal(result.successes,4);assert.equal(doc.actor.system.attributes.hp.value,56);
 await api.apply(message);assert.equal(doc.actor.system.attributes.hp.value,32);
 assert.equal(doc.getFlag(ID,'horde').count,5);assert.equal(message.getFlag(ID,'save').status,'applied');
 await assert.rejects(api.apply(message));assert.equal(doc.actor.system.attributes.hp.value,32);
});
test('native spell damage rolled after saves attaches to the pending GM result',async()=>{
 const {doc,origin,api}=saveFixture();
 const {message}=await api.resolveSave({doc,actor:doc.actor,options:{dc:14,bonus:'4',ability:'dex',source:origin.id,activity:'spellActivity',onSave:'half'}});
 assert.equal(message.getFlag(ID,'save').parts,undefined);
 const event={target:{closest:()=>({dataset:{messageId:origin.id}})}};
 const rolls=[{total:4,options:{type:'fire'}}];
 assert.equal(await api.interceptSaveDamage.call({uuid:'spellActivity'},async()=>rolls,{event}),rolls);
 assert.equal(message.getFlag(ID,'save').damage.total,24);
 await api.apply(message);assert.equal(doc.actor.system.attributes.hp.value,32);
});
test('damage rolled before saves is reused; a changed HP snapshot blocks stale applications',async()=>{
 const {doc,origin,api}=saveFixture();await origin.setFlag(ID,'saveDamage',{parts:[{value:4,type:'fire'}],scope:memoryScope()});
 const {message}=await api.resolveSave({doc,actor:doc.actor,options:{dc:14,bonus:'4',ability:'dex',source:origin.id,onSave:'half'}});
 assert.equal(message.getFlag(ID,'save').damage.total,24);
 doc.actor.system.attributes.hp.value=55;await assert.rejects(api.apply(message));assert.equal(doc.actor.system.attributes.hp.value,55);
});
test('separate single-creature tokens share saving progress for one spell occurrence',async()=>{
 const {doc,origin,api}=saveFixture();doc.flags[ID].horde.count=1;
 const opts={dc:14,bonus:'4',ability:'dex',source:origin.id,onSave:'half'};
 const first=await api.resolveSave({doc,actor:doc.actor,options:opts});assert.equal(first.result.successes,0);
 const other=token(1);other.uuid='Scene.x.Token.second';const second=await api.resolveSave({doc:other,actor:other.actor,options:opts});assert.equal(second.result.successes,1);
});
test('unmarked and player saves retain native rolls while Horde saves require GM authority',async()=>{
 const {doc,api}=saveFixture();let called=0;
 await api.interceptSave.call({type:'character'},async()=>{called++;});
 doc.flags[ID].horde.enabled=false;doc.actor.type='npc';await api.interceptSave.call(doc.actor,async()=>{called++;});assert.equal(called,2);
 game.user.isGM=false;await assert.rejects(api.resolveSave({doc,actor:doc.actor,options:{dc:14,bonus:'4',ability:'dex'}}));
});
test('repeated saves for a spell are blocked; forced mode replaces only an unapplied result',async()=>{
 const {doc,origin,api}=saveFixture();const options={dc:14,bonus:'4',ability:'dex',source:origin.id,onSave:'half',damage:'4',damageType:'fire'};
 const first=await api.resolveSave({doc,actor:doc.actor,options});
 await assert.rejects(api.resolveSave({doc,actor:doc.actor,options}));
 const forced=await api.resolveSave({doc,actor:doc.actor,options:{...options,forced:8}});
 assert.equal(first.message.getFlag(ID,'save').status,'superseded');assert.equal(forced.result.successes,8);
 await assert.rejects(api.apply(first.message));await api.apply(forced.message);
 await assert.rejects(api.resolveSave({doc,actor:doc.actor,options:{...options,forced:8}}));
});

 test('population names gain one Horde suffix, then lose it after casualties, healing and disabling',async()=>{
 const doc=token(8);doc.actor.name='Goblin';doc.name='Goblin';
 await syncPopulation(doc);assert.equal(doc.name,'Goblin (Horde)');
 await syncPopulation(doc);assert.equal(doc.name,'Goblin (Horde)');assert.equal(doc.actor.name,'Goblin');
 doc.actor.system.attributes.hp.value=7;await syncPopulation(doc);assert.equal(doc.name,'Goblin');
 doc.actor.system.attributes.hp.value=14;await syncPopulation(doc);assert.equal(doc.name,'Goblin (Horde)');
 doc.flags[ID].horde.enabled=false;await syncPopulation(doc);assert.equal(doc.name,'Goblin');
 });
 test('initiative names follow their token, including explicit names, without renaming other scenes',async()=>{
 const doc=token(8);doc.id='goblin';doc.parent={id:'x'};doc.actor.name='Goblin';doc.name='Custom token';
 const rows=new Map([['a',{id:'a',tokenId:doc.id,sceneId:'x',name:'Custom initiative'}],['b',{id:'b',tokenId:doc.id,sceneId:'other',name:'Different scene'}]]);
 const combat={combatants:rows,async updateEmbeddedDocuments(type,updates){assert.equal(type,'Combatant');for(const data of updates)Object.assign(rows.get(data._id),data);}};
 const original=globalThis.game;globalThis.game={settings:mockSettings({hordeNaming:'plain'}),combats:new Map([['combat',combat]])};
 try {await syncPopulation(doc);assert.equal(doc.name,'Goblin (Horde)');assert.equal(rows.get('a').name,'Goblin (Horde)');assert.equal(rows.get('b').name,'Different scene');
 rows.get('a').name='Late initiative entry';await syncHordeName(doc,8);assert.equal(rows.get('a').name,'Goblin (Horde)');
 doc.actor.system.attributes.hp.value=7;await syncPopulation(doc);assert.equal(doc.name,'Custom token');assert.equal(rows.get('a').name,'Custom token');
 } finally {globalThis.game=original;}
 });
test('rolled Horde maxima sum individual native HP formulas and are not rerolled on HP updates',async()=>{
 const originalRoll=globalThis.Roll;let calls=0;
 game.settings.values.set('hordeHPMode','rolled');
 globalThis.Roll=class {constructor(formula){assert.equal(formula,'2d6');}async evaluate(){this.total=[3,8,5][calls++];return this;}};
 try {
 const doc=token(3);doc.actor.system.attributes.hp.formula='2d6';await syncPopulation(doc);
 assert.equal(doc.actor.system.attributes.hp.max,16);assert.equal(doc.actor.system.attributes.hp.value,16);assert.equal(doc.getFlag(ID,'horde').count,3);
 assert.deepEqual(doc.getFlag(ID,'population').maxima,[3,8,5]);
 doc.actor.system.attributes.hp.value=12;await syncPopulation(doc);assert.equal(doc.getFlag(ID,'horde').count,2);assert.equal(calls,3);
 doc.actor.system.attributes.hp.value=16;await syncPopulation(doc);assert.equal(doc.getFlag(ID,'horde').count,3);assert.equal(calls,3);
 } finally {globalThis.Roll=originalRoll;}
});
test('explicitly rerolling an existing Horde preserves damage and uses a custom formula',async()=>{
 const originalRoll=globalThis.Roll;const doc=token(2);await syncPopulation(doc);doc.actor.system.attributes.hp.value=11;
 game.settings.values.set('hordeHPFormula','3d6+2');globalThis.Roll=class{constructor(formula){assert.equal(formula,'3d6+2');}async evaluate(){this.total=10;return this;}};
 try {await syncPopulation(doc,{rerollHP:true});assert.equal(doc.actor.system.attributes.hp.max,20);assert.equal(doc.actor.system.attributes.hp.value,17);}
 finally {globalThis.Roll=originalRoll;}
});

test('damage drains the lowest current HP first regardless of member order or maximum HP',()=>{
 assert.deepEqual(updateMembers([8,2,5],9,[10,4,9]),[8,0,1]);
 assert.deepEqual(updateMembers([8,2,5],12,[10,4,9]),[8,0,4]);
 assert.deepEqual(updateMembers([8,2,5],0,[10,4,9]),[0,0,0]);
});
test('rolled-to-statblock reconfiguration stays stable under recursive Foundry flag updates',async()=>{
 const {recursiveUpdate}=await import('./document-update.mjs');const doc=token(2);doc.actor.system.attributes.hp.formula='2d6';doc.update=async data=>recursiveUpdate(doc,data);
 game.settings=mockSettings({hordeNaming:'plain',hordeHPMode:'rolled'});let rolls=0;globalThis.Roll=class{async evaluate(){this.total=[3,11][rolls++];return this;}};
 await syncPopulation(doc);game.settings.values.set('hordeHPMode','max');
 await syncPopulation(doc,{config:{enabled:true,count:3},reconfigure:true});assert.equal(doc.actor.system.attributes.hp.max,21);
 await syncPopulation(doc);assert.equal(doc.actor.system.attributes.hp.max,21);assert.deepEqual(doc.getFlag(ID,'population').maxima,[7,7,7]);
});
test('a former rolled singleton uses the original statblock HP when becoming an average-HP Horde',async()=>{
 const doc=token(1);doc.baseActor={system:{attributes:{hp:{max:7}}}};doc.actor.system.attributes.hp={max:3,value:3};
 doc.flags[ID].population={baseHP:3,baseName:'Goblin',baseSize:'sm',initial:1,current:1,members:[3],maxima:[3],width:1,height:1};
 await syncPopulation(doc,{config:{enabled:true,count:8},reconfigure:true});assert.equal(doc.actor.system.attributes.hp.max,56);assert.equal(doc.actor.system.attributes.hp.value,56);
});
test('a native spell damage dialog completed in another scope cannot attach to the new encounter',async()=>{
 const {api,origin}=saveFixture();const event={target:{closest:()=>({dataset:{messageId:origin.id}})}};
 const rolls=[{total:4,options:{type:'fire'}}];
 await api.interceptSaveDamage.call({uuid:'spell'},async()=>{canvas.scene={uuid:'Scene.another'};return rolls;},{event});
 assert.equal(origin.getFlag(ID,'saveDamage'),undefined);
});
test('a save card cannot damage replacement members with the same count and HP',async()=>{
 const {doc,api}=saveFixture();doc.flags[ID].battle={ids:Array.from({length:8},(_,i)=>'before'+i)};
 const {message}=await api.resolveSave({doc,actor:doc.actor,options:{dc:14,bonus:'4',ability:'dex',damage:'4',damageType:'fire'}});
 doc.flags[ID].battle.ids=Array.from({length:8},(_,i)=>'after'+i);
 await assert.rejects(api.apply(message),/saveStale/);assert.equal(doc.actor.system.attributes.hp.value,56);
});
test('an expired save form is rejected before changing token HP or writing results',async()=>{
 const {doc,api,messages}=saveFixture();const hp=doc.actor.system.attributes.hp.value;
 await assert.rejects(api.resolveSave({doc,actor:doc.actor,options:{expectedScope:'a different encounter',dc:14,bonus:'4',ability:'dex',damage:'4'}}),/saveStale/);
 assert.equal(doc.actor.system.attributes.hp.value,hp);assert.equal(messages.length,1);assert.equal(doc.getFlag(ID,'population'),undefined);
});
