import { syncResourceTotals } from '../state/worldState.js';
import { recordEvent } from './EventJournal.js';
import { EQUIPMENT, GRADES } from '../content/equipment.js';
import { spendResources, resourceAmount, stockLimit } from '../state/economy.js';

export const equipmentSize = (item) => { const d=EQUIPMENT[item.definition]; return item.rotated?{w:d.h,h:d.w}:{w:d.w,h:d.h}; };
const fail=code=>({ok:false,code,messageKey:`gear.error.${code}`,messageParams:{}});
const ok=()=>({ok:true,messageKey:'gear.done',messageParams:{}});
export const storeCapacity = world => 20 + Math.min(4,[...world.state.buildings.values()].filter(b=>b.type==='warehouse'&&(b.damage??0)<100).length)*20;
export function initializeEquipment(world) {
  const h=world.state.hero;if(!h||h.equipment)return;
  h.equipment={version:1,sequence:0,revision:0,width:6,height:5,items:[],crafted:0,goals:{unique:false,mythic:false}};
  grantEquipment(world,'shortblade','common','legacy-starter');
}
export function grantEquipment(world,definition,grade,source,location='store') {
  const e=world.state.hero?.equipment;
  if(!e||!Object.hasOwn(EQUIPMENT,definition)||!Object.hasOwn(GRADES,grade))return false;
  if(e.items.filter(i=>i.location===location).length >= (location==='loot'?8:storeCapacity(world)))return false;
  const i={id:`eq-${++e.sequence}`,definition,grade,affix:grade==='rare'?({weapon:'keen',armor:'sturdy',charm:'vital'}[EQUIPMENT[definition].role]):null,source,location,locked:false,durability:100,rotated:false,active:false};
  e.items.push(i);e.revision++;return i;
}
export function depositEquipment(world) {
  const e=world.state.hero?.equipment;if(!e)return true;
  autoSalvage(world);
  let room=storeCapacity(world)-e.items.filter(i=>i.location==='store').length;
  for(const i of e.items)if(i.location==='loot'&&room>0){i.location='store';room--;e.revision++;}
  autoSalvage(world);
  return !e.items.some(i=>i.location==='loot');
}
export function adjacent(a,b) {
  const x=equipmentSize(a),y=equipmentSize(b);
  return ((a.x+x.w===b.x||b.x+y.w===a.x)&&a.y<b.y+y.h&&b.y<a.y+x.h)
    ||((a.y+x.h===b.y||b.y+y.h===a.y)&&a.x<b.x+y.w&&b.x<a.x+x.w);
}
function fits(e,item,others=e.items) {
  const {w,h}=equipmentSize(item);
  return Number.isInteger(item.x)&&Number.isInteger(item.y)&&item.x>=0&&item.y>=0&&item.x+w<=e.width&&item.y+h<=e.height
    &&!others.some(i=>i.id!==item.id&&i.location==='grid'&&(()=>{const s=equipmentSize(i);return item.x<i.x+s.w&&i.x<item.x+w&&item.y<i.y+s.h&&i.y<item.y+h;})());
}
function activationValid(items) {
  const active=items.filter(i=>i.location==='grid'&&i.active);
  return ['weapon','armor','charm'].every(role=>active.filter(i=>EQUIPMENT[i.definition].role===role).length<=(role==='charm'?3:1))&&active.filter(i=>i.grade==='mythic').length<=1;
}
export function baseHeroStats(level=1) {
  const l=Math.max(1,Math.min(50,Math.floor(level)||1));
  return {maxHp:44+(l-1)*8,damage:7+(l-1)*2,range:1,cooldown:2,armor:1+Math.floor((l-1)/3)};
}
export function deriveHeroStats(hero,items=hero?.equipment?.items??[]) {
  const s={...baseHeroStats(hero?.level),efficiency:0};
  const active=items.filter(i=>i.location==='grid'&&i.active&&i.durability>0), scaled=(n,i)=>Math.floor(n*GRADES[i.grade]);
  for(const i of active){const d=EQUIPMENT[i.definition];s.damage+=scaled(d.damage,i);s.armor+=scaled(d.armor,i);s.maxHp+=scaled(d.hp,i);s.cooldown-=d.speed;
    if(i.affix==='keen')s.damage+=1;else if(i.affix==='sturdy')s.armor+=1;else if(i.affix==='vital')s.maxHp+=3;
    if(d.effect==='provisions')s.efficiency+=1;
    if(d.effect==='charged')s.cooldown-=.1;
  }
  const weapon=active.find(i=>EQUIPMENT[i.definition].role==='weapon'),armor=active.find(i=>EQUIPMENT[i.definition].role==='armor');
  // Each unordered pair is visited once; no recursive amplification.
  for(let a=0;a<active.length;a++)for(let b=a+1;b<active.length;b++)if(adjacent(active[a],active[b])){
    const pair=[active[a],active[b]],defs=pair.map(i=>EQUIPMENT[i.definition]);
    if(pair.includes(weapon)&&defs.some(d=>d.effect==='ember'))s.damage+=2;
    if(pair.includes(armor)&&defs.some(d=>d.effect==='ward'))s.armor+=1;
    if(defs[0].tag===defs[1].tag)s.maxHp+=2;
    if(pair.includes(weapon)&&defs.some(d=>d.effect==='heart'))s.damage+=4;
    if(defs.some(d=>d.effect==='dawn')&&defs.some(d=>d.role==='charm'))s.armor+=2;
  }
  s.damage=Math.min(150,s.damage);s.armor=Math.min(12,s.armor);s.maxHp=Math.min(500,s.maxHp);s.cooldown=Math.max(1,Math.min(4,s.cooldown));s.efficiency=Math.min(2,s.efficiency);return s;
}
export function syncHeroEquipment(hero) {
  if(!hero||['fighting','defending','victory'].includes(hero.mode))return;
  hero.maxHp=deriveHeroStats(hero).maxHp;hero.hp=Math.min(hero.hp,hero.maxHp);
}
export function equipmentOrder(world,o) {
  const h=world.state.hero,e=h?.equipment,home=world.getVillage('home');if(!e)return fail('missing');
  if(o.operation==='lootPolicy'){if(typeof o.value!=='boolean')return fail('invalid');e.autoSalvage=o.value;e.revision++;return {ok:true,messageKey:'dungeon.'+(o.value?'policyOn':'policyOff'),messageParams:{}};}
  const i=e.items.find(i=>i.id===o.id);
  if(o.operation==='expand') {
    if(!['home','recovering'].includes(h.mode))return fail('away');
    if(e.width===8)return fail('limit');
    if(!spendResources(home,{cloth:12,tools:2,planks:4}))return fail('materials');
    e.width=8;e.height=6;e.revision++;return ok();
  }
  if(o.operation==='salvageCommon'){
    const items=e.items.filter(a=>a.location==='store'&&a.grade==='common'&&!a.locked);
    if(!items.length)return fail('missing');
    if(resourceAmount(home,'iron')+items.length>stockLimit(home,'iron'))return fail('space');
    home.iron=resourceAmount(home,'iron')+items.length;
    const ids=new Set(items.map(a=>a.id));e.items=e.items.filter(a=>!ids.has(a.id));e.revision++;
    return {ok:true,messageKey:'gear.salvagedMany',messageParams:{count:items.length}};
  }
  if(o.operation==='auto')return autoArrange(world,o.goal);
  if(!i)return fail('missing');
  if(o.operation==='lock'||o.operation==='unlock'){i.locked=o.operation==='lock';e.revision++;return ok();}
  if(i.locked)return fail('locked');
  if(o.operation==='place'||o.operation==='beside') {
    if(i.location==='loot'||i.location==='store'&&!['home','recovering'].includes(h.mode))return fail('away');
    const next={...i,location:'grid',x:o.x,y:o.y,rotated:o.rotated??i.rotated,active:o.active!==false};
    if(o.operation==='beside'){
      const target=e.items.find(a=>a.id===o.target&&a.location==='grid');if(!target)return fail('missing');
      let found=false;for(let y=0;y<e.height&&!found;y++)for(let x=0;x<e.width&&!found;x++){next.x=x;next.y=y;found=fits(e,next)&&adjacent(next,target);}if(!found)return fail('space');
    }
    if(!fits(e,next))return fail('space');
    if(!activationValid(e.items.map(a=>a===i?next:a)))return fail('roles');
    Object.assign(i,next);
  } else if(o.operation==='remove') {
    if(!['home','recovering'].includes(h.mode))return fail('away');
    if(e.items.filter(a=>a.location==='store').length>=storeCapacity(world))return fail('space');
    i.location='store';i.active=false;delete i.x;delete i.y;
  } else if(['sell','salvage','repair'].includes(o.operation)) {
    if(i.location!=='store')return fail('equipped');
    if(o.operation==='repair') {if(i.durability===100)return fail('limit');if(!spendResources(home,{tools:1,iron:1}))return fail('materials');i.durability=100;}
    else {
      const v=world.state.life?.caravan;
      const value=o.operation==='sell'?Math.floor(4*GRADES[i.grade]):1,resource=o.operation==='sell'?'silver':'iron';
      if(o.operation==='sell'&&(!v||v.stage!=='visiting'||world.state.time>=v.departAt||o.visitId!==undefined&&o.visitId!==v.id||v.cash<value))return fail('merchant');
      if(resourceAmount(home,resource)+value>stockLimit(home,resource))return fail('space');
      home[resource]=resourceAmount(home,resource)+value;if(o.operation==='sell'){v.cash-=value;v.revision++;}
      e.items.splice(e.items.indexOf(i),1);
    }
  }else return fail('invalid');
  e.revision++;syncHeroEquipment(h);return ok();
}
export function autoArrange(world,goal='attack') {
  const h=world.state.hero,e=h.equipment;if(!['home','recovering'].includes(h.mode))return fail('away');
  const items=structuredClone(e.items);
  const score=i=>{const d=EQUIPMENT[i.definition],g=GRADES[i.grade];return goal==='survival'?(d.armor*5+d.hp)*g:goal==='expedition'?(d.effect==='provisions'?100:0)+(d.damage+d.armor*2)*g/(d.w*d.h):(d.damage*3+d.speed*8+(d.effect==='ember'?6:0))*g;};
  const candidates=items.filter(i=>i.location!=='loot'&&!i.locked).sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id)).slice(0,20);
  for(const i of items)if(i.location==='grid'&&!i.locked){i.location='store';i.active=false;delete i.x;delete i.y;}
  for(const i of candidates){let placed=false;for(const rotated of [false,true]){for(let y=0;y<e.height&&!placed;y++)for(let x=0;x<e.width&&!placed;x++){const next={...i,location:'grid',active:true,rotated,x,y};if(fits(e,next,items)&&activationValid([...items.filter(a=>a!==i),next])){Object.assign(i,next);placed=true;}}if(placed)break;}}
  if(items.filter(i=>i.location==='store').length>storeCapacity(world))return fail('space');
  e.items=items;e.revision++;syncHeroEquipment(h);return ok();
}
export function wearEquipment(hero,ids) {for(const i of hero.equipment?.items??[])if(ids?ids.includes(i.id):i.location==='grid'&&i.active)i.durability=Math.max(0,i.durability-1);}
export function awardEquipmentGoals(world) {
  const h=world.state.hero,e=h?.equipment;if(!e)return;
  for(const [key,count,id,grade] of [['unique',3,'dawnblade','unique'],['mythic',8,'worldheart','mythic']])if(!e.goals[key]&&(key==='unique'?(h.dungeon?.eliteWins??0)>=3:(h.dungeon?.bossWins??0)>=2)){if(grantEquipment(world,id,grade,`goal-${key}`,'loot'))e.goals[key]=true;}
}
export function merchantEquipment(world,o) {
  const v=world.state.life?.caravan,h=world.getVillage('home');if(!v||v.stage!=='visiting'||world.state.time>=v.departAt||o.visitId!==undefined&&o.visitId!==v.id)return fail('merchant');
  if(v.equipmentSold||(v.equipmentStock??1)<1)return fail('limit');
  const cost={silver:18};if(resourceAmount(h,'silver')<18)return fail('materials');
  if(!grantEquipment(world,'ward','rare',v.id))return fail('space');
  spendResources(h,cost);v.cash+=18;v.equipmentSold=true;v.equipmentStock=0;v.revision++;return ok();
}
export function validEquipment(e) {
  if(e?.autoSalvage!==undefined&&typeof e.autoSalvage!=='boolean')return false;
  if(!e||e.version!==1||!Number.isSafeInteger(e.sequence)||e.sequence<0||!Number.isSafeInteger(e.revision)||e.revision<0||!Number.isSafeInteger(e.crafted)||e.crafted<0||![[6,5],[8,6]].some(([w,h])=>e.width===w&&e.height===h)||!Array.isArray(e.items)||e.items.length>156||typeof e.goals?.unique!=='boolean'||typeof e.goals?.mythic!=='boolean')return false;
  if(e.items.some(i=>!i||!Object.hasOwn(EQUIPMENT,i.definition)||!Object.hasOwn(GRADES,i.grade)))return false;
  const ids=new Set();
  return activationValid(e.items)&&e.items.filter(i=>i.location==='loot').length<=8&&e.items.filter(i=>i.location==='store').length<=100&&e.items.every(i=>{
    if(!/^eq-[1-9]\d*$/.test(i.id)||ids.has(i.id)||Number(i.id.slice(3))>e.sequence||!Object.hasOwn(EQUIPMENT,i.definition)||!Object.hasOwn(GRADES,i.grade)||!['store','grid','loot'].includes(i.location)||typeof i.locked!=='boolean'||typeof i.active!=='boolean'||typeof i.rotated!=='boolean'||!Number.isInteger(i.durability)||i.durability<0||i.durability>100||typeof i.source!=='string'||i.source.length>120)return false;ids.add(i.id);
    if(i.affix!==(i.grade==='rare'?({weapon:'keen',armor:'sturdy',charm:'vital'}[EQUIPMENT[i.definition].role]):null))return false;
    return i.location==='grid'?fits(e,i):!i.active;
  });
}

export function autoSalvage(world) {
  const e=world.state.hero?.equipment,h=world.getVillage('home');if(!e?.autoSalvage)return 0;
  const room=Math.max(0,Math.floor(stockLimit(h,'iron')-resourceAmount(h,'iron')));
  const candidates=e.items.filter(i=>i.location==='store'&&i.grade==='common'&&!i.locked).slice(0,room);
  if(!candidates.length)return 0;
  const ids=new Set(candidates.map(i=>i.id));e.items=e.items.filter(i=>!ids.has(i.id));e.revision++;h.iron=resourceAmount(h,'iron')+ids.size;
  recordEvent(world.state,{source:'world',actor:'home',action:'auto_salvage',time:world.state.time,messageKey:'dungeon.salvaged',messageParams:{count:ids.size}});
  syncResourceTotals(world.state);
  return ids.size;
}
