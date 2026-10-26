import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mockSettings} from './test-settings.mjs';
import {splitNames,hordeLabel,assignMergedName,formatName,migrateSceneNames} from '../scripts/naming.mjs';
import {validatePatterns,validateThresholds,settingsUI} from '../scripts/settings.mjs';
import {SIZE_DEFAULTS,ID} from '../scripts/population.mjs';
beforeEach(()=>{globalThis.game={settings:mockSettings()};globalThis.foundry={utils:{deepClone:structuredClone}};});
function world(){const scene={tokens:new Map()};let id=0;return {scene,token(name='Goblin',flags={}){
 const doc={id:String(++id),actorId:'goblin',name,parent:scene,flags:{[ID]:flags},getFlag(id,key){return this.flags[id]?.[key];},async setFlag(id,key,value){this.flags[id]??={};this.flags[id][key]=structuredClone(value);},async unsetFlag(id,key){delete this.flags[id]?.[key];},async update(data){Object.assign(this,data);}};
 scene.tokens.set(doc.id,doc);return doc;
 },async split(doc,count){const names=await splitNames(doc,'Goblin',count);scene.tokens.delete(doc.id);return names.map(({name,meta})=>this.token(name,{naming:meta,horde:{enabled:true,count:1},population:{initial:1,current:1}}));},
 horde(){return this.token('Goblin (Horde)',{horde:{enabled:true,count:8},population:{initial:8,current:8}});}};}
test('map numbering: split 1–8 then 9–16, merge 6–13 as Horde 1, remaining as Horde 2',async()=>{
 const w=world(),a=w.horde(),b=w.horde();
 assert.equal(await hordeLabel(a,'Goblin'),'Goblin 1 (Horde)');a.name='Goblin 1 (Horde)';
 assert.equal(await hordeLabel(b,'Goblin'),'Goblin 2 (Horde)');b.name='Goblin 2 (Horde)';
 const first=await w.split(a,8),second=await w.split(b,8),all=[...first,...second];
 assert.deepEqual(all.map(t=>t.name),Array.from({length:16},(_,i)=>`Goblin ${i+1}`));
 const merge=async members=>{const anchor=members[0];anchor.flags[ID].horde.count=members.length;anchor.flags[ID].population.current=members.length;
 const result=await assignMergedName(anchor,'Goblin');anchor.name=result.name;for(const member of members.slice(1))w.scene.tokens.delete(member.id);return anchor;};
 const h1=await merge(all.slice(5,13));assert.equal(h1.name,'Goblin 1 (Horde)');assert.equal(h1.getFlag(ID,'naming').member,undefined);
 const remaining=[...all.slice(0,5),...all.slice(13)];assert.deepEqual(remaining.map(t=>t.name),['Goblin 1','Goblin 2','Goblin 3','Goblin 4','Goblin 5','Goblin 14','Goblin 15','Goblin 16']);
 const h2=await merge(remaining);assert.equal(h2.name,'Goblin 2 (Horde)');assert.equal(w.scene.tokens.size,2);
});
test('numbering ignores historical world counters and other scenes, reuses only free map numbers',async()=>{
 game.settings=mockSettings({namingCounters:{entries:[{key:'goblin',horde:100,number:900}]}});const w=world();
 w.token('Goblin 1');w.token('Goblin 3');w.token('Goblin 24');
 const names=await w.split(w.horde(),2);assert.deepEqual(names.map(t=>t.name),['Goblin 2','Goblin 4']);
 const other=world();assert.equal((await other.split(other.horde(),1))[0].name,'Goblin 1');
});
test('optional group.member mode still distinguishes split batches on the scene',async()=>{
 game.settings=mockSettings({splitNaming:'horde'});const w=world(),first=await w.split(w.horde(),8),second=await w.split(w.horde(),8);
 assert.equal(first[0].name,'Goblin 1.1');assert.equal(second.at(-1).name,'Goblin 2.8');
});
test('custom adjective-only names are supported and collisions gain a suffix',async()=>{
 game.settings=mockSettings({splitNaming:'custom',splitNamePattern:'{adjective} {name}',namingAdjectives:'Angry'});const w=world();
 const names=await splitNames(w.horde(),'Goblin',3);assert.deepEqual(names.map(n=>n.name),['Angry Goblin','Angry Goblin 2','Angry Goblin 3']);
});
test('numbered and adjective Hordes preserve their identities and the Horde suffix',async()=>{
 game.settings=mockSettings({hordeNaming:'number',hordeAdjectives:true,namingAdjectives:'Bold'});const w=world(),a=w.horde(),b=w.horde();
 assert.equal(await hordeLabel(a,'Goblin'),'Bold Goblin 1 (Horde)');assert.equal(await hordeLabel(a,'Goblin'),'Bold Goblin 1 (Horde)');assert.equal(await hordeLabel(b,'Goblin'),'Bold Goblin 2 (Horde)');
 game.settings.values.set('hordeNaming','adjective');assert.equal(await hordeLabel(a,'Goblin'),'Bold Goblin (Horde)');a.name='Bold Goblin (Horde)';assert.equal(await hordeLabel(b,'Goblin'),'Bold Goblin 2 (Horde)');
});
test('concurrent reservations do not reuse numbers',async()=>{
 const w=world(),[a,b]=await Promise.all([splitNames(w.horde(),'Goblin',8),splitNames(w.horde(),'Goblin',8)]);
 assert.equal(new Set([...a,...b].map(n=>n.name)).size,16);
});
test('upgrade compacts existing Hordes once, keeps member labels and custom settings',async()=>{
 const w=world(),a=w.horde(),b=w.horde();a.name='Goblin 10 (Horde)';b.name='Goblin 12 (Horde)';a.flags[ID].naming={horde:10};b.flags[ID].naming={horde:12};
 a.flags[ID].population.baseName=b.flags[ID].population.baseName='Goblin';
 const single=w.token('Goblin 16',{naming:{number:16},horde:{enabled:true,count:1}});game.scenes=new Map([['scene',w.scene]]);game.combats=new Map();
 game.settings=mockSettings({splitNaming:'horde',hordeNaming:'number'});await migrateSceneNames();
 assert.equal(a.name,'Goblin 1 (Horde)');assert.equal(b.name,'Goblin 2 (Horde)');assert.equal(single.name,'Goblin 16');assert.equal(game.settings.get(ID,'splitNaming'),'continuous');
 await migrateSceneNames();assert.equal(b.name,'Goblin 2 (Horde)');
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

test('recursive Foundry flag merging cannot leave member metadata on a merged Horde',async()=>{
 const w=world(),member=w.token('Goblin 6',{naming:{horde:10,member:6,number:6,reservedNumbers:[8]},horde:{enabled:true,count:8}});
 member.setFlag=async function(id,key,value){this.flags[id][key]={...this.flags[id][key],...structuredClone(value)};};
 const result=await assignMergedName(member,'Goblin');assert.equal(result.name,'Goblin 1 (Horde)');assert.equal(member.getFlag(ID,'naming').member,undefined);assert.equal(member.getFlag(ID,'naming').reservedNumbers,undefined);
});
