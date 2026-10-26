import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
globalThis.Hooks={once(){},on(){}};
globalThis.foundry={applications:{api:{DialogV2:{}}}};
globalThis.game={user:{id:'gm',isGM:true},users:[{id:'gm',active:true,isGM:true}],i18n:{localize:key=>key}};
globalThis.ui={notifications:{info(){},warn(){}},combat:{render(){}},controls:{render(){}}};
globalThis.canvas={tokens:{controlled:[]},scene:{}};
const {confirmTrackerToggle}=await import('../scripts/main.mjs');
let writes,dialogs;
function npc(id,enabled){return {id,uuid:`Scene.s.Token.${id}`,name:'Goblin '+id,actor:{type:'npc',name:'Goblin',getFlag:()=>null},state:{enabled,count:1,group:'Goblins'},getFlag(_id,key){return key==='horde'?this.state:null;}};}
function scene(docs){canvas.scene.updateEmbeddedDocuments=async(type,updates)=>{writes++;assert.equal(type,'Token');for(const update of updates)docs.find(doc=>doc.id===update._id).state=update['flags.yarpenart-mob-attacker.horde'];};}
beforeEach(()=>{writes=0;dialogs=[];game.user.isGM=true;foundry.applications.api.DialogV2.wait=async config=>{dialogs.push(config);return 'cancel';};});
test('marking and unmarking require explicit confirmation; cancel, close and Enter default preserve state',async()=>{
 for(const enabled of [false,true])for(const result of ['cancel',null,undefined]){
  const doc=npc('a',enabled);scene([doc]);foundry.applications.api.DialogV2.wait=async config=>{dialogs.push(config);return result;};
  await confirmTrackerToggle([doc]);assert.equal(doc.state.enabled,enabled);assert.equal(writes,0);
  const options=dialogs.at(-1);assert.equal(options.modal,true);assert.equal(options.rejectClose,false);
  assert.equal(options.buttons.find(b=>b.default).action,'cancel');
 }
});
test('confirming marks or unmarks exactly once, with the proper action title',async()=>{
 for(const enabled of [false,true]){
  const doc=npc('a',enabled);scene([doc]);foundry.applications.api.DialogV2.wait=async config=>{dialogs.push(config);assert.equal(writes,enabled?1:0);return 'confirm';};
  await confirmTrackerToggle([doc]);assert.equal(doc.state.enabled,!enabled);
  assert.equal(dialogs.at(-1).window.title,enabled?'HORDE.confirmUnmarkHordeTitle':'HORDE.confirmMarkHordeTitle');
 }
 assert.equal(writes,2);
});
test('duplicate clicks open only one pending confirmation and cannot toggle twice',async()=>{
 const doc=npc('a',true);scene([doc]);let resolve;
 foundry.applications.api.DialogV2.wait=async config=>{dialogs.push(config);return new Promise(done=>{resolve=done;});};
 const first=confirmTrackerToggle([doc]);assert.equal(await confirmTrackerToggle([doc]),null);assert.equal(dialogs.length,1);
 resolve('confirm');await first;assert.equal(doc.state.enabled,false);assert.equal(writes,1);
});
test('a stale confirmation cannot reverse a membership change made while it was open',async()=>{
 const doc=npc('a',true);scene([doc]);foundry.applications.api.DialogV2.wait=async()=>{doc.state.enabled=false;return 'confirm';};
 await confirmTrackerToggle([doc]);assert.equal(writes,0);assert.equal(doc.state.enabled,false);
});
test('selected-token tracker control confirms a batch once before changing all members',async()=>{
 const docs=[npc('a',false),npc('b',false)];scene(docs);canvas.tokens.controlled=docs.map(document=>({document}));
 await confirmTrackerToggle();assert.equal(writes,0);
 foundry.applications.api.DialogV2.wait=async()=> 'confirm';await confirmTrackerToggle();assert.equal(writes,1);assert.ok(docs.every(doc=>doc.state.enabled));
});
