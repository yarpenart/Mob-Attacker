import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attackersNeeded,resolveMob,planAttack,nextLane,parseCommand,serialQueue} from '../scripts/logic.mjs';
test('all table boundaries including natural 20 above the table',() => {
  const expected = [1,1,1,1,1,2,2,2,2,2,2,2,3,3,4,4,5,5,10,20];
  for (let needed=1;needed<=20;needed++) assert.equal(attackersNeeded(needed+5,5),expected[needed-1]);
  assert.equal(attackersNeeded(0,5),1); assert.equal(attackersNeeded(50,0),20);
});
test('eight orcs +5 versus AC19 score exactly two hits',() => {
  assert.deepEqual(resolveMob(19,5,8),{required:14,threshold:3,before:0,hits:2,after:8,remainder:2});
});
test('separate tokens pool progress and the third completes a hit',() => {
  const state={buckets:{}};
  for(let i=1;i<=3;i++) {
    const p=planAttack(state,{group:'orcs',target:'fighter',source:`orc${i}`,bonus:5,ac:19,count:1,lane:1});
    assert.equal(p.result.hits,i===3?1:0); state.buckets[p.key]=p.bucket;
  }
  assert.equal(nextLane(state,'orcs','orc1'),2);
  assert.throws(() => planAttack(state,{group:'orcs',target:'fighter',source:'orc1',bonus:5,ac:19,count:1,lane:1}),/DUPLICATE/);
});
test('target, group, bonus, AC and attack slot cannot borrow each other’s progress',() => {
  const base={group:'orcs',target:'A',source:'one',bonus:5,ac:19,count:2,lane:1};
  const p=planAttack({buckets:{}},base), state={buckets:{[p.key]:p.bucket}};
  for(const change of [{target:'B'},{group:'goblins'},{bonus:4},{ac:20},{lane:2}]) {
    assert.equal(planAttack(state,{...base,...change,source:'two',count:1}).result.before,0);
  }
});
test('multiattack uses independent slots and group size is not a hit multiplier',() => {
  for(let lane=1;lane<=2;lane++) assert.equal(planAttack({buckets:{}},{group:'orcs',target:'A',source:'group',bonus:5,ac:19,count:8,lane}).result.hits,2);
});
test('manual command accepts dice and optional counts without guessing ordinary chat',() => {
  assert.equal(parseCommand('/r 1d20+5'),null);
  assert.deepEqual(parseCommand('/horde 5+1d4 | 2d6[fire]+3 | 8 | 2 | Orcs'),{action:'attack',bonus:'5+1d4',damage:'2d6[fire]+3',count:8,attacks:2,name:'Orcs'});
  assert.deepEqual(parseCommand('/horde reset'),{action:'reset'});
  assert.throws(() => parseCommand('/horde 5 | 1d6 | -1'));
  assert.throws(() => parseCommand('/horde 5 | 1d6 | 1.5'));
});
test('concurrent requests serialize even after a failed operation',async () => {
  const q=serialQueue(), events=[];
  const a=q(async()=>{events.push(1);await Promise.resolve();events.push(2);});
  const b=q(async()=>{events.push(3);throw Error('failed');});
  const c=q(async()=>{events.push(4);});
  await Promise.allSettled([a,b,c]); assert.deepEqual(events,[1,2,3,4]);
});
test('split groups equal one combined group for every table row',() => {
  for(let ac=1;ac<=25;ac++) for(let a=1;a<=20;a++) for(let b=1;b<=20;b++) {
    const first=resolveMob(ac,0,a),second=resolveMob(ac,0,b,first.after);
    assert.equal(first.hits+second.hits,resolveMob(ac,0,a+b).hits);
  }
});
test('raw rolls require an explicit Horde marker and retain damage and visibility',async()=>{
  const {parseMarkedRoll}=await import('../scripts/logic.mjs');
  assert.equal(parseMarkedRoll('/r 1d20+5'),null);
  assert.deepEqual(parseMarkedRoll('/gmroll 1d20+5 #horde | 1d6+3'),{action:'attack',bonus:'+5',damage:'1d6+3',visibility:'gmroll'});
  assert.equal(parseMarkedRoll('/r 1d20 #horde').bonus,'0');
});
test('mixed damage chooses the strongest creature in each completed group only',async()=>{
  const {damageAssignments}=await import('../scripts/logic.mjs');
  const strong={id:'strong',average:12},weak={id:'weak',average:4};
  const result=damageAssignments(strong,weak,2,8,3);
  assert.deepEqual(result.profiles.map(p=>p.id),['strong','weak','weak']);
  assert.equal(result.next.id,'weak');
  assert.equal(damageAssignments(weak,strong,1,1,3).next.id,'strong');
  assert.equal(damageAssignments(strong,weak,2,1,3).next,null);
});
