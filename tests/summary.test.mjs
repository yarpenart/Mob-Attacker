import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summaryByUnit,finishCombat} from '../scripts/combat-memory.mjs';
const ID='yarpenart-mob-attacker';
test('summary separates Goblin, Giant Toad and Skeleton and combines members of the same type',()=>{
 const members=[{id:'g1',name:'Goblin',hp:0},{id:'g2',name:'Goblin',hp:4},{id:'g3',name:'Goblin',hp:0},{id:'t1',name:'Giant Toad',hp:9},{id:'s1',name:'Skeleton',hp:0}];
 const rows=summaryByUnit(members);
 assert.deepEqual(rows,[{name:'Giant Toad',total:1,killed:0,survived:1},{name:'Goblin',total:3,killed:2,survived:1},{name:'Skeleton',total:1,killed:1,survived:0}]);
 assert.equal(rows.reduce((n,r)=>n+r.total,0),members.length);assert.ok(rows.every(r=>r.total===r.killed+r.survived));
});
test('empty and unnamed unit data render predictable groups',()=>{
 assert.deepEqual(summaryByUnit([]),[]);assert.deepEqual(summaryByUnit([{hp:0},{name:' ',hp:1}]),[{name:'NPC',total:2,killed:1,survived:1}]);
});
test('private report renders per-type rows, escapes names and retains overall totals',async()=>{
 const flags={session:{id:'summary-types',members:[{id:'a',name:'Goblin',hp:0},{id:'b',name:'Goblin',hp:5},{id:'c',name:'Giant Toad',hp:1},{id:'d',name:'Skeleton',hp:0},{id:'e',name:'<script>',hp:1}]}};
 globalThis.foundry={utils:{deepClone:structuredClone}};
 globalThis.game={scenes:new Map(),messages:{contents:[]},users:[{id:'gm',isGM:true},{id:'player',isGM:false}],settings:{get:()=>true}};
 const combat={uuid:'Combat.summary',getFlag:(_id,key)=>flags[key],async unsetFlag(_id,key){delete flags[key];}};
 let message;globalThis.ChatMessage={create:async data=>{message=data;}};
 const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const totals=await finishCombat(combat,{esc,t:(key,values)=>values?JSON.stringify(values):key});
 assert.deepEqual(totals,{total:5,killed:2,survived:3});assert.deepEqual(message.whisper,['gm']);
 assert.match(message.content,/<th scope="row">Goblin<\/th><td>2<\/td><td>1<\/td><td>1<\/td>/);
 assert.match(message.content,/<th scope="row">Giant Toad<\/th><td>1<\/td><td>1<\/td><td>0<\/td>/);
 assert.match(message.content,/<th scope="row">Skeleton<\/th><td>1<\/td><td>0<\/td><td>1<\/td>/);
 assert.match(message.content,/&lt;script&gt;/);assert.doesNotMatch(message.content,/<script>/);
});
