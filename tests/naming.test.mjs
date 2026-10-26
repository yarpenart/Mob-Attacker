import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mockSettings} from './test-settings.mjs';
import {splitNames,hordeLabel,assignMergedName,formatName} from '../scripts/naming.mjs';
import {validatePatterns,validateThresholds,settingsUI} from '../scripts/settings.mjs';
import {SIZE_DEFAULTS,ID} from '../scripts/population.mjs';
beforeEach(()=>{globalThis.game={settings:mockSettings()};globalThis.foundry={utils:{deepClone:structuredClone}};});
function world(){const scene={tokens:new Map()};let id=0;return {scene,token(name='Goblin',flags={}){
 const doc={id:String(++id),actorId:'goblin',name,parent:scene,flags:{[ID]:flags},getFlag(id,key){return this.flags[id]?.[key];},async setFlag(id,key,value){this.flags[id]??={};this.flags[id][key]=structuredClone(value);}};
 scene.tokens.set(doc.id,doc);return doc;
 }};}
test('two Hordes split into distinct horde.member batches and keep counters after a reload',async()=>{
 const w=world(),a=w.token(),b=w.token();const first=await splitNames(a,'Goblin',8),second=await splitNames(b,'Goblin',8);
 assert.equal(first[0].name,'Goblin 1.1');assert.equal(first.at(-1).name,'Goblin 1.8');assert.equal(second[0].name,'Goblin 2.1');assert.equal(second.at(-1).name,'Goblin 2.8');
 const persisted=structuredClone(game.settings.get(ID,'namingCounters'));game.settings=mockSettings({namingCounters:persisted});
 const third=await splitNames(w.token(),'Goblin',1);assert.equal(third[0].name,'Goblin 3.1');
});
test('continuous numbering gives 1–16 across two eight-member splits and seeds existing numbers',async()=>{
 game.settings=mockSettings({splitNaming:'continuous'});const w=world(),first=await splitNames(w.token(),'Goblin',8),second=await splitNames(w.token(),'Goblin',8);
 assert.equal(first[0].name,'Goblin 1');assert.equal(second.at(-1).name,'Goblin 16');
 game.settings=mockSettings({splitNaming:'continuous'});w.token('Goblin 24');assert.equal((await splitNames(w.token(),'Goblin',1))[0].name,'Goblin 25');
});
test('custom adjective-only names are supported and collisions gain a suffix',async()=>{
 game.settings=mockSettings({splitNaming:'custom',splitNamePattern:'{adjective} {name}',namingAdjectives:'Angry'});const w=world();
 const names=await splitNames(w.token(),'Goblin',3);assert.deepEqual(names.map(n=>n.name),['Angry Goblin','Angry Goblin 2','Angry Goblin 3']);
});
test('numbered and adjective Hordes preserve their identities and the Horde suffix',async()=>{
 game.settings=mockSettings({hordeNaming:'number',hordeAdjectives:true,namingAdjectives:'Bold'});const w=world(),a=w.token(),b=w.token();
 assert.equal(await hordeLabel(a,'Goblin'),'Bold Goblin 1 (Horde)');assert.equal(await hordeLabel(a,'Goblin'),'Bold Goblin 1 (Horde)');assert.equal(await hordeLabel(b,'Goblin'),'Bold Goblin 2 (Horde)');
 game.settings.values.set('hordeNaming','adjective');assert.equal(await hordeLabel(a,'Goblin'),'Bold Goblin (Horde)');a.name='Bold Goblin (Horde)';assert.equal(await hordeLabel(b,'Goblin'),'Bold Goblin 2 (Horde)');
});
test('a merged group receives a new identity instead of reusing a numbered member identity',async()=>{
 const w=world(),a=w.token(),names=await splitNames(a,'Goblin',2);const member=w.token(names[0].name,{naming:names[0].meta});
 const assigned=await assignMergedName(member,'Goblin');assert.equal(assigned.identity.horde,2);assert.equal((await splitNames(member,'Goblin',2))[0].name,'Goblin 2.1');
});
test('concurrent reservations do not reuse numbers',async()=>{
 game.settings=mockSettings({splitNaming:'continuous'});const w=world(),[a,b]=await Promise.all([splitNames(w.token(),'Goblin',8),splitNames(w.token(),'Goblin',8)]);
 assert.equal(new Set([...a,...b].map(n=>n.name)).size,16);
});
test('settings panels validate templates and the full size rules before saving',()=>{
 assert.equal(formatName('{adjective} {name} {horde}.{member}',{name:'Goblin',horde:2,member:3}),'Goblin 2.3');
 assert.throws(()=>validatePatterns({splitNamePattern:'{unknown}',hordeNamePattern:'{name}'}));
 const values={};for(const [base,rules] of Object.entries(SIZE_DEFAULTS))for(const [size,n] of Object.entries(rules))values[`size_${base}_${size}`]=n;
 validateThresholds(values,SIZE_DEFAULTS);values.size_sm_huge=2;assert.throws(()=>validateThresholds(values,SIZE_DEFAULTS));
});
test('grouped settings expose three GM-only launchers and keep naming values hidden',()=>{
 const menus=[],settings=[];foundry.applications={api:{ApplicationV2:class{}}};game.settings.registerMenu=(id,key,data)=>menus.push({key,...data});game.settings.register=(id,key,data)=>settings.push({key,...data});
 settingsUI({SIZE_DEFAULTS}).register();assert.deepEqual(menus.map(m=>m.key),['sizes','splitMerge','naming']);assert.ok(menus.every(m=>m.restricted));assert.ok(settings.every(s=>s.config===false));
});
