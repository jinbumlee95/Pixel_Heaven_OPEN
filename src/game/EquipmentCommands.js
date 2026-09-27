import { EQUIPMENT, GRADES } from '../content/equipment.js';
import { deriveHeroStats, equipmentOrder, merchantEquipment } from './Equipment.js';

export const gearNames = {
  shortblade:['소검','shortblade','小剣'],saber:['도','saber','刀'],mace:['둔기','mace','鈍器'],greatsword:['대검','greatsword','大剣'],runeblade:['룬검','runeblade','ルーン剣'],
  lightarmor:['경갑','lightarmor','軽鎧'],plate:['중갑','plate','重鎧'],ember:['불꽃부적','ember','炎のお守り'],ward:['보호부적','ward','守りのお守り'],pathfinder:['길잡이','pathfinder','道しるべ'],dawnblade:['새벽검','dawnblade','夜明けの剣'],worldheart:['세계수심장','worldheart','世界樹の心'],
};
const definition = name => Object.keys(gearNames).find(id=>id===name||gearNames[id].includes(name));
const ref = name => /^eq-[1-9]\d*$/.test(name)?name:definition(name);
const grade = name => ({커먼:'common',레어:'rare',유니크:'unique',신화:'mythic',コモン:'common',レア:'rare',ユニーク:'unique',神話:'mythic'}[name]??name);
export function parseEquipmentCommand(s) {
  s=s.replace(/[.!?。！？]+$/u,'').trim();
  if(/^(보관소에 있는 커먼 장비 다 분해해|커먼 장비 분해해|salvage stored common gear|保管中のコモン装備を分解)$/u.test(s))return {type:'order',name:'equipment',operation:'salvageCommon'};
  if(/^(장비|인벤토리|격자|성장판|equipment|inventory|grid|装備|インベントリ|装備盤)(?: (?:현황|보여줘))?$/u.test(s))return {type:'meta',name:'equipment'};
  if(/^(격자 닫아|close grid|装備盤を閉じて)$/u.test(s))return {type:'meta',name:'closeEquipment'};
  if(/^(장비 목표|equipment goals|装備目標)$/u.test(s))return {type:'meta',name:'equipmentGoals'};
  if(/^(장비 제작법|equipment recipes|装備レシピ)$/u.test(s))return {type:'meta',name:'recipes'};
  if(/^(희귀 장비 사|buy rare gear|レア装備を買って)$/u.test(s))return {type:'order',name:'equipment',operation:'buy'};
  if(/^(가방 확장|expand grid|装備盤を拡張)$/u.test(s))return {type:'order',name:'equipment',operation:'expand'};
  let m=s.match(/^(?:새 )?(\S+?)(?:을|를) ([a-h])([1-6])에 (세로|가로)로 넣어$/u);
  if(m&&ref(m[1]))return {type:'order',name:'equipment',operation:'place',id:ref(m[1]),x:m[2].charCodeAt(0)-97,y:Number(m[3])-1,rotated:m[4]==='가로',active:true};
  m=s.match(/^(\S+?)(?:은|는) 팔지 마$/u);
  if(m&&ref(m[1]))return {type:'order',name:'equipment',operation:'lock',id:ref(m[1])};
  m=s.match(/^(공격|생존|원정)(?: 위주로)? 자동 배치$/u)??s.match(/^auto (attack|survival|expedition)$/u)??s.match(/^(攻撃|生存|遠征)自動配置$/u);
  if(m)return {type:'order',name:'equipment',operation:'auto',goal:({공격:'attack',생존:'survival',원정:'expedition',攻撃:'attack',生存:'survival',遠征:'expedition'}[m[1]]??m[1])};
  m=s.match(/^(?:제작|craft|製作) (\S+) (\S+)(?: (\d+))?$/u);
  if(m&&definition(m[2]))return {type:'order',name:'produce',recipeId:`gear_${definition(m[2])}_${grade(m[1])}`,count:Number(m[3]??1)};
  m=s.match(/^(?:비교|compare|比較) (\S+)$/u);
  if(m&&ref(m[1]))return {type:'meta',name:'equipmentCompare',id:ref(m[1])};
  m=s.match(/^(?:배치|place|配置) (\S+) ([a-h])([1-6])(?: (가로|세로|horizontal|vertical|横|縦))?(?: (짐|cargo|荷物))?$/u);
  if(m&&ref(m[1]))return {type:'order',name:'equipment',operation:'place',id:ref(m[1]),x:m[2].charCodeAt(0)-97,y:Number(m[3])-1,rotated:['가로','horizontal','横'].includes(m[4]),active:!m[5]};
  m=s.match(/^(?:인접|beside|隣接) (\S+) (\S+)$/u);
  if(m&&ref(m[1])&&ref(m[2]))return {type:'order',name:'equipment',operation:'beside',id:ref(m[1]),target:ref(m[2])};
  m=s.match(/^(잠금|해제|빼기|판매|분해|수리|lock|unlock|remove|sell|salvage|repair|固定|解除|外す|売却|分解|修理) (\S+)$/u);
  if(m&&ref(m[2]))return {type:'order',name:'equipment',operation:({잠금:'lock',해제:'unlock',빼기:'remove',판매:'sell',분해:'salvage',수리:'repair',固定:'lock',解除:'unlock',外す:'remove',売却:'sell',分解:'salvage',修理:'repair'}[m[1]]??m[1]),id:ref(m[2])};
  if(/\bcraft\b|製作|제작.*(?:커먼|레어|유니크|신화)/u.test(s))return {type:'invalid'};
  if(/(?:eq-\d+|장비|격자|부적|equipment|\bgrid\b|装備|お守り)/u.test(s)||/^(?:craft|製作|제작|place|배치|配置) /u.test(s))return {type:'invalid'};
  return null;
}
export function validEquipmentOrder(o) {
  if(o.visitId!==undefined&&(typeof o.visitId!=='string'||!/^caravan-\d+$/.test(o.visitId)))return false;
  const reference=v=>typeof v==='string'&&(/^eq-[1-9]\d*$/.test(v)||Object.hasOwn(EQUIPMENT,v));
  if(o.operation==='lootPolicy')return typeof o.value==='boolean';
  if(o.operation==='auto')return ['attack','survival','expedition'].includes(o.goal);
  if(['buy','expand','salvageCommon'].includes(o.operation))return true;
  if(!reference(o.id))return false;
  if(o.operation==='beside')return reference(o.target);
  if(o.operation==='place')return Number.isInteger(o.x)&&o.x>=0&&o.x<8&&Number.isInteger(o.y)&&o.y>=0&&o.y<6&&typeof o.rotated==='boolean'&&typeof o.active==='boolean';
  return ['lock','unlock','remove','sell','salvage','repair'].includes(o.operation);
}
function resolve(world,id){const matches=world.state.hero?.equipment?.items.filter(i=>i.id===id||i.definition===id)??[];return matches.length===1?matches[0]:null;}
export function executeEquipmentOrder(world,o) {
  if(!validEquipmentOrder(o))return {ok:false,messageKey:'gear.error.invalid',messageParams:{}};
  if(o.operation==='buy')return merchantEquipment(world,o);
  const item=o.id?resolve(world,o.id):null,target=o.target?resolve(world,o.target):null;
  if(o.id&&!item||o.target&&!target)return {ok:false,messageKey:'gear.error.ambiguous',messageParams:{}};
  const before=deriveHeroStats(world.state.hero);
  const result=equipmentOrder(world,{...o,id:item?.id,target:target?.id});
  if(result.ok&&['place','beside','remove','auto'].includes(o.operation)){const after=deriveHeroStats(world.state.hero);result.messageKey='gear.changed';result.messageParams={damage:after.damage-before.damage,armor:after.armor-before.armor,hp:after.maxHp-before.maxHp,items:world.state.hero.equipment.items.filter(i=>i.location==='grid'&&i.active).map(i=>i.id).join(', ')};}
  return result;
}
export function equipmentSummary(world,i18n,compareId) {
  const h=world.state.hero,e=h?.equipment,t=(k,p)=>i18n.t(k,p);if(!e)return t('gear.error.missing');
  const stats=s=>t('gear.stats',s);
  if(compareId){const i=resolve(world,compareId);if(!i)return t('gear.error.ambiguous');
    const items=e.items.filter(a=>!(a.location==='grid'&&a.active&&EQUIPMENT[a.definition].role===EQUIPMENT[i.definition].role)&&a.id!==i.id);
    items.push({...i,location:'grid',active:true,x:-10,y:-10});return t('gear.preview')+'\n'+stats(deriveHeroStats(h))+' → '+stats(deriveHeroStats(h,items));}
  return [t('dungeon.'+(e.autoSalvage?'policyOn':'policyOff')),stats(deriveHeroStats(h)),t('gear.goals',{elite:h.dungeon?.eliteWins??0,boss:h.dungeon?.bossWins??0,crafted:e.crafted}),...e.items.map(i=>`${i.id} · ${t(`gear.${i.definition}`)} [${t(`gear.grade.${i.grade}`)}] · ${t(`gear.location.${i.location}`)}${i.location==='grid'?` ${String.fromCharCode(65+i.x)}${i.y+1} ${i.rotated?'↔':'↕'} ${t(i.active?'gear.active':'gear.cargo')}`:''} · ${i.durability}% · ${t('gear.effect.'+(EQUIPMENT[i.definition].effect??'none'))}${i.affix?' · '+t('gear.affix.'+i.affix):''}${i.locked?' 🔒':''}`),t('gear.help')].join('\n');
}
