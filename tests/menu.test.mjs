import {test} from 'node:test';
import assert from 'node:assert/strict';
class Element {
 constructor(kind='div'){this.kind=kind;this.children=[];this.dataset={};this.listeners={};}
 append(child){child.remove();this.children.push(child);child.parent=this;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}
 addEventListener(type,callback){this.listeners[type]=callback;}
 querySelectorAll(selector){return this.children.flatMap(child=>{
  const match=selector==='[data-combatant-id]' ? child.dataset.combatantId : selector.includes('data-ya-horde-key') ? child.dataset.yaHordeKey&&(selector==='[data-ya-horde-key]'||selector.includes(`"${child.dataset.yaHordeKey}"`)) : child.kind===selector;
  return [...(match?[child]:[]),...child.querySelectorAll(selector)];
 });}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
}
globalThis.HTMLElement=Element;globalThis.document={createElement:kind=>new Element(kind)};
globalThis.Hooks={once:()=>{},on:()=>{}};
const opened=[];
globalThis.foundry={applications:{api:{DialogV2:{wait:async options=>{opened.push(options);return null;}}}}};
globalThis.game={user:{id:'gm',isGM:true},users:[{id:'gm',isGM:true,active:true}],i18n:{localize:key=>key}};
globalThis.canvas={tokens:{controlled:[]}};
globalThis.ui={notifications:{error:error=>{throw Error(error);}}};
const {renderHUD,renderTracker}=await import('../scripts/main.mjs');
function npc(){const actor={id:'g',type:'npc',name:'Goblin',getFlag:()=>null};const doc={actor,id:'t',uuid:'Scene.s.Token.t',getFlag:()=>({enabled:true,count:8,group:'Goblins'})};actor.token=doc;return {actor,doc};}
const click=async(button,type)=>{let stopped=false;button.listeners[type]({preventDefault(){},stopPropagation(){stopped=true;}});await new Promise(resolve=>setImmediate(resolve));assert.equal(stopped,true);};
test('the token HUD keeps one functioning Horde menu and removes old split controls',async()=>{
 const {actor,doc}=npc(),root=new Element(),column=new Element('.col.right');root.append(column);
 for(const key of ['splitHorde','splitMergeHorde']){const old=new Element('button');old.dataset.yaHordeKey=key;column.append(old);}
 renderHUD({object:{document:doc,actor}},root);renderHUD({document:doc},root);
 const buttons=column.querySelectorAll('[data-ya-horde-key]');assert.equal(buttons.length,1);assert.equal(buttons[0].textContent,'Horde');
 await click(buttons[0],'click');assert.deepEqual(opened.at(-1).buttons.map(b=>b.action),['configure','force','save','split']);
});
test('right-clicking initiative Horde opens the same full action menu',async()=>{
 const {actor,doc}=npc(),row=new Element(),controls=new Element('.combatant-controls'),root=new Element();row.dataset.combatantId='c';row.append(controls);root.append(row);
 const combat={combatants:new Map([['c',{actor,token:doc}]])};renderTracker({viewed:combat},root);
 const button=controls.querySelector('[data-ya-horde-key="configure"]');assert.equal(button.textContent,'Horde ×8');
 await click(button,'contextmenu');assert.deepEqual(opened.at(-1).buttons.map(b=>b.action),['configure','force','save','split']);
 assert.equal(opened.at(-1).buttons.find(b=>b.action==='split').disabled,false);
});
test('reusing the same token HUD binds its button to the new token',async()=>{
 const first=npc(),second=npc();second.actor.name='Second Goblin';second.doc.id='second';second.doc.uuid='Scene.s.Token.second';
 const root=new Element(),column=new Element('.col.right');root.append(column);
 renderHUD({document:first.doc},root);const old=column.querySelector('[data-ya-horde-key="hudMenu"]');
 renderHUD({document:second.doc},root);const current=column.querySelector('[data-ya-horde-key="hudMenu"]');assert.notEqual(current,old);
 await click(current,'click');assert.equal(opened.at(-1).window.title,'Horde — Second Goblin');
 assert.ok(current.listeners.pointerdown);assert.ok(current.listeners.mousedown);
});
test('left-clicking the initiative Horde button opens a cancel-default confirmation instead of toggling immediately',async()=>{
 const {actor,doc}=npc(),row=new Element(),controls=new Element('.combatant-controls'),root=new Element();row.dataset.combatantId='c';row.append(controls);root.append(row);
 renderTracker({viewed:{combatants:new Map([['c',{actor,token:doc}]])}},root);
 const button=controls.querySelector('[data-ya-horde-key="configure"]');await click(button,'click');
 assert.deepEqual(opened.at(-1).buttons.map(b=>b.action),['cancel','confirm']);assert.equal(opened.at(-1).buttons.find(b=>b.default).action,'cancel');assert.equal(opened.at(-1).window.title,'HORDE.confirmUnmarkHordeTitle');
});
