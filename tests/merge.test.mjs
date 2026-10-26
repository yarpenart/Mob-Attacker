import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeTokens,mergePlan,mergedInitiative} from '../scripts/merge.mjs';
import {syncPopulation,ID} from '../scripts/population.mjs';
import {splitToken} from '../scripts/split.mjs';
globalThis.foundry={utils:{deepClone:structuredClone}};
function apply(object,data){for(const [path,value] of Object.entries(data)){const keys=path.split('.');let node=object;for(const k of keys.slice(0,-1))node=node[k]??={};const k=keys.at(-1);if(k.startsWith('-='))delete node[k.slice(2)];else node[k]=structuredClone(value);}}
function flags(object){return Object.assign(object,{getFlag(id,key){return this.flags?.[id]?.[key];},async setFlag(id,key,value){this.flags??={};this.flags[id]??={};this.flags[id][key]=structuredClone(value);},async unsetFlag(id,key){delete this.flags?.[id]?.[key];}});}
function fixture({linked=false,failUpdate=false,failDelete=false}={}){
 const scene={id:'s',grid:{size:100},width:3000,height:3000,tokens:new Map(),
 async deleteEmbeddedDocuments(type,ids){assert.equal(type,'Token');if(failDelete)throw Error('delete failed');for(const id of ids)this.tokens.delete(id);},
 async createEmbeddedDocuments(type,data){return data.map((d,i)=>makeToken('split'+i,d));}};
 function actor(system){return {name:'Goblin',type:'npc',system:structuredClone(system),getFlag:()=>null,
  toObject(){return {name:this.name,system:structuredClone(this.system),items:[],effects:[],flags:{}};},async update(data){apply(this,data);}};}
 function makeToken(id,data={}){
  const system=data.delta?.system??{attributes:{hp:{max:7,value:1,temp:0}},traits:{size:'sm'}};
  const token=flags({id,uuid:`Scene.s.Token.${id}`,actorId:'goblin',name:`Goblin ${id}`,parent:scene,actorLink:linked,width:1,height:1,x:500,y:500,flags:{},...structuredClone(data),actor:actor(system),
    toObject(){return {_id:this.id,actorId:this.actorId,name:this.name,actorLink:this.actorLink,width:this.width,height:this.height,x:this.x,y:this.y,flags:structuredClone(this.flags),delta:{system:structuredClone(this.actor.system)}};},
    async update(data){if(data.delta?.system)this.actor=actor(data.delta.system);apply(this,data);}});
  scene.tokens.set(id,token);return token;
 }
 const docs=[makeToken('a'),makeToken('b'),makeToken('c')];docs.forEach((d,i)=>{d.actor.system.attributes.hp.value=[1,2,4][i];d.actor.system.attributes.hp.temp=i;});
 const rows=docs.map((doc,i)=>({id:'c'+i,uuid:'Combat.x.Combatant.c'+i,tokenId:doc.id,sceneId:'s',actorId:'goblin',name:doc.name,initiative:[8,17,12][i],
  toObject(){return {_id:this.id,tokenId:this.tokenId,sceneId:this.sceneId,actorId:this.actorId,name:this.name,initiative:this.initiative};}}));
 const combat=flags({uuid:'Combat.x',round:1,started:true,turn:0,combatants:new Map(rows.map(r=>[r.id,r])),turns:[...rows],flags:{[ID]:{ledger:{schema:3,entries:[['counter',{total:1}]],turns:[{combatant:rows[0].uuid,round:1,slot:1,hits:0},{combatant:rows[1].uuid,round:1,slot:1,hits:1}]}}},
 get combatant(){return this.turns[this.turn];},async update(data){apply(this,data);},
 async updateEmbeddedDocuments(type,data){if(failUpdate)throw Error('combat update failed');for(const d of data)apply(this.combatants.get(d._id),d);},
 async deleteEmbeddedDocuments(type,ids){for(const id of ids)this.combatants.delete(id);this.turns=this.turns.filter(c=>!ids.includes(c.id));},
 async createEmbeddedDocuments(type,data){return data.map((d,i)=>{const c={...structuredClone(d),id:'new'+i,uuid:'Combat.x.Combatant.new'+i,toObject(){return {...d,_id:this.id};}};this.combatants.set(c.id,c);this.turns.push(c);return c;});}});
 globalThis.game={settings:{get:()=>undefined},combats:new Map([['x',combat]]),combat};
 return {scene,docs,combat,rows};
}
test('merge sums HP and maximum HP, keeps wounded members and uses median initiative',async()=>{
 const {docs,scene,combat}=fixture();const result=await mergeTokens(docs,{preferred:docs[2]});
 assert.equal(result.token,docs[0]);assert.equal(scene.tokens.size,1);assert.equal(result.count,3);assert.equal(result.hp,7);assert.equal(result.max,21);
 assert.equal(result.token.name,'Goblin (Horde)');assert.equal(combat.combatants.size,1);assert.equal(combat.combatant.initiative,12);
 assert.equal(combat.combatant.name,'Goblin (Horde)');assert.equal(result.token.actor.system.attributes.hp.temp,3);
 await syncPopulation(result.token);assert.equal(result.token.getFlag(ID,'horde').count,3);
 const ledger=combat.getFlag(ID,'ledger');assert.equal(ledger.entries[0][1].total,1);assert.equal(ledger.turns.length,1);assert.equal(ledger.turns[0].hits,1);
 assert.equal(result.token.getFlag(ID,'mergeOrigin').tokens.length,3);assert.equal(result.token.getFlag(ID,'mergeLock'),undefined);
});
test('merged wounds drive casualties without dropping living creatures merely because their HP is low',async()=>{
 const {docs}=fixture();const {token}=await mergeTokens(docs);token.actor.system.attributes.hp.value=6;await syncPopulation(token);
 assert.equal(token.getFlag(ID,'horde').count,2);assert.deepEqual(token.getFlag(ID,'population').members,[0,2,4]);
 token.actor.system.attributes.hp.value=21;await syncPopulation(token);assert.equal(token.getFlag(ID,'horde').count,3);
});
test('merged wounded individuals can be split again without losing count or HP',async()=>{
 const {docs,scene}=fixture();const {token}=await mergeTokens(docs);const split=await splitToken(token);
 assert.equal(split.tokens.length,3);assert.equal(scene.tokens.size,3);assert.equal(split.hp.reduce((a,b)=>a+b,0),7);
 for(const token of split.tokens){await syncPopulation(token);assert.equal(token.getFlag(ID,'horde').count,1);}
});
test('merge works outside combat, isolates linked actors, and uses the preferred token',async()=>{
 const {docs,scene}=fixture({linked:true}),world=docs[2].actor;game.combats=new Map();game.combat=null;
 const result=await mergeTokens(docs,{preferred:docs[2]});assert.equal(result.token,docs[2]);assert.equal(result.token.actorLink,false);
 assert.equal(world.system.attributes.hp.max,7);assert.equal(result.token.actor.system.attributes.hp.max,21);assert.equal(scene.tokens.size,1);
});
test('merge validation rejects mixed actor types, dead members, characters and multi-member tokens before changes',()=>{
 for(const change of [d=>d.actorId='orc',d=>d.actor.system.attributes.hp.value=0,d=>d.actor.type='character',d=>d.flags[ID]={horde:{enabled:true,count:2}}]){
  const {docs,scene}=fixture();change(docs[1]);assert.throws(()=>mergePlan(docs));assert.equal(scene.tokens.size,3);
 }
});
test('merge authority is checked before changes',async()=>{
 const {docs,scene}=fixture();await assert.rejects(mergeTokens(docs,{requireAuthority:()=>{throw Error('GM only');}}),/GM only/);assert.equal(scene.tokens.size,3);
});
test('an early merge failure leaves source tokens and original HP intact',async()=>{
 const {docs,scene}=fixture({failDelete:true});await assert.rejects(mergeTokens(docs),/delete failed/);
 assert.equal(scene.tokens.size,3);assert.equal(docs[0].actor.system.attributes.hp.max,7);assert.equal(docs[0].actor.system.attributes.hp.value,1);
 assert.equal(docs[0].getFlag(ID,'population'),undefined);assert.equal(docs[0].getFlag(ID,'mergeLock'),undefined);
});
test('the retained combatant cannot gain a free attack slot by merging',async()=>{
 const {reserveTurn}=await import('../scripts/logic.mjs');const {docs,combat}=fixture();await mergeTokens(docs);
 assert.throws(()=>reserveTurn(combat.getFlag(ID,'ledger'),{combatant:combat.combatant.uuid,round:1,target:'target',group:'Goblin',limit:1}),/TURN_SPENT/);
});

 test('initiative selection handles odd/even medians, fractions, zero, negatives and unrolled entries',()=>{
 assert.equal(mergedInitiative([17,8,12]),12);assert.equal(mergedInitiative([20,8,17,12]),14.5);
 assert.equal(mergedInitiative([null,undefined,NaN,Infinity]),null);assert.equal(mergedInitiative([null,0,-2]),-1);
 assert.equal(mergedInitiative([8,17,12],'highest'),17);assert.equal(mergedInitiative([8,17,12],'lowest'),8);
 assert.equal(mergedInitiative([7,7,7]),7);assert.throws(()=>mergedInitiative([1],'invalid'));
 });
 test('merging honors the world initiative setting in every selection mode',async()=>{
 for(const [mode,expected] of [['highest',17],['median',12],['lowest',8]]){
 const {docs,combat}=fixture();game.settings.get=(id,key)=>key==='mergeInitiative'?mode:undefined;
 await mergeTokens(docs);assert.equal(combat.combatant.initiative,expected);
 }
 });
 test('unrolled creatures are excluded and an entirely unrolled merge remains unrolled',async()=>{
 let context=fixture();context.rows[0].initiative=null;context.rows[1].initiative=undefined;context.rows[2].initiative=9;
 await mergeTokens(context.docs);assert.equal(context.combat.combatant.initiative,9);
 context=fixture();for(const row of context.rows)row.initiative=null;
 await mergeTokens(context.docs);assert.equal(context.combat.combatant.initiative,null);
 });
 test('initiative reordering preserves the active combatant outside the merged selection',async()=>{
 const {docs,combat}=fixture();const outsider={id:'outside',tokenId:'other',initiative:15};combat.turns.unshift(outsider);combat.combatants.set(outsider.id,outsider);
 const update=combat.updateEmbeddedDocuments.bind(combat);
 combat.updateEmbeddedDocuments=async(...args)=>{await update(...args);combat.turns.sort((a,b)=>b.initiative-a.initiative);};
 await mergeTokens(docs);assert.equal(combat.combatant.id,'outside');assert.equal(combat.combatants.size,2);
 assert.equal([...combat.combatants.values()].find(c=>c.id!=='outside').initiative,12);
 });
