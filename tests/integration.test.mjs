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
const {resolve,interceptAttack,visibilityChoices,toggleTokens,sceneControls,interceptChat,attackDialog,interceptDamage,renderSheet,hordeMenu}=await import('../scripts/main.mjs');
const activity={actor,item:{name:'Axe',system:{}},getDamageConfig:()=>({rolls:[{}]}),
 rollDamage:async(...args)=>{damageCalls.push(args);return [{}];}};
const opts={enabled:true,group:'Orcs',count:8,attacks:1,lane:null,bonus:'5',target:target.uuid,rollMode:'blindroll'};
beforeEach(()=>{flags.clear();messages.length=0;damageCalls.length=0;owner.round=1;owner.combatant=null;game.user.isGM=true;game.user.targets=new Set();canvas.tokens={controlled:[],placeables:[]};});
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
 assert.equal(result.plans[0].lane,1);assert.equal(result.plans[0].result.before,16);assert.equal(result.hits,3);
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
  assert.equal(flags.get('ledger').schema,3);
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

function initiativeGoblin(number,attackLimit=1) {
 const token={uuid:`Scene.x.Token.goblin${number}`,id:`g${number}`,getFlag:()=>({enabled:true,group:'Horde',count:1,attackLimit})};
 const npc={...actor,name:`Goblin ${number}`,id:`g${number}`,token,items:new Map()};token.actor=npc;
 const weapon={id:'scimitar',name:'Scimitar',type:'weapon',system:{activities:new Map()},getFlag:()=>undefined};
 const attack={actor:npc,item:weapon,id:'attack',name:'Slash',type:'attack',getAttackData:()=>({parts:['4'],data:{}}),
  getDamageConfig:()=>({rolls:[{parts:['4'],options:{type:'slashing'}}]}),
  rollDamage:async(...args)=>{damageCalls.push({goblin:number,args});return [{}];}};
 weapon.system.activities.set('attack',attack);npc.items.set('scimitar',weapon);
 return {uuid:`Combat.a.Combatant.g${number}`,id:`g${number}`,actor:npc,token,attack};
}
test('one open sheet follows initiative and repeated clicks cannot generate free attacks',async()=>{
 const oldAC=target.actor.system.attributes.ac.value;target.actor.system.attributes.ac.value=10;
 const a=initiativeGoblin(1),b=initiativeGoblin(2);game.user.targets=new Set([{document:target}]);
 owner.combatant=a;
 await interceptAttack.call(a.attack,async()=>{throw Error('no d20');});
 assert.equal(flags.get('ledger').entries[0][1].total,1);
 await assert.rejects(interceptAttack.call(a.attack,async()=>{}),/TURN_SPENT/);
 owner.combatant=b;
 await interceptAttack.call(a.attack,async()=>{throw Error('same sheet should resolve as active Goblin 2');});
 assert.equal(flags.get('ledger').entries[0][1].total,2);
 assert.equal(damageCalls.length,1);assert.equal(damageCalls[0].goblin,2);
 await assert.rejects(interceptAttack.call(a.attack,async()=>{}),/TURN_SPENT/);
 assert.equal(damageCalls.length,1);
 target.actor.system.attributes.ac.value=oldAC;
});
test('the ordinary damage button cannot bypass Horde hit resolution',async()=>{
 const a=initiativeGoblin(1);owner.combatant=a;let called=0;
 assert.equal(await interceptDamage.call(a.attack,async()=>{called++;}),null);
 assert.equal(called,0);
 await interceptDamage.call(a.attack,async config=>{called++;assert.equal(config._yaHordeResolvedDamage,undefined);},
   {_yaHordeResolvedDamage:true,isCritical:false});
 assert.equal(called,1);
});
test('forcing a missed initiative attack rolls damage once and clears progress',async()=>{
 const oldAC=target.actor.system.attributes.ac.value;target.actor.system.attributes.ac.value=10;
 const a=initiativeGoblin(1),b=initiativeGoblin(2);owner.combatant=a;
 game.user.targets=new Set([{document:target}]);
 await interceptAttack.call(a.attack,async()=>{});
 await interceptAttack.call(a.attack,async()=>{},{hordeForceHit:true});
 assert.equal(damageCalls.length,1);assert.equal(flags.get('ledger').entries[0][1].total,0);
 await assert.rejects(interceptAttack.call(a.attack,async()=>{},{hordeForceHit:true}),/TURN_SPENT/);
 owner.combatant=b;await interceptAttack.call(a.attack,async()=>{});
 assert.equal(flags.get('ledger').entries[0][1].total,1);assert.equal(damageCalls.length,1);
 target.actor.system.attributes.ac.value=oldAC;
});
test('force hit before the first attack consumes the turn and cannot be spammed',async()=>{
 const a=initiativeGoblin(1);owner.combatant=a;game.user.targets=new Set([{document:target}]);
 await interceptAttack.call(a.attack,async()=>{},{hordeForceHit:true});
 assert.equal(damageCalls.length,1);assert.equal(flags.get('ledger').entries[0][1].total,0);
 await assert.rejects(interceptAttack.call(a.attack,async()=>{}),/TURN_SPENT/);
});
test('configured multiattack allows two attempts and rejects the third',async()=>{
 const a=initiativeGoblin(1,2);owner.combatant=a;game.user.targets=new Set([{document:target}]);
 await interceptAttack.call(a.attack,async()=>{});await interceptAttack.call(a.attack,async()=>{});
 assert.equal(flags.get('ledger').turns.length,2);
 await assert.rejects(interceptAttack.call(a.attack,async()=>{}),/TURN_SPENT/);
});
test('initiative turn limits refresh next round without resetting target progress',async()=>{
 const a=initiativeGoblin(1);owner.combatant=a;game.user.targets=new Set([{document:target}]);
 await interceptAttack.call(a.attack,async()=>{});owner.round=2;
 await interceptAttack.call(a.attack,async()=>{});
 assert.equal(flags.get('ledger').entries[0][1].total,2);
});
test('changing target or sheet cannot bypass the initiative attack limit',async()=>{
 const a=initiativeGoblin(1),b=initiativeGoblin(2);owner.combatant=a;
 game.user.targets=new Set([{document:target}]);await interceptAttack.call(a.attack,async()=>{});
 await assert.rejects(interceptAttack.call(b.attack,async()=>{}),/TURN_SPENT/);
 const oldLookup=globalThis.fromUuid;
 const other={...target,uuid:'Scene.x.Token.other'};
 globalThis.fromUuid=async id=>id===other.uuid?other:oldLookup(id);
 try {game.user.targets=new Set([{document:other}]);await assert.rejects(interceptAttack.call(a.attack,async()=>{}),/TURN_SPENT/);}
 finally {globalThis.fromUuid=oldLookup;}
});
test('force hit clears only this Horde and target, preserving progress against others',async()=>{
 const a=initiativeGoblin(1);owner.combatant=a;game.user.targets=new Set([{document:target}]);
 await interceptAttack.call(a.attack,async()=>{});
 flags.get('ledger').entries.push(['other',{group:'Horde',target:'Scene.x.Token.other',total:7,sources:[],lane:1}]);
 await interceptAttack.call(a.attack,async()=>{},{hordeForceHit:true});
 const entries=flags.get('ledger').entries;
 assert.equal(entries.find(([k])=>k==='other')[1].total,7);
 assert.equal(entries.find(([k])=>k!=='other')[1].total,0);
});
test('an attack dialog from a previous initiative turn cannot spend the new combatant’s action',async()=>{
 const a=initiativeGoblin(1),b=initiativeGoblin(2);owner.combatant=b;
 await assert.rejects(resolve({doc:a.token,actor:a.actor,activity:a.attack,
  options:{...opts,group:'Horde',count:1,turnGuard:{combat:owner.uuid,combatant:a.uuid,round:owner.round}}}));
 assert.equal(flags.size,0);assert.equal(damageCalls.length,0);
});
test('simultaneous clicks on one sheet consume only one initiative attack',async()=>{
 const a=initiativeGoblin(1);owner.combatant=a;game.user.targets=new Set([{document:target}]);
 const results=await Promise.allSettled([interceptAttack.call(a.attack,async()=>{}),interceptAttack.call(a.attack,async()=>{})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(flags.get('ledger').turns.length,1);
 assert.equal(flags.get('ledger').entries[0][1].total,1);
});

 test('second multiattack completes the shared target progress rather than a separate slot',async()=>{
 const oldAC=target.actor.system.attributes.ac.value;target.actor.system.attributes.ac.value=10;
 try {
 const a=initiativeGoblin(1,2);owner.combatant=a;game.user.targets=new Set([{document:target}]);
 await interceptAttack.call(a.attack,async()=>{});assert.equal(damageCalls.length,0);
 await interceptAttack.call(a.attack,async()=>{});assert.equal(damageCalls.length,1);
 assert.equal(flags.get('ledger').entries.length,1);assert.equal(flags.get('ledger').entries[0][1].total,2);
 await assert.rejects(interceptAttack.call(a.attack,async()=>{}),/TURN_SPENT/);
 } finally {target.actor.system.attributes.ac.value=oldAC;}
 });
 test('schema2 independent partial slots migrate without losing a completed hit',async()=>{
 const base={group:'Orcs',target:target.uuid,bonus:9,ac:19,total:1,sources:['old'],candidate:null};
 flags.set('ledger',{schema:2,scope:owner.uuid,entries:[['one',{...base,lane:1}],['two',{...base,lane:2}]],turns:[]});
 const result=await resolve({doc,actor,activity,options:{...opts,bonus:'9',count:1}});
 assert.equal(result.hits,1);assert.equal(damageCalls.length,1);assert.equal(result.plans[0].profiles.length,1);
 });

 test('the NPC sheet has one Horde menu before its source and XP elements',()=>{
 const oldHTMLElement=globalThis.HTMLElement,oldDocument=globalThis.document;
 class Element {
 constructor(kind='div'){this.kind=kind;this.children=[];this.dataset={};this.listeners={};}
 append(child){child.remove();this.children.push(child);child.parent=this;}
 prepend(child){child.remove();this.children.unshift(child);child.parent=this;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}
 addEventListener(name,fn){this.listeners[name]=fn;}
 querySelectorAll(selector){return this.children.flatMap(c=>[...(selector==='[data-ya-horde-key]'&&c.dataset.yaHordeKey?[c]:[]),...c.querySelectorAll(selector)]);}
 querySelector(selector){
 if(selector==='.window-header'||selector==='header')return this.children.find(c=>c.kind==='header')??null;
 if(selector==='.header-elements')return this.children.find(c=>c.kind==='header-elements')??null;
 const key=selector.match(/data-ya-horde-key="([^"]+)"/)?.[1];return this.querySelectorAll('[data-ya-horde-key]').find(c=>c.dataset.yaHordeKey===key)??null;
 }
 }
 try {
 globalThis.HTMLElement=Element;globalThis.document={createElement:kind=>new Element(kind)};
 const el=new Element(),header=new Element('header'),elements=new Element('header-elements'),source=new Element('source');
 el.append(header);header.append(elements);elements.append(source);
 for(const key of ['configure','forceHit','hordeSave']){const old=new Element('button');old.dataset.yaHordeKey=key;header.append(old);}
 const npc=initiativeGoblin(1);const app={actor:npc.actor,element:el};renderSheet(app,el);renderSheet(app,el);
 const buttons=el.querySelectorAll('[data-ya-horde-key]');assert.equal(buttons.length,1);assert.equal(buttons[0].textContent,'Horde');
 assert.equal(elements.children[0],buttons[0]);assert.equal(elements.children[1],source);
 } finally {globalThis.HTMLElement=oldHTMLElement;globalThis.document=oldDocument;}
 });
 test('the single Horde menu exposes configuration, force, save and splitting',async()=>{
 const previous=foundry.applications;let opened;
 foundry.applications={api:{DialogV2:{wait:async options=>{opened=options;return null;}}}};
 try {const npc=initiativeGoblin(1);await hordeMenu(npc.token,npc.actor);
 assert.deepEqual(opened.buttons.map(b=>b.action),['configure','force','save','split']);
 assert.equal(opened.buttons.find(b=>b.action==='split').disabled,true);
 } finally {foundry.applications=previous;}
 });
test('Split/Merge is available for selected single NPCs in the sheet menu and Token toolbar',async()=>{
 const previous=foundry.applications;let opened;
 foundry.applications={api:{DialogV2:{wait:async options=>{opened=options;return null;}}}};
 try {
 const a=initiativeGoblin(1),b=initiativeGoblin(2);canvas.tokens.controlled=[{document:a.token},{document:b.token}];
 await hordeMenu(a.token,a.actor);assert.equal(opened.buttons.find(b=>b.action==='split').disabled,false);
 const controls={tokens:{tools:{}}};sceneControls(controls);assert.ok(controls.tokens.tools.yaHordeSplitMerge);assert.equal(controls.tokens.tools.yaHordeSplitMerge.button,true);
 } finally {foundry.applications=previous;}
});
test('related world settings are hidden behind three restricted menu tiles and default HP stays maximal',()=>{
 const oldApps=foundry.applications,oldRegister=game.settings.register,oldMenu=game.settings.registerMenu,entries=[],menus=[];
 foundry.applications={api:{ApplicationV2:class{}}};game.settings.register=(id,key,data)=>entries.push({key,...data});game.settings.registerMenu=(id,key,data)=>menus.push({key,...data});
 try {hooks.init();assert.equal(menus.length,3);assert.ok(menus.every(m=>m.restricted));
 const related=entries.filter(e=>e.key.startsWith('size_')||['mergeInitiative','splitInitiative','splitHP','hordeHPMode','hordeHPFormula'].includes(e.key));
 assert.ok(related.length>=14);assert.ok(related.every(e=>e.config===false));assert.equal(entries.find(e=>e.key==='hordeHPMode').default,'max');
 } finally {foundry.applications=oldApps;game.settings.register=oldRegister;game.settings.registerMenu=oldMenu;}
});
