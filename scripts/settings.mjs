import {NAMING_DEFAULTS,namingOptions,refreshNaming} from './naming.mjs';
const ID='yarpenart-mob-attacker';
export function validateThresholds(values,defaults){
 for(const [base,rules] of Object.entries(defaults)){let previous=1;
  for(const size of Object.keys(rules)){const n=Number(values[`size_${base}_${size}`]);
   if(!Number.isSafeInteger(n)||n<=previous||n>200)throw Error('Thresholds must strictly increase for each base size (2–200).');previous=n;
  }
 }
 return values;
}
export function validatePatterns(values){
 for(const key of ['splitNamePattern','hordeNamePattern']){
  const text=String(values[key]??'').trim();
  if(!text||text.length>200||!text.includes('{name}')||/[{}]/.test(text.replace(/\{(name|horde|member|number|adjective)\}/g,'')))throw Error('Name templates must include {name}, be 1–200 characters, and use only the listed placeholders.');
 }
 return values;
}
export function settingsUI({t,esc,dialog,field,select,check,value,requireAuthority,notifyError,SIZE_DEFAULTS,scheduleSizes}){
 const read=key=>game.settings.get(ID,key);
 const number=(label,key)=>field(label,key,read(key),'number','min="2" max="200" step="1"');
 function panelContent(kind){
  if(kind==='sizes')return `<p class="hint">${esc(t('sizeThresholdHint'))}</p>`+Object.entries(SIZE_DEFAULTS).map(([base,rules])=>`<fieldset><legend>${esc(t(`base_${base}`))}</legend>${Object.keys(rules).map(size=>number(`size_${base}_${size}`,`size_${base}_${size}`)).join('')}</fieldset>`).join('');
  if(kind==='splitMerge')return select('hordeHPMode','hordeHPMode',[['max',t('hordeHPMax')],['rolled',t('hordeHPRolled')]],read('hordeHPMode')??'max')
   +field('hordeHPFormula','hordeHPFormula',read('hordeHPFormula')??'')+`<p class="hint">${esc(t('hordeHPHint'))}</p>`
   +select('mergeInitiative','mergeInitiative',[['highest',t('initiativeHighest')],['median',t('initiativeMedian')],['lowest',t('initiativeLowest')]],read('mergeInitiative'))
   +`<p class="hint">${esc(t('mergeInitiativeHint'))}</p>`
   +select('splitInitiative','splitInitiative',[['shared',t('splitInitiativeShared')],['reroll',t('splitInitiativeReroll')]],read('splitInitiative'))
   +`<p class="hint">${esc(t('splitInitiativeHint'))}</p>`
   +select('splitHP','splitHP',[['equal',t('splitEqual')],['random',t('splitRandom')]],read('splitHP'))+`<p class="hint">${esc(t('splitHPHint'))}</p>`;
  const n=namingOptions();
  return `<fieldset><legend>${esc(t('splitNames'))}</legend>`
    +select('splitNaming','splitNaming',[['horde',t('nameHordeMember')],['continuous',t('nameContinuous')],['custom',t('nameCustom')]],n.splitNaming)
    +check('prependAdjective','splitAdjectives',n.splitAdjectives)+field('namePattern','splitNamePattern',n.splitNamePattern)
    +`<p class="hint">${esc(t('nameExamples'))}</p></fieldset><fieldset><legend>${esc(t('hordeNames'))}</legend>`
    +select('hordeNaming','hordeNaming',[['plain',t('namePlain')],['number',t('nameNumber')],['adjective',t('nameAdjective')],['custom',t('nameCustom')]],n.hordeNaming)
    +check('prependAdjective','hordeAdjectives',n.hordeAdjectives)+field('namePattern','hordeNamePattern',n.hordeNamePattern)
    +`</fieldset><label class="stacked"><span>${esc(t('adjectiveList'))}</span><textarea name="namingAdjectives" rows="4">${esc(n.namingAdjectives)}</textarea></label><p class="hint">${esc(t('adjectiveHint'))}</p><p class="hint">${esc(t('namePlaceholders'))}</p>`;
 }
 async function open(kind){
  requireAuthority();
  // Validate the complete panel before writing any settings.
  const result=await dialog(t(`${kind}Settings`),panelContent(kind),form=>{
   const keys=kind==='sizes'?Object.entries(SIZE_DEFAULTS).flatMap(([base,rules])=>Object.keys(rules).map(size=>`size_${base}_${size}`)):
     kind==='splitMerge'?['hordeHPMode','hordeHPFormula','mergeInitiative','splitInitiative','splitHP']:Object.keys(NAMING_DEFAULTS);
   const values=Object.fromEntries(keys.map(key=>[key,kind==='sizes'?Number(value(form,key)):typeof NAMING_DEFAULTS[key]==='boolean'?form.elements.namedItem(key).checked:value(form,key)]));
   if(kind==='sizes')validateThresholds(values,SIZE_DEFAULTS);if(kind==='naming')validatePatterns(values);
   return values;
  });
  if(!result||result==='cancel')return;
  for(const [key,stored] of Object.entries(result))if(read(key)!==stored)await game.settings.set(ID,key,stored);
  if(kind==='sizes')scheduleSizes();if(kind==='naming')await refreshNaming();
  return result;
 }
 function register(){
  const Base=foundry.applications.api.ApplicationV2;
  for(const [key,icon] of [['sizes','fa-expand'],['splitMerge','fa-arrows-split-up-and-left'],['naming','fa-tag']]){
   class SettingsLauncher extends Base {render(){open(key).catch(notifyError);return this;}}
   game.settings.registerMenu(ID,key,{name:`HORDE.${key}Settings`,label:'HORDE.openSettings',hint:`HORDE.${key}SettingsHint`,icon:`fa-solid ${icon}`,type:SettingsLauncher,restricted:true});
  }
  for(const [key,defaultValue] of Object.entries(NAMING_DEFAULTS))game.settings.register(ID,key,{scope:'world',config:false,type:typeof defaultValue==='boolean'?Boolean:String,default:defaultValue});
  game.settings.register(ID,'hordeHPMode',{scope:'world',config:false,type:String,default:'max'});
  game.settings.register(ID,'hordeHPFormula',{scope:'world',config:false,type:String,default:''});
  game.settings.register(ID,'sceneNamingVersion',{scope:'world',config:false,type:Number,default:0});
  game.settings.register(ID,'namingCounters',{scope:'world',config:false,type:Object,default:{entries:[]}});
 }
 return {open,register,panelContent};
}
