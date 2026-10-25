import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
const flags = new Map(), messages=[], damageCalls=[];
const hooks = {};
globalThis.Hooks={once:(name,fn)=>{hooks[name]=fn;},on:()=>{},callAll:()=>{}};
const owner={uuid:'Combat.a',documentName:'Combat',round:1,started:true,getFlag:()=>flags.get('ledger'),setFlag:async(k,f,v)=>{flags.set(f,structuredClone(v));}};
const doc={uuid:'Scene.x.Token.orcs',getFlag:()=>null,setFlag:async()=>{}};
const actor={id:'orcs',name:'Orcs',type:'npc',token:doc,items:new Map(),getFlag:()=>null,getRollData:()=>({})};
const target={uuid:'Scene.x.Token.fighter',name:'Fighter',parent:{id:'x'},actor:{system:{attributes:{ac:{value:19}}}}};
globalThis.game={user:{isGM:true,id:'gm'},users:[{isGM:true,active:true,id:'gm'}],combat:owner,
  settings:{get:(_m,k)=>k==='promptUnmarked'?false:'publicroll'},i18n:{localize:k=>k}};
globalThis.canvas={scene:{id:'x'}};
globalThis.fromUuid=async id=>id===target.uuid?target:null;
globalThis.ui={notifications:{warn:()=>{},error:()=>{}}};
globalThis.foundry={utils:{deepClone:structuredClone,randomID:()=>Math.random().toString(36)}};
globalThis.ChatMessage={getSpeaker:()=>({actor:'orcs'}),applyMode:(data,mode)=>{data.mode=mode;},create:async data=>{messages.push(data);return {update:async update=>Object.assign(data,update)};}};
class FakeRoll {
 constructor(formula){if(!/^[-+\d\s]+$/.test(formula))throw Error('bad formula');this.formula=formula;this.isDeterministic=true;}
 async evaluate(){this.total=Number(this.formula);return this;}
}
globalThis.Roll=FakeRoll;
globalThis.CONFIG={Dice:{DamageRoll:FakeRoll}};
const {resolve,interceptAttack}=await import('../scripts/main.mjs');
const activity={actor,item:{name:'Axe',system:{}},getDamageConfig:()=>({rolls:[{}]}),
 rollDamage:async(...args)=>{damageCalls.push(args);return [{}];}};
const opts={enabled:true,group:'Orcs',count:8,attacks:1,lane:null,bonus:'5',target:target.uuid,rollMode:'blindroll'};
beforeEach(()=>{flags.clear();messages.length=0;damageCalls.length=0;owner.round=1;game.user.isGM=true;});
test('native attacks roll damage twice and preserve blind visibility without rolling a d20',async()=>{
 const result=await resolve({doc,actor,activity,options:{...opts}});
 assert.equal(result.hits,2);assert.equal(damageCalls.length,2);
 assert.equal(messages[0].mode,'blindroll');assert.equal(damageCalls[0][2].rollMode,'blindroll');
 assert.equal(damageCalls[0][0].isCritical,false);assert.equal(damageCalls[0][1].configure,false);
});
test('second native attack starts another lane; next round starts again at lane one',async()=>{
 await resolve({doc,actor,activity,options:{...opts}});
 let result=await resolve({doc,actor,activity,options:{...opts}});
 assert.equal(result.plans[0].lane,2);
 owner.round=2; result=await resolve({doc,actor,activity,options:{...opts}});
 assert.equal(result.plans[0].lane,1);assert.equal(result.plans[0].result.before,0);
});
test('three separate horde tokens complete a single hit across serialized requests',async()=>{
 const calls=[1,2,3].map(i=>resolve({doc:{...doc,uuid:`token${i}`},actor,activity,options:{...opts,count:1}}));
 const results=await Promise.all(calls);assert.deepEqual(results.map(r=>r.hits),[0,0,1]);assert.equal(damageCalls.length,1);
});
test('non-GM cannot mutate horde state',async()=>{
 game.user.isGM=false;await assert.rejects(resolve({doc,actor,activity,options:opts}));assert.equal(flags.size,0);
});
test('ordinary PC and unmarked NPC attacks pass through exactly once',async()=>{
 let calls=0;const original=async()=>{calls++;return ['native'];};
 assert.deepEqual(await interceptAttack.call({actor:{type:'character'}},original),['native']);
 assert.deepEqual(await interceptAttack.call(activity,original),['native']);assert.equal(calls,2);
});
test('insufficient ammunition does not consume counters or roll damage',async()=>{
 actor.items.set('arrows',{id:'arrows',system:{quantity:2}});
 await assert.rejects(resolve({doc,actor,activity,options:{...opts,ammunition:'arrows'}}));
 assert.equal(flags.size,0);assert.equal(damageCalls.length,0);actor.items.clear();
});
test('damage failure preserves an explicit partial result instead of retrying the attack',async()=>{
 const broken={...activity,rollDamage:async()=>{throw Error('interrupted');}};
 await assert.rejects(resolve({doc,actor,activity:broken,options:opts}));
 assert.equal(flags.size,1);assert.match(messages[0].content,/HORDE.partial/);
});
test('damage-free attacks count hits without invoking damage rolls',async()=>{
  const noDamage={...activity,getDamageConfig:()=>({rolls:[]})};
  const result=await resolve({doc,actor,activity:noDamage,options:opts});
  assert.equal(result.hits,2);assert.equal(damageCalls.length,0);
});
test('a later weak attacker rolls the earlier stronger member’s frozen damage profile',async()=>{
  const frozen=[];
  FakeRoll.build=async(config,dialog,message)=>{frozen.push({config,message});return [{}];};
  const strong={...activity,getDamageConfig:()=>({rolls:[{parts:['12'],data:{},options:{type:'fire'}}]})};
  const weak={...activity,getDamageConfig:()=>({rolls:[{parts:['4'],data:{},options:{type:'cold'}}]})};
  await resolve({doc:{...doc,uuid:'strongToken'},actor,activity:strong,options:{...opts,count:2}});
  await resolve({doc:{...doc,uuid:'weakToken'},actor,activity:weak,options:{...opts,count:1}});
  assert.equal(frozen.length,1);assert.equal(frozen[0].config.rolls[0].parts[0],'12');
  assert.equal(frozen[0].config.rolls[0].options.type,'fire');assert.equal(frozen[0].message.rollMode,'blindroll');
  assert.equal(damageCalls.length,0);
});
