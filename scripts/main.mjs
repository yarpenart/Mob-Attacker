import {migrateSceneNames} from './naming.mjs';
import {settingsUI} from './settings.mjs';
import {mergeTokens} from './merge.mjs';
import {splitToken} from './split.mjs';
import {installSaves} from './saves.mjs';
import {syncPopulation,populationActorUpdated,SIZE_DEFAULTS,sizeThresholds,syncHordeName} from './population.mjs';
import { TABLE, integer, planAttack, nextLane, parseCommand, parseMarkedRoll, serialQueue, damageAssignments, reserveTurn, bucketKey, resolveMob } from './logic.mjs';
export const ID = 'yarpenart-mob-attacker';
const enqueue = serialQueue();
const forceActions=new Map();
let language = {};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const t = (key, vars = {}) => Object.entries(vars).reduce((s, [k,v]) => s.replaceAll(`{${k}}`, String(v)), language[key] ?? game.i18n.localize(`HORDE.${key}`));
const notifyError = error => { console.error(`${ID} |`, error); ui.notifications.error(error.message === 'TURN_SPENT' ? t('turnSpent') : error.message === 'DUPLICATE' ? t('duplicate') : `${t('error')}: ${error.message}`); };
const guard = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(notifyError);
const root = html => html instanceof HTMLElement ? html : html?.[0];
function authority() {
  return game.user.isGM && game.users.filter(u => u.active && u.isGM).sort((a,b) => a.id.localeCompare(b.id))[0]?.id === game.user.id;
}
function requireAuthority() { if (!authority()) throw new Error(t('authority')); }
function defaults(actor) { return { enabled:false, count:1, attackLimit:1, group:actor.name || actor.id, bonus:'0', damage:'1d6' }; }
function settings(doc, actor = doc.actor ?? doc) {
  return {...defaults(actor), ...(actor.getFlag(ID, 'horde') ?? {}), ...(doc !== actor ? doc.getFlag(ID, 'horde') ?? {} : {})};
}
function sourceFor(actor) {
  if (actor.token) return actor.token;
  const controlled = canvas.tokens?.controlled?.filter(token => token.actor?.id === actor.id) ?? [];
  if (controlled.length === 1) return controlled[0].document;
  const current = game.combat?.combatant;
  if (current?.actor?.id === actor.id && current.token) return current.token;
  const matches = canvas.tokens?.placeables?.filter(token => token.actor?.id === actor.id) ?? [];
  if (matches.length === 1) return matches[0].document;
  if (matches.length > 1) throw new Error(t('selectSource'));
  return actor;
}
function selectedSource() {
  const current=game.combat?.started && game.combat.combatant;
  if (current?.actor?.type==='npc' && current.token) return {doc:current.token,actor:current.actor};
  const tokens = canvas.tokens?.controlled ?? [];
  if (tokens.length !== 1 || tokens[0].actor?.type !== 'npc') throw new Error(t('selectSource'));
  return {doc:tokens[0].document, actor:tokens[0].actor};
}
export function attackContext(activity, fallbackActor=activity?.actor) {
  const combat=game.combat, current=combat?.started && combat.combatant;
  if (!current) return {doc:sourceFor(fallbackActor),actor:fallbackActor,activity};
  if (current.actor?.type!=='npc' || !current.token) throw new Error(t('activeNPC'));
  const actor=current.actor;
  if (activity && actor!==activity.actor) {
    const items=Array.from(actor.items?.values?.() ?? actor.items ?? []);
    const item=actor.items.get(activity.item.id) ?? items.find(i=>i.name===activity.item.name && i.type===activity.item.type);
    const activities=Array.from(item?.system.activities?.values?.() ?? item?.system.activities ?? []);
    const equivalent=item?.system.activities?.get(activity.id) ?? activities.find(a=>a.type==='attack' && a.name===activity.name);
    if (equivalent) activity=equivalent;
  }
  return {doc:current.token,actor,activity,combatant:current,
    guard:{combat:combat.uuid,combatant:current.uuid ?? current.id,round:combat.round}};
}
function ledgerOwner() { return game.combat?.started ? game.combat : canvas.scene; }
function scopeFor(owner) { return owner.uuid; }
function ledger(owner) {
  const state = owner.getFlag(ID, 'ledger');
  if ([2,3].includes(state?.schema) && state.scope === scopeFor(owner) && Array.isArray(state.entries)) {
    const buckets={};
    for (const [oldKey,stored] of foundry.utils.deepClone(state.entries)) {
      if (state.schema===3) {buckets[oldKey]=stored;continue;}
      const key=bucketKey({...stored,lane:1}),previous=buckets[key],threshold=resolveMob(stored.ac,stored.bonus,1).threshold;
      const sources=(stored.sources ?? []).map(s=>`${s}::slot:${stored.lane}`);
      const total=(previous?.total ?? 0)+(stored.total ?? 0);
      const pending=(previous?.pendingHits ?? 0)+Math.floor(total/threshold)-Math.floor((previous?.total ?? 0)/threshold)-Math.floor((stored.total ?? 0)/threshold);
      buckets[key]={...stored,lane:1,total,pendingHits:pending,sources:[...(previous?.sources ?? []),...sources],
        candidate:previous?.candidate?.average>stored.candidate?.average ? previous.candidate : stored.candidate ?? previous?.candidate};
    }
    return {scope:state.scope,buckets,turns:foundry.utils.deepClone(state.turns ?? [])};
  }
  return {scope:scopeFor(owner),buckets:{},turns:[]};
}
async function saveLedger(owner,state) {
  // Dynamic UUIDs are VALUES inside an array, never dotted document update keys.
  // Arrays are replaced atomically, also preventing stale recursive bucket merges.
  await owner.setFlag(ID,'ledger',{schema:3,scope:state.scope,entries:Object.entries(state.buckets),turns:state.turns ?? []});
}
function rollMode() {
  const mode=game.settings.get('core',(game.release?.generation ?? 14) >= 14 ? 'messageMode' : 'rollMode');
  return mode === 'ic' ? 'public' : mode;
}
function visibilityMode(kind) {
  const modern={PUBLIC:'public',PRIVATE:'gm',BLIND:'blind',SELF:'self'}[kind];
  return CONFIG.ChatMessage?.modes?.[modern] ? modern : CONST.DICE_ROLL_MODES[kind];
}
export function visibilityChoices() {
  return Object.entries(CONFIG.ChatMessage?.modes ?? CONFIG.Dice.rollModes ?? {}).map(([key,config]) => {
    const label=typeof config === 'string' ? config : config?.label;
    return [key,typeof label === 'string' ? game.i18n.localize(label) : key];
  });
}
export async function toggleTokens(tokens = canvas.tokens?.controlled ?? []) {
  requireAuthority();
  const docs=[...new Map(tokens.map(token => token.document ?? token).filter(doc => doc.actor?.type === 'npc').map(doc => [doc.id,doc])).values()];
  if (!docs.length) throw new Error(t('selectMany'));
  const enabled=!docs.every(doc => settings(doc).enabled);
  const group=docs.find(doc => settings(doc).enabled)?.getFlag(ID,'horde')?.group
    ?? docs.map(doc => doc.getFlag(ID,'horde')?.group).find(Boolean) ?? 'Horde';
  const updates=docs.map(doc => ({_id:doc.id,[`flags.${ID}.horde`]:{...settings(doc),enabled,...(enabled ? {group} : {})}}));
  await canvas.scene.updateEmbeddedDocuments('Token',updates);
  for (const doc of docs) await syncPopulation(doc);
  ui.combat?.render(); ui.controls?.render();
  ui.notifications.info(t(enabled ? 'markedMany' : 'unmarkedMany',{count:docs.length}));
  return {enabled,count:docs.length,group};
}
export function sceneControls(controls) {
  if (!game.user.isGM || !controls.tokens?.tools) return;
  controls.tokens.tools.yaHordeToggle={name:'yaHordeToggle',title:t('toggleSelected'),icon:'fa-solid fa-people-group',
    order:Object.keys(controls.tokens.tools).length,button:true,visible:true,onChange:guard(() => toggleTokens())};
  controls.tokens.tools.yaHordeSplitMerge={name:'yaHordeSplitMerge',title:t('splitMergeHorde'),icon:'fa-solid fa-arrows-split-up-and-left',order:Object.keys(controls.tokens.tools).length,button:true,visible:true,onChange:guard(()=>splitMergeHorde())};
}
Hooks.on('getSceneControlButtons',sceneControls);
function dialog(title, content, callback, label = t('save')) {
  return foundry.applications.api.DialogV2.wait({
    window:{title}, classes:['ya-horde-dialog'], position:{width:500},
    content:`<div class="ya-horde">${content}</div>`,
    buttons:[{action:'ok', label, default:true, callback:(_event, button) => callback(button.form)},
      {action:'cancel', label:t('cancel'), callback:() => null}],
    rejectClose:false
  });
}
const field = (label, name, value, type = 'text', extra = '') => `<label><span>${esc(t(label))}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const check = (label, name, value) => `<label><span>${esc(t(label))}</span><input type="checkbox" name="${name}" ${value ? 'checked' : ''}></label>`;
const select = (label, name, choices, value) => `<label><span>${esc(t(label))}</span><select name="${name}">${choices.map(([id,text]) => `<option value="${esc(id)}" ${String(value) === String(id) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
const value = (form, name) => form.elements.namedItem(name)?.value ?? '';
function configValues(form) {
  const group = value(form, 'group').trim();
  if (!group || group.length > 100) throw new Error(t('groupInvalid'));
  return { enabled:form.elements.namedItem('enabled').checked, count:integer(value(form,'count'),1,200,t('count')),
    group, attackLimit:integer(value(form,'attackLimit') || 1,1,10,t('attackLimit')), bonus:value(form,'bonus'), damage:value(form,'damage') };
}
function configFields(s) {
  return check('enabled','enabled',s.enabled) + field('group','group',s.group) + field('count','count',s.count,'number','min="1" max="200" step="1"')
    + field('attackLimit','attackLimit',s.attackLimit ?? 1,'number','min="1" max="10" step="1"');
}
export async function configure(doc, actor = doc.actor ?? doc) {
  requireAuthority();
  const s = settings(doc, actor), population=doc.getFlag(ID,'population');
  const result = await dialog(`${t('title')} — ${actor.name}`, configFields({...s,count:Math.max(1,s.count)})
    + (population ? `<p>${esc(t('populationInfo',{initial:population.initial,current:population.current,hp:population.baseHP}))}</p>` : '')
    + (population?.maxima ? `<p>${esc(t('memberMaxima',{values:population.maxima.join(', ')}))}</p>` : '')
    + `<p class="hint">${esc(t('configHint'))}</p>` + check('rerollHordeHP','rerollHP',false) + field('bonus','bonus',s.bonus) + field('damage','damage',s.damage), form=>({...configValues(form),rerollHP:form.elements.namedItem('rerollHP').checked}));
  if(result&&result!=='cancel'){const {rerollHP,...config}=result;await doc.setFlag(ID,'horde',{...s,...config});await syncPopulation(doc,{config:{...s,...config},reconfigure:true,rerollHP});ui.combat?.render();}
}
function targets() {
  const tokens = canvas.tokens?.placeables?.filter(token => token.actor && token.document.uuid) ?? [];
  const selected = Array.from(game.user.targets ?? []);
  return {choices: [['',t('chooseTarget')], ...tokens.map(token => [token.document.uuid, token.name])],
    selected:selected.length === 1 ? selected[0].document.uuid : ''};
}
function selectedMode(activity, config) {
  const choices = activity?.item.system.attackModes ?? [];
  const requested = config.attackMode ?? activity?.item.getFlag('dnd5e', `last.${activity.id}.attackMode`);
  return choices.some(c => c.value === requested) ? requested : choices[0]?.value;
}
function bonusFormula(activity, config, attackMode, ammunition) {
  const base = activity.getAttackData({attackMode, ammunition});
  const extra = config.rolls?.[0];
  return new Roll([...base.parts, ...(extra?.parts ?? [])].join('+') || '0', {...base.data, ...(extra?.data ?? {})}).formula;
}
export async function attackDialog({doc, actor, activity, config = {}, command = {}}) {
  const s = settings(doc,actor), target = targets();
  const mode = selectedMode(activity, config);
  const ammoChoices = activity?.item.system.ammunitionOptions ?? [];
  const ammo = config.ammunition ?? activity?.item.getFlag('dnd5e', `last.${activity.id}.ammunition`) ?? ammoChoices[0]?.value ?? '';
  const bonus = command.bonus ?? (activity ? bonusFormula(activity,config,mode,ammo) : s.bonus);
  const content = `<p><strong>${esc(activity?.item.name ?? command.name ?? actor.name)}</strong></p>`
    + configFields({...s, enabled:activity ? s.enabled : true, count:command.count ?? s.count})
    + select('target','target',target.choices,target.selected)
    + field('bonus','bonus',bonus)
    + (activity ? '' : field('damage','damage',command.damage ?? s.damage))
    + field('attacks','attacks',command.attacks ?? 1,'number','min="1" max="10" step="1"')
    + field('lane','lane','','text','placeholder="auto"')
    + (activity?.item.system.attackModes?.length ? select('mode','attackMode',activity.item.system.attackModes.map(c => [c.value,c.label]),mode) : '')
    + (ammoChoices.length ? select('ammo','ammunition',[['',t('none')],...ammoChoices.map(c => [c.value,c.label])],ammo) : '')
    + select('visibility','rollMode',visibilityChoices(),command.rollMode ?? config.rollMode ?? rollMode())
    + check('remember','remember',true)
    + check('forceHit','forceHit',config.hordeForceHit ?? command.forceHit ?? false)
    + `<p class="hint">${esc(t('attackHint'))}</p><p class="hint">${esc(t('modeHint'))}</p>`;
  return dialog(t('title'),content, form => {
    const result = {...configValues(form), target:value(form,'target'),
      attacks:integer(value(form,'attacks'),1,10,t('attacks')),
      lane:value(form,'lane').trim() ? integer(value(form,'lane'),1,1000,t('lane')) : null,
      remember:form.elements.namedItem('remember').checked,
      attackMode:value(form,'attackMode') || mode, ammunition:value(form,'ammunition') || undefined,
      rollMode:value(form,'rollMode'), attackName:command.name,forceHit:form.elements.namedItem('forceHit').checked};
    // Bonus is evaluated again from the chosen weapon mode/ammunition if those changed.
    if (activity && result.bonus === bonus && (result.attackMode !== mode || (result.ammunition ?? '') !== ammo)) {
      result.bonus = bonusFormula(activity,config,result.attackMode,result.ammunition);
    }
    if (activity) result.damage = s.damage;
    return result;
  },t('resolve'));
}
async function finiteBonus(formula, actor, mode) {
  const roll = new Roll(formula,actor.getRollData());
  await roll.evaluate();
  if (!Number.isFinite(roll.total)) throw new Error(t('bonusInvalid'));
  if (!roll.isDeterministic) await roll.toMessage({flavor:t('bonus'),speaker:ChatMessage.getSpeaker({actor})},{rollMode:mode});
  return roll.total;
}
async function card(actor, text) {
  const data = {speaker:ChatMessage.getSpeaker({actor}),content:`<div class="ya-horde-card">${text}</div>`,flags:{[ID]:{result:true}}};
  // Privacy is in the stored message, not a cosmetic client-side hide.
  data.whisper=game.users.filter(user => user.isGM).map(user => user.id);
  data.blind=false;
  return ChatMessage.create(data);
}
async function damageProfile(activity, actor, options) {
  const config = activity ? activity.getDamageConfig({isCritical:false,attackMode:options.attackMode,
    ammunition:actor.items.get(options.ammunition)}) : {rolls:[{parts:[options.damage],data:actor.getRollData(),options:{}}]};
  const rolls = (config.rolls ?? []).map(r => ({parts:[new Roll((r.parts ?? []).join('+') || '0',r.data ?? {}).formula],
    options:foundry.utils.deepClone(r.options ?? {}),base:r.base}));
  let average = 0;
  for (const r of rolls) {
    const low = await new Roll(r.parts[0]).evaluate({minimize:true});
    const high = await new Roll(r.parts[0]).evaluate({maximize:true});
    average += (low.total + high.total) / 2;
  }
  return {id:foundry.utils.randomID(),average,rolls,activityUuid:activity?.uuid,
    speaker:ChatMessage.getSpeaker({actor}),name:activity?.item.name ?? options.attackName ?? actor.name,
    flags:activity ? foundry.utils.deepClone(activity.messageFlags ?? {}) : {}};
}
async function damage(activity, actor, options, job, hit) {
  const profile=job.profiles[hit];
  if (!profile.rolls.length) return;
  if (profile.id !== job.currentProfileId) {
    const subject=profile.activityUuid ? await fromUuid(profile.activityUuid) : undefined;
    const rolls=await CONFIG.Dice.DamageRoll.build({isCritical:false,rolls:foundry.utils.deepClone(profile.rolls),
      hookNames:['damage'],subject}, {configure:false}, {rollMode:options.rollMode,data:{
        speaker:profile.speaker,flavor:profile.name,
        flags:{dnd5e:{...profile.flags,messageType:'roll',roll:{type:'damage'}},
          [ID]:{job:job.id,target:job.target,hit}}}});
    if (!rolls?.length) throw new Error(t('damageCanceled'));
    Hooks.callAll('dnd5e.rollDamage',rolls,{subject});
    Hooks.callAll('dnd5e.rollDamageV2',rolls,{subject});
    return;
  }
  if (activity) {
    const ammo = options.ammunition ? actor.items.get(options.ammunition) : undefined;
    if (!activity.getDamageConfig({isCritical:false,attackMode:options.attackMode,ammunition:ammo}).rolls?.length) return;
    const rolls = await activity.rollDamage({_yaHordeResolvedDamage:true,isCritical:false,attackMode:options.attackMode,ammunition:ammo},
      {configure:false}, {rollMode:options.rollMode, data:{speaker:ChatMessage.getSpeaker({actor}),flavor:activity.item.name,
        flags:{[ID]:{job:job.id,target:job.target,hit}}}});
    if (!rolls?.length) throw new Error(t('damageCanceled'));
  } else {
    const roll = await new CONFIG.Dice.DamageRoll(options.damage,actor.getRollData(),{isCritical:false}).evaluate();
    await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),flavor:esc(job.name),
      flags:{[ID]:{job:job.id,target:job.target,hit}}},{rollMode:options.rollMode});
  }
}
async function consumeAmmunition(activity, actor, options, attempts) {
  if (!activity) return;
  let item = options.ammunition ? actor.items.get(options.ammunition) : undefined;
  if (!item && options.attackMode?.startsWith('thrown')) item = activity.item;
  if (!item || item.system.properties?.has('ret')) return;
  const quantity = Number(item.system.quantity);
  if (!Number.isFinite(quantity) || quantity < attempts) throw new Error(t('noAmmo'));
  // Keep depleted items (also when autoDestroy is enabled), so all damage rolls can resolve their data.
  await actor.updateEmbeddedDocuments('Item',[{_id:item.id,'system.quantity':quantity-attempts}]);
}
export async function resolve({doc,actor,activity,options}) {
  return enqueue(async () => {
    requireAuthority();
    const context=game.combat?.started && game.combat.combatant ? attackContext(activity,actor) : null;
    if (context) {
      if (options.turnGuard && JSON.stringify(options.turnGuard)!==JSON.stringify(context.guard)) throw new Error(t('turnChanged'));
      ({doc,actor,activity}=context);
    }
    if (actor.type !== 'npc' || !options.enabled) throw new Error(t('npcOnly'));
    const populationConfig=options.remember ? {...settings(doc,actor),enabled:options.enabled,count:options.count,group:options.group,attackLimit:options.attackLimit ?? settings(doc,actor).attackLimit} : undefined;
    await syncPopulation(doc,{config:populationConfig,reconfigure:!!options.remember});
    actor=doc.actor ?? actor;
    if (doc.getFlag(ID,'population')) options={...options,count:settings(doc,actor).count};
    if (!options.count) throw new Error(t('emptyHorde'));
    const owner = ledgerOwner();
    if (!owner) throw new Error(t('noScene'));
    const target = await fromUuid(options.target);
    if (!target?.actor || target.parent?.id !== canvas.scene.id) throw new Error(t('chooseTarget'));
    const ac = Number(target.actor.system.attributes.ac.value);
    if (!Number.isFinite(ac)) throw new Error(t('acInvalid'));
    const state = ledger(owner);
    const reservation=context ? reserveTurn(state,{combatant:context.guard.combatant,round:context.guard.round,
      target:target.uuid,group:options.group,attacks:options.forceHit ? 1 : options.attacks,
      limit:options.attackLimit ?? settings(doc,actor).attackLimit ?? 1,lane:options.lane,forceHit:options.forceHit}) : null;
    const bonus = await finiteBonus(options.bonus,actor,visibilityMode('PRIVATE'));
    // Validate manual damage before committing any counters.
    if (!activity) new CONFIG.Dice.DamageRoll(options.damage, actor.getRollData());
    const profile=await damageProfile(activity,actor,options);
    // Turn slots stop duplicate attempts; all slots feed one target bucket.
    const source=owner.documentName === 'Combat' ? `${context?.guard.combatant ?? doc.uuid}::round:${owner.round}`
      : `${doc.uuid}::attempt:${foundry.utils.randomID()}`;
    const firstLane = reservation?.firstLane ?? options.lane ?? nextLane(state,options.group,source);
    const plans = [];
    for (let index=0; index<(options.forceHit ? 1 : options.attacks); index++) {
      const slot=firstLane+index;
      const input={group:options.group,target:target.uuid,source:`${source}::slot:${slot}`,bonus,ac,count:options.count,lane:1};
      let plan;
      if (options.forceHit) {
        const key=bucketKey(input),previous=state.buckets[key];
        plan={key,result:{...resolveMob(ac,bonus,options.count,previous?.total ?? 0),hits:1,after:0,remainder:0},
          bucket:{...input,total:0,sources:[...new Set([...(previous?.sources ?? []),input.source])]}};
      } else plan=planAttack(state,input);
      const assignment=damageAssignments(state.buckets[plan.key]?.candidate,profile,
        plan.result.before,options.count,plan.result.threshold);
      plan.bucket.candidate=options.forceHit ? null : assignment.next;
      plan.profiles=options.forceHit ? [profile] : [...Array.from({length:state.buckets[plan.key]?.pendingHits ?? 0},()=>state.buckets[plan.key]?.candidate ?? profile),...assignment.profiles];
      state.buckets[plan.key] = plan.bucket;
      plans.push({...plan,lane:firstLane+index});
    }
    const jobs = plans.map(plan => ({id:foundry.utils.randomID(),hits:plan.result.hits,completed:0,
      profiles:plan.profiles,currentProfileId:profile.id,
      target:target.uuid,name:activity?.item.name ?? options.attackName ?? actor.name, lane:plan.lane}));
    const totalHits = jobs.reduce((sum,j) => sum+j.hits,0);
    if (options.forceHit) for (const bucket of Object.values(state.buckets)) {
      if (bucket.group===options.group && bucket.target===target.uuid) {bucket.total=0;bucket.candidate=null;bucket.pendingHits=0;}
    }
    if (reservation) {
      if (reservation.convert) {reservation.convert.forced=true;reservation.convert.hits=1;}
      else for (const plan of plans) state.turns.push({combatant:context.guard.combatant,round:context.guard.round,
        target:target.uuid,group:options.group,slot:plan.lane,hits:plan.result.hits,forced:!!options.forceHit});
    }
    // Preflight damage configuration too (e.g. missing weapon data).
    if (activity && totalHits) activity.getDamageConfig({isCritical:false,attackMode:options.attackMode,
      ammunition:actor.items.get(options.ammunition)});
    if (scopeFor(owner) !== state.scope) throw new Error(t('roundChanged'));
    if (context && JSON.stringify(context.guard)!==JSON.stringify(attackContext(activity,actor).guard)) throw new Error(t('turnChanged'));
    if (!reservation?.convert) await consumeAmmunition(activity,actor,options,options.count*(options.forceHit ? 1 : options.attacks));
    if (options.remember) await doc.setFlag(ID,'horde',{...settings(doc,actor),enabled:true,count:options.count,attackLimit:options.attackLimit ?? settings(doc,actor).attackLimit,group:options.group,bonus:options.bonus,damage:options.damage});
    await saveLedger(owner,state);
    const resultText = `<strong>${esc(options.group)} → ${esc(target.name)}</strong>${context ? `<p>${esc(t('initiativeAttacker',{name:actor.name}))}</p>` : ''}${options.forceHit ? `<p>${esc(t('forcedResult'))}</p>` : ''}<p>${esc(t('summary',{ac,bonus,count:options.count,hits:totalHits}))}</p>`
      + plans.map(p => `<p>${esc(t('progress',{lane:p.lane,need:p.result.required,threshold:p.result.threshold,
        before:p.result.before,after:p.result.after,hits:p.result.hits,remainder:p.result.remainder}))}</p>`).join('');
    let forceButton='';
    if (!totalHits) {
      const action=foundry.utils.randomID();
      forceActions.set(action,{doc,actor,activity,options:{...options,attacks:1,forceHit:true,remember:false,turnGuard:context?.guard}});
      if (forceActions.size>200) forceActions.delete(forceActions.keys().next().value);
      forceButton=`<button type="button" data-ya-horde-force="${esc(action)}">${esc(t('forceHit'))}</button>`;
    }
    const message = await card(actor,resultText+forceButton);
    let completed = 0;
    try {
      for (const job of jobs) for (let hit=0; hit<job.hits; hit++) {
        await damage(activity,actor,options,job,hit); completed++;
      }
    } catch (error) {
      await message.update({content:`<div class="ya-horde-card">${resultText}<p>${esc(t('partial',{completed,total:totalHits}))}</p></div>`});
      throw error;
    }
    Hooks.callAll(`${ID}.resolved`,{actor,activity,target,plans,hits:totalHits});
    return {hits:totalHits,plans};
  });
}
export async function interceptAttack(wrapped, config = {}, nativeDialog = {}, message = {}) {
  if (this.actor?.type !== 'npc') return wrapped(config,nativeDialog,message);
  const context=attackContext(this),{doc,actor}=context,activity=context.activity ?? this,s=settings(doc,actor);
  if (config.hordeForceHit && !s.enabled) throw new Error(t('npcOnly'));
  if (!s.enabled && (!game.user.isGM || !game.settings.get(ID,'promptUnmarked'))) return wrapped(config,nativeDialog,message);
  if (!authority()) { ui.notifications.warn(t('authority')); return null; }
  const chosen=Array.from(game.user.targets ?? []);
  const mode=selectedMode(activity,config);
  const ammo=config.ammunition ?? activity.item.getFlag('dnd5e',`last.${activity.id}.ammunition`)
    ?? activity.item.system.ammunitionOptions?.[0]?.value;
  const options=s.enabled && chosen.length === 1 && !game.settings.get(ID,'promptMarked')
    ? {...s,target:chosen[0].document.uuid,attacks:1,lane:null,remember:false,attackMode:mode,ammunition:ammo,
      bonus:bonusFormula(activity,config,mode,ammo),rollMode:message.rollMode ?? config.rollMode ?? rollMode(),forceHit:!!config.hordeForceHit}
    : await attackDialog({doc,actor,activity,config});
  if (!options || options === 'cancel') return null;
  if (!options.enabled) {
    if (options.remember) {await doc.setFlag(ID,'horde',{...s,enabled:false});await syncPopulation(doc);}
    return wrapped(config,nativeDialog,message);
  }
  if (!options.target) throw new Error(t('chooseTarget'));
  options.rollMode = message.rollMode ?? options.rollMode;
  options.turnGuard=context.guard;
  await resolve({doc,actor,activity,options});
  // Deliberately no fabricated d20 rolls or critical-hit events.
  return null;
}
export async function interceptDamage(wrapped,config={},...args) {
  if (config._yaHordeResolvedDamage) {
    const {_yaHordeResolvedDamage,...clean}=config;
    return wrapped(clean,...args);
  }
  if (this.actor?.type!=='npc') return wrapped(config,...args);
  const context=attackContext(this);
  if (!settings(context.doc,context.actor).enabled) return wrapped(config,...args);
  ui.notifications.warn(t('damageThroughAttack'));
  return null;
}
export async function forceFromSheet(actor) {
  requireAuthority();
  const activities=Array.from(actor.items?.values?.() ?? actor.items ?? [])
    .flatMap(item=>Array.from(item.system.activities?.values?.() ?? item.system.activities ?? []))
    .filter(activity=>activity.type==='attack');
  if (!activities.length) throw new Error(t('noAttack'));
  let chosen=activities[0];
  if (activities.length>1) {
    const result=await dialog(t('forceHit'),select('chooseAttack','attack',activities.map((a,i)=>[i,`${a.item.name} — ${a.name}`]),0),form=>value(form,'attack'),t('forceHit'));
    if (result===null || result==='cancel') return;
    chosen=activities[Number(result)];
  }
  return interceptAttack.call(chosen,()=>null,{hordeForceHit:true});
}
export function renderForceButtons(message,html) {
  const element=root(html);if (!element) return;
  for (const button of element.querySelectorAll('[data-ya-horde-force]')) {
    const action=button.dataset.yaHordeForce;
    if (!authority() || !forceActions.has(action)) {button.disabled=true;continue;}
    button.addEventListener('click',event=>{event.preventDefault();button.disabled=true;
      guard(async()=>{await resolve(forceActions.get(action));forceActions.delete(action);})();});
  }
}
async function resetCounters() {
  requireAuthority();
  const yes = await foundry.applications.api.DialogV2.confirm({window:{title:t('reset')},content:`<p>${esc(t('resetConfirm'))}</p>`});
  if (!yes) return;
  await enqueue(async () => {const owner = ledgerOwner(); if (owner) {await owner.unsetFlag(ID,'ledger');await owner.unsetFlag(ID,'saveLedger');}});
}
async function manual(command = {}) {
  requireAuthority();
  const {doc,actor} = selectedSource();
  const context=attackContext(undefined,actor);
  const options = await attackDialog({doc,actor,command});
  if (options && options !== 'cancel') {options.turnGuard=context.guard;await resolve({doc,actor,options});}
}
function tableHTML() {
  return `<table><thead><tr><th>${esc(t('needed'))}</th><th>${esc(t('threshold'))}</th></tr></thead><tbody>`
    + TABLE.map(([upper,n],i) => `<tr><td>${i ? TABLE[i-1][0]+1 : '≤1'}–${upper}</td><td>${n}</td></tr>`).join('') + '</tbody></table>';
}
async function help() {
  requireAuthority();
  await dialog(t('title'),`<p>${esc(t('help'))}</p>${tableHTML()}<p><code>/horde 5 | 1d6+3 | 8 | 1 | Orcs</code></p><p class="hint">${esc(t('rulesHint'))}</p>`,() => null,t('close'));
}
function injectButton(container, label, active, callback, {key='configure',context}={}) {
  if (!container || container.querySelector(`[data-ya-horde-key="${key}"]`)) return;
  const button = document.createElement('button'); button.type='button';
  button.className=`ya-horde-button ${active ? 'active' : ''}`;
  button.dataset.yaHordeKey=key;
  button.textContent=label; button.title=t('configure');
  button.addEventListener('click',event => {event.preventDefault(); event.stopPropagation(); guard(callback)();});
  if (context) {
    button.title=t('quickToggleHint');
    button.addEventListener('contextmenu',event => {event.preventDefault();event.stopPropagation();guard(context)();});
  }
  container.append(button);
}
export function renderTracker(app,html) {
  if (!game.user.isGM) return;
  const element=root(html); if (!element) return;
  const combat = app.viewed ?? game.combat;
  for (const row of element.querySelectorAll('[data-combatant-id]')) {
    const c = combat?.combatants.get(row.dataset.combatantId);
    if (c?.actor?.type !== 'npc') continue;
    const doc=c.token ?? c.actor,s=settings(doc,c.actor);
    injectButton(row.querySelector('.combatant-controls') ?? row,`Horde${s.enabled ? ` ×${s.count}` : ''}`,s.enabled,
      () => c.token ? toggleTokens([c.token]) : configure(doc,c.actor),{context:() => hordeMenu(doc,c.actor)});
  }
  injectButton(element.querySelector('.combat-tracker-header') ?? element.querySelector('header'),t('title'),false,help);
  injectButton(element.querySelector('.combat-tracker-header') ?? element.querySelector('header'),t('toggleSelected'),false,
    () => toggleTokens(),{key:'toggleSelected'});
}
export async function splitHorde(doc) {
  requireAuthority();
  return enqueue(async()=>{
    const result=await splitToken(doc,{mode:game.settings.get(ID,'splitHP'),requireAuthority});
    ui.combat?.render();ui.notifications.info(t('splitDone',{count:result.tokens.length}));return result;
  });
}
function selectedMergeMembers(doc) {
  const selected=(canvas.tokens?.controlled??[]).map(token=>token.document??token);
  return selected.length>1&&(!doc||selected.some(d=>d.uuid===doc.uuid)) ? selected : [];
}
export async function splitMergeHorde(doc) {
  requireAuthority();
  const selected=selectedMergeMembers(doc);
  if(selected.length>1) {
    return enqueue(async()=>{const result=await mergeTokens(selected,{preferred:doc,requireAuthority});ui.combat?.render();ui.notifications.info(t('mergeDone',{count:result.count}));return result;});
  }
  doc??=(canvas.tokens?.controlled?.length===1 ? canvas.tokens.controlled[0].document : null);
  if(doc&&settings(doc).enabled&&settings(doc).count>1)return splitHorde(doc);
  throw Error(t('mergeSelect'));
}
export async function hordeMenu(doc,actor=doc.actor ?? doc) {
  requireAuthority();
  const s=settings(doc,actor);
  const action=await foundry.applications.api.DialogV2.wait({window:{title:`Horde — ${actor.name}`},classes:['ya-horde-dialog','ya-horde-menu'],
    content:`<p>${esc(s.enabled ? t('menuPopulation',{count:s.count}) : t('menuUnmarked'))}</p>`,
    buttons:[{action:'configure',label:t('configure'),default:true,callback:()=> 'configure'},
      {action:'force',label:t('forceHit'),disabled:!s.enabled,callback:()=> 'force'},
      {action:'save',label:t('hordeSave'),disabled:!s.enabled,callback:()=> 'save'},
      {action:'split',label:t('splitMergeHorde'),disabled:!doc.actor||(!(s.enabled&&s.count>1)&&selectedMergeMembers(doc).length<2),callback:()=> 'split'}],rejectClose:false});
  if(action==='configure')return configure(doc,actor);
  if(action==='force')return forceFromSheet(actor);
  if(action==='save')return saves.open(actor);
  if(action==='split')return splitMergeHorde(doc);
}
export function renderSheet(app,html) {
  if (!game.user.isGM || app.actor?.type !== 'npc') return;
  const element=root(app.element) ?? root(html); if (!element) return;
  const header=element.querySelector('.window-header') ?? element.querySelector('header');if(!header)return;
  // Remove buttons left by a partial sheet render, then keep one menu before source/XP.
  for(const old of header.querySelectorAll('[data-ya-horde-key]'))if(old.dataset.yaHordeKey!=='hordeMenu')old.remove();
  const container=header.querySelector('.header-elements') ?? header;
  injectButton(container,'Horde',false,()=>{const doc=selectedMergeMembers().find(d=>d.actor?.id===app.actor.id)??sourceFor(app.actor);return hordeMenu(doc,doc.actor??app.actor);},{key:'hordeMenu'});
  const button=container.querySelector('[data-ya-horde-key="hordeMenu"]');
  if(button)container.prepend(button);
}
export function renderHUD(app,html) {
  if (!game.user.isGM) return;
  const doc=app.document ?? app.object?.document ?? app.object,actor=doc?.actor;
  if (actor?.type !== 'npc') return;
  const s=settings(doc,actor),container=root(html)?.querySelector('.col.right');
  // HUD instances reuse their DOM: always rebind to the currently bound token.
  for(const old of container?.querySelectorAll('[data-ya-horde-key]')??[])old.remove();
  injectButton(container,'Horde',s.enabled,() => hordeMenu(doc,actor),{key:'hudMenu'});
  const button=container?.querySelector('[data-ya-horde-key="hudMenu"]');
  if(button){button.classList?.add('control-icon');button.addEventListener('pointerdown',event=>event.stopPropagation());button.addEventListener('mousedown',event=>event.stopPropagation());}
}
let sizeTimer;
function scheduleSizes() {
  clearTimeout(sizeTimer);sizeTimer=setTimeout(()=>guard(async()=>{
    if(!authority())return;
    for(const base of Object.keys(SIZE_DEFAULTS))sizeThresholds(base);
    for(const scene of game.scenes?.values?.() ?? [])for(const token of scene.tokens.values()) {
      if(token.getFlag(ID,'population'))await syncPopulation(token);
    }
  })(),250);
}
async function loadLanguage() {
  const lang=game.settings.get(ID,'language');
  const response=await fetch(`modules/${ID}/lang/${lang}.json`);
  if (!response.ok) throw new Error('Could not load Horde language');
  language=(await response.json()).HORDE;
}
export async function interceptChat(wrapped,text,...args) {
  let plain=String(text ?? '').trim();
  if (plain.startsWith('<') && typeof DOMParser !== 'undefined') {
    plain=new DOMParser().parseFromString(plain,'text/html').body.textContent.trim();
  }
  const ours=/^\/horde(?:\s|$)/i.test(plain) || /\s#horde(?:\s*\||\s*$)/i.test(plain);
  if (!ours) return wrapped(text,...args);
  requireAuthority();
  const command=parseCommand(plain) ?? parseMarkedRoll(plain);
  if (!command) throw new Error(t('commandInvalid'));
  if (command.visibility) {
    command.rollMode=visibilityMode(/^(gmroll|gr)$/.test(command.visibility) ? 'PRIVATE'
      : /^(blindroll|broll|br)$/.test(command.visibility) ? 'BLIND'
      : /^(selfroll|sr)$/.test(command.visibility) ? 'SELF' : 'PUBLIC');
  }
  if (command.action === 'help') await help();
  else if (command.action === 'toggle') await toggleTokens();
  else if (command.action === 'save') {const s=selectedSource();await saves.open(s.actor);}
  else if (command.action === 'reset') await resetCounters();
  else if (command.action === 'config') {const s=selectedSource();await configure(s.doc,s.actor);}
  else await manual(command);
  // Consume commands before core validates unknown slash commands or rolls dice.
  return undefined;
}
export const saves=installSaves({t,esc,dialog,field,select,value,card,requireAuthority,authority,settings,sourceFor,injectButton,root,guard});
export const settingsPanels=settingsUI({t,esc,dialog,field,select,check,value,requireAuthority,notifyError,SIZE_DEFAULTS,scheduleSizes});
Hooks.once('init',() => {
  settingsPanels.register();
  game.settings.register(ID,'language',{name:'HORDE.language',scope:'client',config:true,type:String,choices:{en:'English',pl:'Polski'},default:'en',onChange:loadLanguage});
  game.settings.register(ID,'promptUnmarked',{name:'HORDE.promptUnmarked',hint:'HORDE.promptHint',scope:'world',config:true,type:Boolean,default:false});
  game.settings.register(ID,'mergeInitiative',{name:'HORDE.mergeInitiative',hint:'HORDE.mergeInitiativeHint',scope:'world',config:false,type:String,choices:{highest:'HORDE.initiativeHighest',median:'HORDE.initiativeMedian',lowest:'HORDE.initiativeLowest'},default:'median'});
  game.settings.register(ID,'splitInitiative',{name:'HORDE.splitInitiative',hint:'HORDE.splitInitiativeHint',scope:'world',config:false,type:String,choices:{shared:'HORDE.splitInitiativeShared',reroll:'HORDE.splitInitiativeReroll'},default:'shared'});
  game.settings.register(ID,'splitHP',{name:'HORDE.splitHP',hint:'HORDE.splitHPHint',scope:'world',config:false,type:String,choices:{equal:'HORDE.splitEqual',random:'HORDE.splitRandom'},default:'equal'});
  for(const [base,rules] of Object.entries(SIZE_DEFAULTS))for(const [size,n] of Object.entries(rules))game.settings.register(ID,`size_${base}_${size}`,{name:`HORDE.size_${base}_${size}`,hint:'HORDE.sizeThresholdHint',scope:'world',config:false,type:Number,range:{min:2,max:200,step:1},default:n,onChange:scheduleSizes});
  game.settings.register(ID,'promptMarked',{name:'HORDE.promptMarked',hint:'HORDE.promptMarkedHint',scope:'world',config:true,type:Boolean,default:false});
});
Hooks.once('ready',async () => {
  await loadLanguage();
  if (game.system.id !== 'dnd5e') return;
  if (!globalThis.libWrapper) {ui.notifications.error(t('libWrapper')); return;}
  libWrapper.register(ID,'CONFIG.DND5E.activityTypes.attack.documentClass.prototype.rollAttack',
    async function(wrapped,...args) {try {return await interceptAttack.call(this,wrapped,...args);} catch(error) {notifyError(error);return null;}},'MIXED');
  libWrapper.register(ID,'foundry.applications.sidebar.tabs.ChatLog.prototype.processMessage',
    async function(wrapped,...args) {try {return await interceptChat(wrapped,...args);} catch(error) {notifyError(error);return undefined;}},'MIXED');
  libWrapper.register(ID,'CONFIG.DND5E.activityTypes.attack.documentClass.prototype.rollDamage',
    async function(wrapped,...args) {try {return await interceptDamage.call(this,wrapped,...args);} catch(error) {notifyError(error);return null;}},'MIXED');
  libWrapper.register(ID,'CONFIG.Actor.documentClass.prototype.rollSavingThrow',
    async function(wrapped,...args) {try {return await saves.interceptSave.call(this,wrapped,...args);} catch(error) {notifyError(error);return null;}},'MIXED');
  libWrapper.register(ID,'CONFIG.DND5E.activityTypes.save.documentClass.prototype.rollDamage',
    async function(wrapped,...args) {try {return await saves.interceptSaveDamage.call(this,wrapped,...args);} catch(error) {notifyError(error);return null;}},'MIXED');
  game.modules.get(ID).api = {configure:() => {const s=selectedSource();return configure(s.doc,s.actor);},
    save:()=>{const s=selectedSource();return saves.open(s.actor);},resolveSave:saves.resolveSave,split:()=>splitHorde(selectedSource().doc),splitMerge:splitMergeHorde,mergeSelected:()=>splitMergeHorde(),attack:manual,reset:resetCounters,help,resolve,toggleSelected:toggleTokens};
  Hooks.on('updateActor',guard((actor,changes,options)=>authority() && populationActorUpdated(actor,changes,options)));
  Hooks.on('createCombatant',guard(c=>authority() && c.token?.getFlag(ID,'population') && syncHordeName(c.token,settings(c.token).count)));
  if(authority())await migrateSceneNames();
  if(authority())for(const scene of game.scenes?.values?.() ?? [])for(const token of scene.tokens.values()) {
    const population=token.getFlag(ID,'population');if(population)await syncHordeName(token,settings(token).enabled ? population.current : 1,population);
  }
  Hooks.on('renderCombatTracker',renderTracker);
  Hooks.on('renderActorSheetV2',renderSheet);
  Hooks.on('renderActorSheet',renderSheet);
  Hooks.on('renderTokenHUD',renderHUD);
  Hooks.on('renderChatMessageHTML',renderForceButtons);
  Hooks.on('renderChatMessageHTML',saves.render);
  ui.combat?.render();
  ui.controls?.render();
});
