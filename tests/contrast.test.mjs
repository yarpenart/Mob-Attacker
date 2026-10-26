import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const css=fs.readFileSync(new URL('../styles/horde.css',import.meta.url),'utf8');
function luminance(hex){const c=hex.slice(1).match(/../g).map(s=>parseInt(s,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
const ratio=(a,b)=>{const [bright,dark]=[luminance(a),luminance(b)].sort((a,b)=>b-a);return (bright+.05)/(dark+.05);};
function palette(text){return Object.fromEntries([...text.matchAll(/--ya-([\w-]+):\s*(#[\da-f]{6})/gi)].map(m=>[m[1],m[2]]));}
test('light and dark palettes give normal text, hints, inputs, errors and buttons AA contrast',()=>{
 const blocks=css.split('}').filter(block=>block.includes('--ya-bg:'));assert.ok(blocks.length>=2);
 for(const block of blocks){const p=palette(block);for(const [fg,bg] of [['fg','bg'],['muted','bg'],['fg','input'],['muted','input'],['error','bg'],['button-text','button']])assert.ok(ratio(p[fg],p[bg])>=4.5,`${fg}/${bg} = ${ratio(p[fg],p[bg])}`);}
});
test('HUD buttons opt into pointer events and long dialogs scroll in both themes',()=>{
 assert.match(css,/pointer-events:\s*auto\s*!important/);assert.match(css,/\.ya-horde-dialog \.window-content[^}]*overflow-y:\s*auto/);assert.match(css,/color-scheme:light/);assert.match(css,/color-scheme:dark/);
});
