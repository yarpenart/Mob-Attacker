import {test} from 'node:test';
import assert from 'node:assert/strict';
import {distributeHP,splitToken,splitPositions} from '../scripts/split.mjs';
import {hordeSize,ID} from '../scripts/population.mjs';
globalThis.foundry={utils:{deepClone:structuredClone}};
function apply(doc,data){for(const [key,value] of Object.entries(data)){const path=key.split('.');let node=doc;for(const k of path.slice(0,-1))node=node[k]??={};const last=path.at(-1);if(last.startsWith('-='))delete node[last.slice(2)];else node[last]=structuredClone(value);}}
function flagMethods(doc){return Object.assign(doc,{getFlag(id,key){return this.flags?.[id]?.[key];},async setFlag(id,key,v){this.flags??={};this.flags[id]??={};this.flags[id][key]=structuredClone(v);},async unsetFlag(id,key){delete this.flags?.[id]?.[key];},async update(data){apply(this,data);},toObject(){const {actor,parent,combatants,turns,...data}=this;return Object.fromEntries(Object.entries(data).filter(([k,v])=>typeof v!=='function'));}});}
function fixture({count=8,hp=50,failCombat=false}={}){
 const actor={system:{attributes:{hp:{max:56,value:hp,temp:3}},traits:{size:'huge'}},getFlag:()=>null,
  async update(data){apply(this,data);},toObject(){return {name:'Goblin',system:structuredClone(this.system),items:[{_id:'weapon',name:'Scimitar'}],effects:[],flags:{}};}};
 const scene={id:'scene',width:4000,height:4000,grid:{size:100},tokens:new Map(),
  async createEmbeddedDocuments(type,data){assert.equal(type,'Token');return data.map((d,i)=>{const token=flagMethods({...structuredClone(d),id:'copy'+i,uuid:'Scene.scene.Token.copy'+i,parent:this});token.actor={system:structuredClone(d.delta.system)};this.tokens.set(token.id,token);return token;});},
  async deleteEmbeddedDocuments(type,ids){for(const id of ids)this.tokens.delete(id);}};
 const token=flagMethods({id:'original',uuid:'Scene.scene.Token.original',name:'Goblin Horde',parent:scene,actor,actorId:'goblin',actorLink:false,x:1000,y:1000,width:3,height:3,
  flags:{[ID]:{horde:{enabled:true,count,attackLimit:2,group:'Goblins'},population:{baseHP:7,baseSize:'sm',width:1,height:1,initial:8,current:count}}}});
 scene.tokens.set(token.id,token);
 const original=flagMethods({id:'c0',uuid:'Combat.combat.Combatant.c0',actorId:'goblin',tokenId:token.id,sceneId:scene.id,initiative:17,hidden:false});
 const combat=flagMethods({id:'combat',started:true,turn:0,round:2,combatants:new Map([['c0',original]]),turns:[original],combatant:original,
  flags:{[ID]:{ledger:{schema:3,scope:'Combat.combat',entries:[['progress',{total:1}]],turns:[{combatant:original.uuid,round:2,slot:1,hits:0,group:'Goblins',target:'target'}]}}},
  async createEmbeddedDocuments(type,data){if(failCombat)throw Error('combat failed');return data.map((d,i)=>{assert.equal(d.initiative,17);const c={...d,id:'new'+i,uuid:'Combat.combat.Combatant.new'+i};this.combatants.set(c.id,c);this.turns.push(c);return c;});},
  async deleteEmbeddedDocuments(type,ids){for(const id of ids)this.combatants.delete(id);this.turns=this.turns.filter(c=>!ids.includes(c.id));}});
 globalThis.game={settings:{get:()=>undefined},combats:new Map([['combat',combat]]),combat};
 return {token,scene,combat,actor};
}
test('equal and random splits preserve HP and stay within one-creature limits',()=>{
 assert.deepEqual(distributeHP(50,8,7),[7,7,6,6,6,6,6,6]);
 for(let max=1;max<=15;max++)for(let count=1;count<=12;count++)for(const total of [count,count*max,Math.ceil(count*(max+1)/2)]){
  const hp=distributeHP(total,count,max,'random');assert.equal(hp.reduce((a,b)=>a+b,0),total);assert.ok(hp.every(n=>n>=1&&n<=max));
 }
});
test('independent Small, Medium and Large size thresholds can be customized',()=>{
 const settings={size_sm_med:4,size_sm_lg:7,size_sm_huge:12,size_sm_grg:20,size_med_lg:5,size_med_huge:10,size_med_grg:15,size_lg_huge:2,size_lg_grg:4};
 globalThis.game={settings:{get:(id,key)=>settings[key]}};
 assert.equal(hordeSize(3,'sm').size,'sm');assert.equal(hordeSize(4,'sm').size,'med');assert.equal(hordeSize(7,'sm').size,'lg');
 assert.equal(hordeSize(10,'med').size,'huge');assert.equal(hordeSize(2,'lg').size,'huge');assert.equal(hordeSize(4,'lg').size,'grg');
 settings.size_sm_lg=3;assert.throws(()=>hordeSize(7,'sm'),/thresholds/);
});
test('split retains original identity, gives every member initiative and carries spent attacks',async()=>{
 const {token,scene,combat}=fixture();const result=await splitToken(token);
 assert.equal(scene.tokens.size,8);assert.equal(result.tokens[0],token);assert.equal(result.hp.reduce((a,b)=>a+b,0),50);
 assert.equal(token.actor.system.attributes.hp.max,7);assert.equal(token.actor.system.attributes.hp.value,7);
 assert.equal(token.getFlag(ID,'population').initial,1);assert.equal(token.getFlag(ID,'splitOrigin').initial,8);
 assert.equal(token.getFlag(ID,'splitLock'),undefined);assert.equal(combat.combatants.size,8);
 assert.ok([...combat.combatants.values()].every(c=>c.initiative===17));
 const ledger=combat.getFlag(ID,'ledger');assert.equal(ledger.turns.length,8);assert.deepEqual(ledger.entries,[['progress',{total:1}]]);
 for(const copy of result.tokens.slice(1)){assert.equal(copy.flags[ID].horde.count,1);assert.equal(copy.delta.system.attributes.hp.max,7);assert.equal(copy.delta.system.attributes.hp.temp,0);assert.equal(copy.delta.items[0]._id,'weapon');}
 assert.equal(token.actor.system.attributes.hp.temp,3);assert.equal(combat.combatant.id,'c0');
});
test('split failure restores HP and removes copies without deleting the original',async()=>{
 const {token,scene,combat,actor}=fixture({failCombat:true});await assert.rejects(splitToken(token),/combat failed/);
 assert.equal(scene.tokens.size,1);assert.equal(combat.combatants.size,1);assert.equal(actor.system.attributes.hp.value,50);
 assert.equal(actor.system.attributes.hp.max,56);assert.equal(token.getFlag(ID,'population').initial,8);assert.equal(token.getFlag(ID,'splitLock'),undefined);
});
test('token positions avoid occupied footprints and retain scene bounds',()=>{
 const {token,scene}=fixture();scene.tokens.set('occupied',{id:'occupied',x:1000,y:1000,width:1,height:1});
 const positions=splitPositions(token,8,1,scene);assert.equal(positions.length,8);
 assert.ok(positions.every(p=>p.x!==1000||p.y!==1000));assert.equal(new Set(positions.map(p=>JSON.stringify(p))).size,8);
});
test('the split permission check runs before changes',async()=>{
 const {token,scene}=fixture();await assert.rejects(splitToken(token,{requireAuthority:()=>{throw Error('GM only');}}),/GM only/);assert.equal(scene.tokens.size,1);
});
test('splitting keeps the active combatant when equal initiative changes the sorted order',async()=>{
 const {token,combat}=fixture();
 Object.defineProperty(combat,'combatant',{get(){return this.turns[this.turn];}});
 const create=combat.createEmbeddedDocuments.bind(combat);
 combat.createEmbeddedDocuments=async(...args)=>{const result=await create(...args);combat.turns=[...result,combat.turns.find(c=>c.id==='c0')];return result;};
 await splitToken(token);assert.equal(combat.combatant.id,'c0');assert.equal(combat.turn,7);
});
test('random splitting without combat preserves total HP and does not create initiative entries',async()=>{
 const {token,scene,combat}=fixture();game.combats=new Map();game.combat=null;
 const result=await splitToken(token,{mode:'random'});assert.equal(scene.tokens.size,8);assert.equal(result.hp.reduce((a,b)=>a+b,0),50);assert.equal(combat.combatants.size,1);
});
