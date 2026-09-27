import {readFile} from 'node:fs/promises';
import {createContentRegistry} from '../src/content/ContentRegistry.js';
import {builtinPack} from '../src/content/builtin.js';
import {catalogues} from '../src/i18n/I18n.js';
const paths=process.argv.slice(2);
if(!paths.length)paths.push('examples/packs/harvest-relief.json');
const packs=await Promise.all(paths.map(async p=>JSON.parse(await readFile(p,'utf8'))));
const content=createContentRegistry([builtinPack,...packs]);
let checked=0;
for(const pack of packs)for(const d of [...(pack.definitions??[]),...(pack.patches??[])]){
  const definition=content.get(d.id);
  for(const locale of ['ko','en','ja'])if(!content.translations[locale][definition.labelKey]&&!catalogues[locale][definition.labelKey])throw Error(`${d.id}: missing ${locale} translation ${definition.labelKey}`);
  const v=definition.visual;
  if(v.path){const bytes=await readFile(v.path);if(bytes.subarray(1,4).toString()!=='PNG')throw Error(`${v.path}: expected PNG header`);
    const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);
    if(w!==v.width||h!==v.height)throw Error(`${d.id}: native ${w}x${h}, declared ${v.width}x${v.height}`);
    if(v.anchorX<0||v.anchorX>1||v.anchorY<0||v.anchorY>1)throw Error(`${d.id}: invalid pivot`);checked++;
  }
}
console.log(JSON.stringify({packs:content.packs,checkedImages:checked,rules:content.rules,storyChains:content.storyChains},null,2));
