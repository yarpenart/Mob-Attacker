import {attackersNeeded,integer,serialQueue} from './logic.mjs';
import {syncPopulation,ID} from './population.mjs';
const queue=serialQueue();
export function saveCount(dc,bonus,count,forced=null,previous=0) {
  integer(count,1,200,'count');
  const threshold=attackersNeeded(dc,bonus);
  const successes=forced===null ? Math.floor((previous+count)/threshold)-Math.floor(previous/threshold) : integer(forced,0,count,'successes');
  return {count,successes,failures:count-successes,threshold,required:dc-bonus};
}
/** Resistances, immunities and per-creature rounding happen before multiplication. */
export function saveDamage(actor,parts,result,onSave='half') {
  const calculate=multiplier=>{
    const scaled=parts.map(part=>({...part,properties:new Set(part.properties ?? [])}));
    const summary=actor.calculateDamage(scaled,{multiplier});
    if (!summary) throw Error('Damage calculation canceled');
    return Math.max(0,summary.amount);
  };
  const failed=calculate(1),passed=onSave==='none'?0:calculate(onSave==='full'?1:0.5);
  return {failed,passed,total:failed*result.failures+passed*result.successes};
}
export function installSaves({t,esc,dialog,field,select,value,card,requireAuthority,authority=()=>game.user.isGM,settings,sourceFor,injectButton,root,guard}) {
  function sourceMessage(event) {
    const id=event?.target?.closest?.('[data-message-id]')?.dataset.messageId;
    return id ? game.messages.get(id) : null;
  }
  function bonusFormula(actor,ability) {
    const a=actor.system.abilities?.[ability];
    const {parts,data}=CONFIG.Dice.D20Roll.constructParts({mod:a?.mod,
      prof:a?.saveProf?.hasProficiency?a.saveProf.term:null,
      [`${ability}SaveBonus`]:a?.bonuses?.save,saveBonus:actor.system.bonuses?.abilities?.save,
      cover:ability==='dex'?actor.system.attributes.ac.cover:null},actor.getRollData());
    actor.addRollExhaustion?.(parts,data);
    return new Roll(parts.join('+') || '0',data).formula;
  }
  async function open(actor,config={}) {
    requireAuthority();
    const doc=sourceFor(actor);await syncPopulation(doc);actor=doc.actor ?? actor;
    const s=settings(doc,actor);if (!s.enabled || !s.count) throw Error(t('emptyHorde'));
    const origin=sourceMessage(config.event),activity=origin?.getAssociatedActivity?.();
    const ability=config.ability ?? 'dex';
    const choices=Object.entries(CONFIG.DND5E.abilities).map(([id,a])=>[id,game.i18n.localize(a.label ?? a)]);
    const opts=await dialog(t('hordeSave'),select('saveAbility','ability',choices,ability)
      +field('saveDC','dc',config.target ?? activity?.save?.dc?.value ?? 10,'number','min="1" step="1"')
      +field('saveBonus','bonus',bonusFormula(actor,ability))
      +select('saveOutcome','outcome',[['table',t('saveTable')],['forced',t('saveForced')]],'table')
      +field('saveSuccesses','successes',s.count,'number',`min="0" max="${s.count}" step="1"`)
      +field('saveDamage','damage','','text',`placeholder="${esc(t('saveDamagePlaceholder'))}"`)
      +select('damageType','damageType',Object.entries(CONFIG.DND5E.damageTypes).map(([id,d])=>[id,game.i18n.localize(d.label ?? d)]),'fire')
      +select('saveOnSuccess','onSave',[['none',t('none')],['half',t('half')],['full',t('full')]],activity?.damage?.onSave ?? 'half')
      +`<p>${esc(t('saveHint'))}</p>`,form=>({ability:value(form,'ability'),dc:integer(value(form,'dc'),1,1000,'DC'),
        bonus:value(form,'bonus'),forced:value(form,'outcome')==='forced'?integer(value(form,'successes'),0,s.count,'successes'):null,
        damage:value(form,'damage').trim(),damageType:value(form,'damageType').trim(),onSave:value(form,'onSave')}),t('resolveSave'));
    if (!opts || opts==='cancel') return null;
    // Rebuild native ability bonuses when the ability selector changed without an edited bonus.
    if (opts.ability!==ability && opts.bonus===bonusFormula(actor,ability)) opts.bonus=bonusFormula(actor,opts.ability);
    return resolveSave({doc,actor,options:{...opts,source:origin?.id,activity:activity?.uuid,count:s.count}});
  }
  async function resolveSave({doc,actor,options}) {
    return queue(async()=>{
      requireAuthority();await syncPopulation(doc);actor=doc.actor ?? actor;
      const s=settings(doc,actor);if (!s.enabled || !s.count) throw Error(t('emptyHorde'));
      const roll=await new Roll(options.bonus,actor.getRollData()).evaluate();
      if (!Number.isFinite(roll.total)) throw Error(t('bonusInvalid'));
      const source=options.source ? game.messages?.get(options.source) : null;
      const prior=source ? game.messages.contents.filter(message=>{const d=message.getFlag(ID,'save');return d?.source===source.id && d.target===doc.uuid && d.ability===options.ability && d.status!=='superseded';}) : [];
      if (prior.some(message=>['applied','applying'].includes(message.getFlag(ID,'save').status))) throw Error(t('saveAlreadyApplied'));
      if (prior.length && options.forced==null) throw Error(t('saveDuplicate'));
      const owner=source ?? (game.combat?.started ? game.combat : canvas.scene);
      const entries=owner.getFlag(ID,'saveLedger') ?? [];
      const key=JSON.stringify([s.group,options.ability,options.dc,roll.total]);
      const previous=entries.find(([k])=>k===key)?.[1] ?? 0;
      const result=saveCount(options.dc,roll.total,s.count,options.forced ?? null,previous);
      const data={...result,dc:options.dc,bonus:roll.total,ability:options.ability,target:doc.uuid,
        source:options.source ?? null,activity:options.activity ?? null,onSave:options.onSave ?? 'half',status:'pending',
        hp:actor.system.attributes.hp.value,initial:doc.getFlag(ID,'population')?.initial ?? s.count};
      const text=`<strong>${esc(actor.name)} — ${esc(t('hordeSave'))}</strong><p>${esc(t('saveSummary',{
        dc:data.dc,bonus:data.bonus,count:data.count,successes:data.successes,failures:data.failures,threshold:data.threshold}))}</p>`;
      let parts;
      if (options.damage) {
        const damageRoll=await new Roll(options.damage,actor.getRollData()).evaluate();
        if (!Number.isFinite(damageRoll.total) || damageRoll.total<0) throw Error(t('damageInvalid'));
        parts=[{value:damageRoll.total,type:options.damageType || undefined}];
      }
      const after=options.forced==null ? previous+s.count : 0;
      for (const old of prior) await old.update({[`flags.${ID}.save.status`]:'superseded'});
      await owner.setFlag(ID,'saveLedger',[...entries.filter(([k])=>k!==key),[key,after]]);
      const message=await card(actor,text);await message.setFlag(ID,'save',{...data,text});
      parts ??= source?.getFlag(ID,'saveDamage')?.parts;
      if (parts) await attachDamage(message,parts);
      return {message,result};
    });
  }
  async function attachDamage(message,parts) {
    const data=message.getFlag(ID,'save');if (!data || data.status!=='pending' || data.parts) return;
    const doc=await fromUuid(data.target);if (!doc?.actor) return;
    const damage=saveDamage(doc.actor,parts,data,data.onSave);
    await message.update({[`flags.${ID}.save`]:{...data,parts,damage},content:`<div class="ya-horde-card">${data.text}<p>${esc(t('saveDamageSummary',damage))}</p><button type="button" data-ya-horde-save-apply>${esc(t('applySaveDamage'))}</button></div>`});
  }
  async function apply(message) {
    return queue(async()=>{
      requireAuthority();const data=message.getFlag(ID,'save');
      if (!data?.parts || data.status!=='pending') throw Error(t('saveAlreadyApplied'));
      const doc=await fromUuid(data.target);await syncPopulation(doc);const actor=doc?.actor;
      if (!actor || settings(doc,actor).count!==data.count || actor.system.attributes.hp.value!==data.hp) throw Error(t('saveStale'));
      const damage=saveDamage(actor,data.parts,data,data.onSave);
      // Persist the lock before HP changes; never allow a second application on reload.
      await message.setFlag(ID,'save',{...data,status:'applying'});
      await actor.applyDamage(damage.total,{ignore:true});
      await syncPopulation(doc);
      await message.update({[`flags.${ID}.save.status`]:'applied',content:`<div class="ya-horde-card">${data.text}<p>${esc(t('saveDamageSummary',damage))}</p><p>${esc(t('saveApplied'))}</p></div>`});
      return damage;
    });
  }
  async function interceptSave(wrapped,config={},...args) {
    if (this.type!=='npc') return wrapped(config,...args);
    const doc=sourceFor(this);if (!settings(doc,this).enabled) return wrapped(config,...args);
    await open(this,config);return null;
  }
  async function interceptSaveDamage(wrapped,config={},...args) {
    const rolls=await wrapped(config,...args);
    if (!rolls?.length || !authority()) return rolls;
    const origin=sourceMessage(config.event);
    const parts=rolls.map(r=>({value:r.total,type:r.options?.type,properties:new Set(r.options?.properties ?? [])}));
    // Store Sets as arrays; reconstruct when the system calculates damage.
    for (const part of parts) part.properties=Array.from(part.properties);
    await queue(async()=>{
      if (origin) await origin.setFlag(ID,'saveDamage',{parts});
      for (const message of game.messages.contents) {
        const data=message.getFlag(ID,'save');
        if (data?.status==='pending' && !data.parts && data.activity===this.uuid && origin && data.source===origin.id) await attachDamage(message,parts);
      }
    });
    return rolls;
  }
  function render(message,html) {
    const button=root(html)?.querySelector('[data-ya-horde-save-apply]');if (!button) return;
    if (!game.user.isGM) {button.remove();return;}
    button.disabled=message.getFlag(ID,'save')?.status!=='pending';
    button.addEventListener('click',event=>{event.preventDefault();button.disabled=true;guard(()=>apply(message))();});
  }
  function sheet(app,html) {
    if (!game.user.isGM || app.actor?.type!=='npc') return;
    const el=root(html);injectButton(el?.querySelector('.window-header') ?? el?.querySelector('header'),t('hordeSave'),false,()=>open(app.actor),{key:'hordeSave'});
  }
  return {open,resolveSave,interceptSave,interceptSaveDamage,apply,render,sheet};
}
