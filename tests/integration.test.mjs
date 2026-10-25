import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
const flags = new Map(), messages=[], damageCalls=[];
const hooks = {};
globalThis.Hooks={once:(name,fn)=>{hooks[name]=fn;},on:()=>{},callAll:()=>{}};
// Model Foundry's dotted-path update expansion and recursive flag merges.
function documentRoundTrip(value) {
 const flat={};
 function flatten(object,path='') {
  for(const [key,v] of Object.entries(object)) {
   const next=path ? `${path}.${key}` : key;
   if(v && v.constructor===Object && Object.keys(v).length) flatten(v,next);
   else flat[next]=structuredClone(v);
  }
 }
 flatten(value);const output={};
 for(const [path,value] of Object.entries(flat)) {
  const keys=path.split('.');let node=output;
  for(const key of keys.slice(0,-1)) node=node[key]??={};
  node[keys.at(-1)]=value;
 }
 return output;
}
function mergeStored(old,next) {
 const result=structuredClone(old ?? {});
 for(const [k,v] of Object.entries(next)) result[k]=v && v.constructor===Object
   ? mergeStored(result[k],v) : structuredClone(v);
 return result;
}
const owner={uuid:'Combat.a' ,documentName:'Combat',round:1,started:true,getFlag:()=>flags.get('ledger'),setFlag:async(k,f,v)=>{flags.set(f,mergeStored(flags.get(f),documentRoundTrip(v)));}};
const doc={uuid:'Scene.x.Token.orcs',getFlag:()=>null,setFlag:async()=>{}};
const actor={id:'orcs',name:'Orcs',type:'npc',token:doc,items:new Map(),getFlag:()=>null,getRollData:()=>({})};
const target={uuid:'Scene.x.Token.fighter',name:'Fighter',parent:{id:'x'},actor:{system:{attributes:{ac:{value:19}}}}};
globalThis.game={user:{isGM:true,id:'gm'},users:[{isGM:true,active:true,id:'gm'}],combat:owner,
  settings:{get:(_m,k)=>['promptUnmarked','promptMarked'].includes(k)?false:'publicroll'},i18n:{localize:k=>k}};
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
globalThis.CONST={DICE_ROLL_MODES:{PUBLIC:'publicroll',PRIVATE:'gmroll',BLIND:'blindroll',SELF:'selfroll'}};
globalThis.CONFIG={Dice:{DamageRoll:FakeRoll}};
const {resolve,interceptAttack,visibilityChoices,toggleTokens,sceneControls,interceptChat,attackDialog}=await import('../scripts/main.mjs');
const activity={actor,item:{name:'Axe',system:{}},getDamageConfig:()=>({rolls:[{}]}),
 rollDamage:async(...args)=>{damageCalls.push(args);return [{}];}};
const opts={enabled:true,group:'Orcs',count:8,attacks:1,lane:null,bonus:'5',target:target.uuid,rollMode:'blindroll'};
beforeEach(()=>{flags.clear();messages.length=0;damageCalls.length=0;owner.round=1;game.user.isGM=true;game.user.targets=new Set();canvas.tokens={controlled:[],placeables:[]};});
test('native attacks roll damage twice and preserve blind visibility without rolling a d20',async()=>{
 const result=await resolve({doc,actor,activity,options:{...opts}});
 assert.equal(result.hits,2);assert.equal(damageCalls.length,2);
 assert.deepEqual(messages[0].whisper,['gm']);assert.equal(damageCalls[0][2].rollMode,'blindroll');
 assert.equal(damageCalls[0][0].isCritical,false);assert.equal(damageCalls[0][1].configure,false);
});
test('next round starts at attack slot one while keeping its accumulated progress',async()=>{
 await resolve({doc,actor,activity,options:{...opts}});
 let result=await resolve({doc,actor,activity,options:{...opts}});
 assert.equal(result.plans[0].lane,2);
 owner.round=2; result=await resolve({doc,actor,activity,options:{...opts}});
 assert.equal(result.plans[0].lane,1);assert.equal(result.plans[0].result.before,8);assert.equal(result.hits,3);
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

test('v14 roll-mode objects localize only their string labels',()=>{
 const original=game.i18n.localize;
 game.i18n.localize=key=>{assert.equal(typeof key,'string');return key.split('.').at(-1);};
 CONFIG.ChatMessage={modes:{public:{label:'CHAT.Public',handler(){}},gm:{label:'CHAT.GM',handler(){}}}};
 assert.deepEqual(visibilityChoices(),[['public','Public'],['gm','GM']]);
 delete CONFIG.ChatMessage;
 CONFIG.Dice.rollModes={publicroll:{label:'CHAT.Public'},gmroll:'CHAT.GM'};
 assert.deepEqual(visibilityChoices(),[['publicroll','Public'],['gmroll','GM']]);
 game.i18n.localize=original;
});
test('attack dialog opens with real v14 mode metadata instead of key.split error',async()=>{
 CONFIG.ChatMessage={modes:{public:{label:'CHAT.Public'},gm:{label:'CHAT.GM'}}};
 const original=game.i18n.localize;
 game.i18n.localize=key=>{if(typeof key!=='string')throw Error('key.split is not a function');return key;};
 const originalGet=game.settings.get;game.settings.get=(_scope,key)=>{assert.equal(key,'messageMode');return 'public';};
 let content;
 foundry.applications={api:{DialogV2:{wait:async options=>{content=options.content;return null;}}}};
 assert.equal(await attackDialog({doc,actor}),null);
 assert.match(content,/CHAT.Public/);assert.match(content,/CHAT.GM/);
 game.i18n.localize=original;game.settings.get=originalGet;delete CONFIG.ChatMessage;
});
function selectedNPC(id,initial={}) {
 const token={id,uuid:`Scene.x.Token.${id}`,actor:{...actor,name:id},state:initial,
 getFlag(){return this.state;}};
 return token;
}
function batchScene(tokens) {
 canvas.scene.updateEmbeddedDocuments=async(type,updates)=>{
  assert.equal(type,'Token');for(const update of updates)tokens.find(t=>t.id===update._id).state=update['flags.yarpenart-mob-attacker.horde'];
  return updates;
 };
 ui.notifications.info=()=>{};
}
test('one click marks selected NPCs as a shared Horde; next click unmarks all',async()=>{
 const tokens=[selectedNPC('a'),selectedNPC('b')];batchScene(tokens);
 const pc={id:'pc',actor:{type:'character'}};
 let result=await toggleTokens([...tokens,pc]);
 assert.equal(result.enabled,true);assert.equal(result.count,2);
 assert.equal(tokens[0].state.group,tokens[1].state.group);assert.equal(tokens[0].state.count,1);
 result=await toggleTokens(tokens);assert.equal(result.enabled,false);assert.ok(tokens.every(t=>!t.state.enabled));
});
test('mixed selection enables all and preserves configured group size',async()=>{
 const tokens=[selectedNPC('a',{enabled:true,group:'Goblins',count:4}),selectedNPC('b')];batchScene(tokens);
 await toggleTokens(tokens);assert.equal(tokens[0].state.count,4);assert.equal(tokens[1].state.group,'Goblins');
});
test('GM details stay private even when damage is public',async()=>{
 await resolve({doc,actor,activity,options:{...opts,rollMode:'publicroll'}});
 assert.deepEqual(messages[0].whisper,['gm']);assert.equal(messages[0].blind,false);
 assert.equal(damageCalls[0][2].rollMode,'publicroll');
 assert.equal(damageCalls[0][2].data.flavor,'Axe');
 assert.doesNotMatch(damageCalls[0][2].data.flavor,/Horde|KP|AC|threshold/i);
});
test('marked native sheet attack uses its own bonus and damage without a Horde dialog',async()=>{
 const saved={...opts,group:'Goblins',count:8};
 const markedDoc={...doc,getFlag:()=>saved};
 const native={...activity,actor:{...actor,token:markedDoc},
 item:{...activity.item,getFlag:()=>undefined},getAttackData:()=>({parts:['5'],data:{}})};
 game.user.targets=new Set([{document:target}]);
 let nativeCalls=0;
 await interceptAttack.call(native,async()=>{nativeCalls++;});
 assert.equal(nativeCalls,0);assert.equal(damageCalls.length,2);
});
test('Horde chat commands run before core slash-command validation',async()=>{
 const tokens=[selectedNPC('a'),selectedNPC('b')];batchScene(tokens);
 canvas.tokens.controlled=tokens.map(document=>({document}));
 let nativeCalls=0;
 const core=async()=>{nativeCalls++;throw Error('Invalid chat command');};
 assert.equal(await interceptChat(core,'/horde toggle'),undefined);
 assert.equal(nativeCalls,0);assert.ok(tokens.every(t=>t.state.enabled));
});
test('ordinary chat and unmarked dice pass through unchanged once',async()=>{
 const calls=[];const core=async(...args)=>{calls.push(args);return 'native';};
 assert.equal(await interceptChat(core,'/r 1d20+5',{speaker:'x'}),'native');
 assert.equal(await interceptChat(core,'Hello'),'native');assert.equal(calls.length,2);
 assert.deepEqual(calls[0],['/r 1d20+5',{speaker:'x'}]);
});
test('players cannot open rule dialogs, register Horde tools, or execute Horde commands',async()=>{
 game.user.isGM=false;const controls={tokens:{tools:{}}};sceneControls(controls);
 assert.deepEqual(controls.tokens.tools,{});
 await assert.rejects(interceptChat(async()=>{throw Error('should not send');},'/horde help'));
});

test('manual Horde and marked raw-roll commands open the GM dialog without running core dice',async()=>{
 const token={actor,document:doc};canvas.tokens.controlled=[token];
 let opened=0,native=0;
 foundry.applications={api:{DialogV2:{wait:async()=>{opened++;return null;}}}};
 await interceptChat(async()=>{native++;},'/horde 5 | 6 | 8');
 await interceptChat(async()=>{native++;},'/r 1d20+5 #horde | 6');
 assert.equal(opened,2);assert.equal(native,0);
});

test('regression: dotted UUID keys are corrupted by document expansion, stored entries are safe',async()=>{
 const key='["Horde","Scene.x.Token.fighter",4,1,10]';
 assert.notDeepEqual(documentRoundTrip({buckets:{[key]:{total:1}}}),{buckets:{[key]:{total:1}}});
 for(let i=1;i<=3;i++) {
  const result=await resolve({doc:{...doc,uuid:`Scene.x.Token.goblin${i}`},actor,activity,
    options:{...opts,group:'Goblins',count:1,bonus:'5'}});
  assert.equal(result.plans[0].result.before,i-1);
  assert.equal(flags.get('ledger').schema,2);
  assert.ok(Array.isArray(flags.get('ledger').entries));
 }
 assert.equal(damageCalls.length,1);
});
test('ten goblins needing a natural 20 hit in the second round without losing progress',async()=>{
 const original=target.actor.system.attributes.ac.value;
 target.actor.system.attributes.ac.value=24;
 for(let round=1;round<=2;round++) {
  owner.round=round;
  for(let i=1;i<=10;i++) {
   const result=await resolve({doc:{...doc,uuid:`Scene.x.Token.goblin${i}`},actor,activity,
    options:{...opts,group:'Goblins',count:1,bonus:'4'}});
   assert.equal(result.plans[0].lane,1);
   assert.equal(result.plans[0].result.before,(round-1)*10+i-1);
  }
 }
 assert.equal(damageCalls.length,1);
 target.actor.system.attributes.ac.value=original;
});
test('three native goblin sheet attacks retain progress and roll native damage at the threshold',async()=>{
 const original=target.actor.system.attributes.ac.value;target.actor.system.attributes.ac.value=10;
 game.user.targets=new Set([{document:target}]);
 for(let i=1;i<=3;i++) {
  const token={...doc,uuid:`Scene.x.Token.goblin${i}`,getFlag:()=>({enabled:true,group:'Horde',count:1})};
  const native={...activity,actor:{...actor,token},item:{...activity.item,getFlag:()=>undefined},
    getAttackData:()=>({parts:['4'],data:{}})};
  await interceptAttack.call(native,async()=>{throw Error('must not roll a d20');});
 }
 assert.equal(damageCalls.length,1);
 assert.equal(flags.get('ledger').entries[0][1].total,3);
 target.actor.system.attributes.ac.value=original;
});
test('quick-marking NPCs separately uses a shared default Horde instead of random groups',async()=>{
 const tokens=[selectedNPC('a'),selectedNPC('b')];batchScene(tokens);
 await toggleTokens([tokens[0]]);await toggleTokens([tokens[1]]);
 assert.equal(tokens[0].state.group,'Horde');assert.equal(tokens[1].state.group,'Horde');
});

test('outside combat consecutive attacks share saved progress until an explicit reset',async()=>{
 const originalScene=canvas.scene,originalCombat=game.combat;
 canvas.scene={...owner,uuid:'Scene.x',id:'x',documentName:'Scene'};game.combat=null;
 try {
  for(let i=0;i<3;i++) {
   const result=await resolve({doc,actor,activity,options:{...opts,count:1}});
   assert.equal(result.plans[0].result.before,i);assert.equal(result.plans[0].lane,1);
  }
  assert.equal(damageCalls.length,1);
 } finally {canvas.scene=originalScene;game.combat=originalCombat;}
});
