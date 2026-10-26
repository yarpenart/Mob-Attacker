import {finishCombat,trackPopulation,memoryScope} from '../scripts/combat-memory.mjs';
import {mockSettings} from './test-settings.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeTokens,mergePlan,mergedInitiative} from '../scripts/merge.mjs';
import {syncPopulation,populationActorUpdated,ID} from '../scripts/population.mjs';
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
 globalThis.game={settings:mockSettings(),combats:new Map([['x',combat]]),combat};
 return {scene,docs,combat,rows};
}
test('merge sums HP and maximum HP, keeps wounded members and uses median initiative',async()=>{
 const {docs,scene,combat}=fixture();const result=await mergeTokens(docs,{preferred:docs[2]});
 assert.equal(result.token,docs[0]);assert.equal(scene.tokens.size,1);assert.equal(result.count,3);assert.equal(result.hp,7);assert.equal(result.max,21);
 assert.equal(result.token.name,'Goblin 1 (Horde)');assert.equal(combat.combatants.size,1);assert.equal(combat.combatant.initiative,12);
 assert.equal(combat.combatant.name,'Goblin 1 (Horde)');assert.equal(result.token.actor.system.attributes.hp.temp,3);
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
 assert.equal(mergedInitiative([17,8,12]),12);assert.equal(mergedInitiative([20,8,17,12]),17);
 assert.equal(mergedInitiative([null,undefined,NaN,Infinity]),null);assert.equal(mergedInitiative([null,0,-2]),0);
 assert.equal(mergedInitiative([8,17,12],'highest'),17);assert.equal(mergedInitiative([8,17,12],'lowest'),8);
 assert.equal(mergedInitiative([15,12,10,7,5,1]),10);assert.equal(mergedInitiative([12,10,9,7,6,5,1]),7);
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
test('split members with different synthetic actor names merge immediately and keep their base creature name',async()=>{
 const {docs,scene}=fixture();const merged=await mergeTokens(docs);const split=await splitToken(merged.token);
 // Foundry and sheet/token-name integrations may give each synthetic actor its token's name.
 split.tokens.forEach((token,i)=>{token.actor.name=`Goblin ${i+1}`;});
 const result=await mergeTokens(split.tokens,{preferred:split.tokens[1]});
 assert.equal(scene.tokens.size,1);assert.equal(result.count,3);assert.equal(result.hp,7);assert.equal(result.max,21);
 assert.equal(result.token.name,'Goblin 1 (Horde)');assert.equal(result.token.getFlag(ID,'population').baseName,'Goblin');
});
test('equivalent string and numeric attack limits do not block remerging individual members',async()=>{
 const {docs}=fixture();docs[0].flags[ID]={horde:{enabled:true,count:1,attackLimit:1}};docs[1].flags[ID]={horde:{enabled:true,count:1,attackLimit:'1'}};
 const result=await mergeTokens(docs);assert.equal(result.count,3);
});
test('same-NPC individuals with different rolled maximum HP merge and split without losing their caps',async()=>{
 const {docs}=fixture();docs[0].actor.system.attributes.hp={max:3,value:3,temp:0};docs[1].actor.system.attributes.hp={max:8,value:8,temp:0};docs[2].actor.system.attributes.hp={max:5,value:5,temp:0};
 const merged=await mergeTokens(docs);assert.equal(merged.max,16);assert.equal(merged.hp,16);assert.equal(merged.count,3);
 const split=await splitToken(merged.token);assert.deepEqual(split.tokens.map(token=>token.actor.system.attributes.hp.max),[3,8,5]);
});
test('the last survivor of a rolled Horde merges using its own cap rather than a fallen member’s cap',async()=>{
 const {docs,scene}=fixture();[3,8,5].forEach((max,i)=>{docs[i].actor.system.attributes.hp={max,value:max,temp:0};});
 const merged=await mergeTokens(docs);merged.token.actor.system.attributes.hp.value=4;await syncPopulation(merged.token);
 assert.equal(merged.token.getFlag(ID,'horde').count,1);
 const [extra]=await scene.createEmbeddedDocuments('Token',[{actorId:'goblin',delta:{system:{attributes:{hp:{max:7,value:7,temp:0}},traits:{size:'sm'}}}}]);
 const result=await mergeTokens([merged.token,extra]);assert.equal(result.max,15);assert.equal(result.hp,11);assert.equal(result.count,2);
});

test('native rolled HP Horde can split and immediately merge repeatedly without rerolls or cap loss',async()=>{
 const {docs}=fixture();game.combats=new Map();game.combat=null;
 const original=docs[0];original.actor.system.attributes.hp={max:7,value:7,temp:0,formula:'2d6'};original.actor.getRollData=()=>({});
 let rolls=0;globalThis.Roll=class{async evaluate(){this.total=[3,11,5][rolls++];return this;}};
 game.settings.values.set('hordeHPMode','rolled');await original.setFlag(ID,'horde',{enabled:true,count:3,attackLimit:1});
 await syncPopulation(original);assert.equal(original.actor.system.attributes.hp.max,19);assert.equal(rolls,3);
 // Remove the unrelated fixture tokens from the scene.
 original.parent.tokens.delete(docs[1].id);original.parent.tokens.delete(docs[2].id);
 globalThis.Hooks={once:()=>{},on:()=>{}};globalThis.ui={combat:{render(){}},notifications:{info(){}}};
 game.i18n={localize:key=>key};game.user={isGM:true,id:'gm'};game.users=[{isGM:true,id:'gm',active:true}];
 const {splitMergeHorde}=await import('../scripts/main.mjs');
 for(let i=0;i<3;i++){
  const split=await splitToken(original);assert.deepEqual(split.tokens.map(t=>t.actor.system.attributes.hp.max),[3,11,5]);
  for(const token of split.tokens)token.flags[ID].horde.count='1';
  globalThis.canvas={tokens:{controlled:split.tokens.map(document=>({document}))}};
  const merged=await splitMergeHorde(original);assert.equal(merged.max,19);assert.equal(merged.hp,19);assert.equal(rolls,3);
 }
});
test('population hooks cannot recalculate a partially split token',async()=>{
 const {docs}=fixture(),token=docs[0];await token.setFlag(ID,'population',{baseHP:7,current:3,initial:3});await token.setFlag(ID,'splitLock',true);token.actor.token=token;
 await populationActorUpdated(token.actor,{});assert.equal(token.getFlag(ID,'population').current,3);assert.equal(token.actor.system.attributes.hp.max,7);
});

test('individual actor maximum HP wins over stale population base HP',()=>{
 const {docs}=fixture();docs[0].actor.system.attributes.hp={max:11,value:11,temp:0};
 docs[0].flags[ID]={horde:{enabled:true,count:'1'},population:{initial:1,current:1,baseHP:3,baseSize:'sm',members:[11],maxima:[3]}};
 assert.equal(mergePlan(docs).members[0].max,11);
});


test('individual initiatives survive repeated merge/split; summary counts unique casualties',async()=>{
 const {docs,scene,combat}=fixture();game.scenes=new Map([['s',scene]]);game.messages={contents:[]};game.users=[{id:'gm',isGM:true},{id:'player',isGM:false}];
 const messages=[];globalThis.ChatMessage={create:async data=>messages.push(data)};let rolls=0;
 combat.rollInitiative=async ids=>{rolls+=ids.length;for(const [i,id] of ids.entries())combat.combatants.get(id).initiative=20+i;};
 const merged=await mergeTokens(docs);const sessionId=combat.getFlag(ID,'session').id;
 assert.equal(combat.getFlag(ID,'session').members.length,3);
 const split=await splitToken(merged.token,{initiativeMode:'reroll'});
 assert.equal(rolls,0);assert.deepEqual(split.tokens.map(doc=>[...combat.combatants.values()].find(row=>row.tokenId===doc.id).initiative),[8,17,12]);
 await mergeTokens(split.tokens);const splitAgain=await splitToken(merged.token,{initiativeMode:'reroll'});assert.equal(rolls,0);
 await mergeTokens(splitAgain.tokens);merged.token.actor.system.attributes.hp.value=2;await syncPopulation(merged.token);
 assert.equal(merged.token.getFlag(ID,'population').members.filter(hp=>hp===0).length,2);
 const scope=memoryScope(),save={scope,status:'pending'};game.messages.contents.push({getFlag:(id,key)=>key==='save'?save:null,async update(data){save.status=data[`flags.${ID}.save.status`];}});
 await combat.setFlag(ID,'saveLedger',[['old',1]]);const result=await finishCombat(combat,{t:(key,values)=>values?JSON.stringify(values):key});
 assert.deepEqual(result,{total:3,killed:2,survived:1});assert.equal(messages.length,1);assert.deepEqual(messages[0].whisper,['gm']);assert.equal(save.status,'expired');
 assert.equal(combat.getFlag(ID,'session'),undefined);assert.equal(combat.getFlag(ID,'ledger'),undefined);assert.equal(combat.getFlag(ID,'saveLedger'),undefined);
 assert.equal(merged.token.getFlag(ID,'battle'),undefined);assert.equal(merged.token.actor.system.attributes.hp.value,2);
 await finishCombat(combat);assert.equal(messages.length,1);
 await trackPopulation(merged.token,merged.token.getFlag(ID,'population'));assert.notEqual(combat.getFlag(ID,'session').id,sessionId);assert.equal(combat.getFlag(ID,'session').members.length,1);assert.equal(combat.getFlag(ID,'session').members[0].initiative,undefined);
});
test('first individual split rolls once, later splits restore, a new combat rolls fresh',async()=>{
 const {docs,combat,scene}=fixture();game.scenes=new Map([['s',scene]]);game.messages={contents:[]};game.users=[{id:'gm',isGM:true}];globalThis.ChatMessage={create:async()=>{}};
 const merged=await mergeTokens(docs);await combat.unsetFlag(ID,'session');await merged.token.unsetFlag(ID,'battle');
 await syncPopulation(merged.token);let rolls=0;
 combat.rollInitiative=async ids=>{for(const id of ids)combat.combatants.get(id).initiative=++rolls;};
 let split=await splitToken(merged.token,{initiativeMode:'reroll'});assert.equal(rolls,3);
 await mergeTokens(split.tokens);split=await splitToken(merged.token,{initiativeMode:'reroll'});assert.equal(rolls,3);
 await mergeTokens(split.tokens);game.settings.values.set('combatSummary',false);await finishCombat(combat);
 split=await splitToken(merged.token,{initiativeMode:'reroll'});assert.equal(rolls,6);
});
test('deleted combat cleans only its own memory and summary can be disabled',async()=>{
 const {docs,scene,combat}=fixture();game.scenes=new Map([['s',scene]]);game.messages={contents:[]};game.users=[{id:'gm',isGM:true}];
 let reports=0;globalThis.ChatMessage={create:async()=>reports++};game.settings.values.set('combatSummary',false);
 const merged=await mergeTokens(docs);const other={id:'other',getFlag:()=>({combat:'Combat.other',session:'other'}),unsetFlag:async()=>{throw Error('must not clear another combat');}};scene.tokens.set(other.id,other);
 await finishCombat(combat,{deleted:true});assert.equal(reports,0);assert.equal(merged.token.getFlag(ID,'battle'),undefined);assert.equal(merged.token.actor.system.attributes.hp.value,7);
});
