import {mockSettings} from './test-settings.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {distributeHP,splitToken,splitPositions} from '../scripts/split.mjs';
import {hordeSize,ID,syncPopulation} from '../scripts/population.mjs';
globalThis.foundry={utils:{deepClone:structuredClone}};
function apply(doc,data){for(const [key,value] of Object.entries(data)){const path=key.split('.');let node=doc;for(const k of path.slice(0,-1))node=node[k]??={};const last=path.at(-1);if(last.startsWith('-='))delete node[last.slice(2)];else node[last]=structuredClone(value);}}
function flagMethods(doc){return Object.assign(doc,{getFlag(id,key){return this.flags?.[id]?.[key];},async setFlag(id,key,v){this.flags??={};this.flags[id]??={};this.flags[id][key]=structuredClone(v);},async unsetFlag(id,key){delete this.flags?.[id]?.[key];},async update(data){apply(this,data);},toObject(){const {actor,parent,combatants,turns,...data}=this;return Object.fromEntries(Object.entries(data).filter(([k,v])=>typeof v!=='function'));}});}
function fixture({count=8,hp=50,failCombat=false}={}){
 const actor={name:'Goblin',system:{attributes:{hp:{max:56,value:hp,temp:3}},traits:{size:'huge'}},getFlag:()=>null,
  async update(data){apply(this,data);},toObject(){return {name:'Goblin',system:structuredClone(this.system),items:[{_id:'weapon',name:'Scimitar'}],effects:[],flags:{}};}};
 const scene={id:'scene',width:4000,height:4000,grid:{size:100},tokens:new Map(),
  async createEmbeddedDocuments(type,data){assert.equal(type,'Token');return data.map((d,i)=>{const serial=this.nextToken??0;this.nextToken=serial+1;const token=flagMethods({...structuredClone(d),id:'copy'+serial,uuid:'Scene.scene.Token.copy'+serial,parent:this});token.actor={system:structuredClone(d.delta.system)};this.tokens.set(token.id,token);return token;});},
  async deleteEmbeddedDocuments(type,ids){for(const id of ids)this.tokens.delete(id);}};
 const token=flagMethods({id:'original',uuid:'Scene.scene.Token.original',name:'Goblin Horde',parent:scene,actor,actorId:'goblin',actorLink:false,x:1000,y:1000,width:3,height:3,
  flags:{[ID]:{horde:{enabled:true,count,attackLimit:2,group:'Goblins'},population:{baseHP:7,baseSize:'sm',width:1,height:1,initial:8,current:count}}}});
 scene.tokens.set(token.id,token);
 const original=flagMethods({id:'c0',uuid:'Combat.combat.Combatant.c0',actorId:'goblin',tokenId:token.id,sceneId:scene.id,initiative:17,hidden:false});
 const combat=flagMethods({id:'combat',uuid:'Combat.combat',started:true,turn:0,round:2,combatants:new Map([['c0',original]]),turns:[original],combatant:original,
  flags:{[ID]:{ledger:{schema:3,scope:'Combat.combat',entries:[['progress',{total:1}]],turns:[{combatant:original.uuid,round:2,slot:1,hits:0,group:'Goblins',target:'target'}]}}},
  async updateEmbeddedDocuments(type,updates){assert.equal(type,'Combatant');for(const data of updates)apply(this.combatants.get(data._id),data);},
  async createEmbeddedDocuments(type,data){if(failCombat)throw Error('combat failed');return data.map((d,i)=>{assert.equal(d.initiative,17);const c={...d,id:'new'+i,uuid:'Combat.combat.Combatant.new'+i};this.combatants.set(c.id,c);this.turns.push(c);return c;});},
  async deleteEmbeddedDocuments(type,ids){for(const id of ids)this.combatants.delete(id);this.turns=this.turns.filter(c=>!ids.includes(c.id));}});
 globalThis.game={settings:mockSettings(),combats:new Map([['combat',combat]]),combat};
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
 assert.equal(token.getFlag(ID,'splitLock'),undefined);assert.equal(combat.combatants.size,8);assert.equal(token.name,'Goblin 1');assert.ok([...combat.combatants.values()].every(c=>!c.name.includes('(Horde)')));
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
test('reroll mode rolls native initiative for every member, including the original token',async()=>{
 const {token,combat}=fixture();let calls=0;
 game.settings.get=(id,key)=>key==='splitInitiative'?'reroll':undefined;
 combat.rollInitiative=async(ids,options)=>{calls++;assert.equal(ids.length,8);assert.ok(ids.includes('c0'));assert.equal(options.updateTurn,true);
  assert.equal(token.actor.system.attributes.hp.max,7);assert.equal(token.name,'Goblin 1');
  ids.forEach((id,i)=>{combat.combatants.get(id).initiative=i+3;});};
 await splitToken(token);assert.equal(calls,1);assert.equal(combat.combatants.get('c0').initiative,3);
 assert.equal(new Set([...combat.combatants.values()].map(c=>c.initiative)).size,8);assert.equal(combat.getFlag(ID,'ledger').turns.length,8);
});
test('shared initiative remains the default and does not invoke a fresh roll',async()=>{
 const {token,combat}=fixture();combat.rollInitiative=async()=>{throw Error('Unexpected reroll');};
 await splitToken(token);assert.ok([...combat.combatants.values()].every(c=>c.initiative===17));
});
test('a failed initiative reroll restores the original initiative, name, HP and ledger',async()=>{
 const {token,combat,scene}=fixture();
 combat.rollInitiative=async(ids)=>{combat.combatants.get(ids[0]).initiative=2;throw Error('roll failed');};
 await assert.rejects(splitToken(token,{initiativeMode:'reroll'}),/roll failed/);
 assert.equal(scene.tokens.size,1);assert.equal(combat.combatants.size,1);assert.equal(combat.combatants.get('c0').initiative,17);
 assert.equal(combat.combatants.get('c0').name,'Goblin 1 (Horde)');assert.equal(token.actor.system.attributes.hp.value,50);
 assert.equal(combat.getFlag(ID,'ledger').turns.length,1);assert.equal(token.getFlag(ID,'splitLock'),undefined);
});
test('rerolling keeps the same active combatant after initiative sorting changes',async()=>{
 const {token,combat}=fixture();Object.defineProperty(combat,'combatant',{get(){return this.turns[this.turn];}});
 combat.rollInitiative=async(ids)=>{ids.forEach((id,i)=>{combat.combatants.get(id).initiative=i;});combat.turns.sort((a,b)=>b.initiative-a.initiative);};
 await splitToken(token,{initiativeMode:'reroll'});assert.equal(combat.combatant.id,'c0');assert.equal(combat.turn,7);
});
test('reroll mode outside combat creates no initiative entries',async()=>{
 const {token,combat}=fixture();game.combats=new Map();game.combat=null;
 combat.rollInitiative=async()=>{throw Error('No combat rolls should be requested');};
 const result=await splitToken(token,{initiativeMode:'reroll'});assert.equal(result.tokens.length,8);assert.equal(combat.combatants.size,1);
});

 test('two eight-member Hordes split into distinct group/member names or continuous 1–16',async()=>{
 for(const mode of ['horde','continuous']){
 const {token,scene}=fixture({hp:56});game.combats=new Map();game.combat=null;game.settings.values.set('splitNaming',mode);
 const other=flagMethods({...token,id:'secondHorde',uuid:'Scene.scene.Token.secondHorde',x:2500,actor:{...token.actor,system:structuredClone(token.actor.system)},flags:structuredClone(token.flags)});scene.tokens.set(other.id,other);
 const first=await splitToken(token),second=await splitToken(other);
 assert.equal(scene.tokens.size,16);assert.equal(new Set([...first.tokens,...second.tokens].map(t=>t.name)).size,16);
 if(mode==='horde'){assert.equal(first.tokens[0].name,'Goblin 1.1');assert.equal(second.tokens.at(-1).name,'Goblin 2.8');}
 else {assert.equal(first.tokens[0].name,'Goblin 1');assert.equal(second.tokens.at(-1).name,'Goblin 16');}
 }
 });
test('equal and random HP distribution respect different stored per-creature maxima',()=>{
 for(const mode of ['equal','random'])for(const total of [3,8,15]){
 const hp=distributeHP(total,3,[1,5,9],mode);assert.equal(hp.reduce((a,b)=>a+b,0),total);assert.ok(hp.every((n,i)=>n>=1&&n<=[1,5,9][i]));
 }
});
test('splitting a Horde with rolled maxima gives each member its actual maximum',async()=>{
 const {token,scene}=fixture({count:3,hp:16});game.combat=null;game.combats=new Map();
 token.actor.system.attributes.hp.max=16;token.flags[ID].population={...token.flags[ID].population,initial:3,current:3,maxima:[3,8,5],members:[3,8,5]};
 const result=await splitToken(token);assert.equal(scene.tokens.size,3);
 assert.deepEqual(result.tokens.map(t=>t.actor.system.attributes.hp.max),[3,8,5]);assert.equal(result.hp.reduce((a,b)=>a+b,0),16);
 for(const member of result.tokens){await syncPopulation(member);assert.equal(member.getFlag(ID,'horde').count,1);}
});
