import { executeEquipmentOrder } from '../src/game/EquipmentCommands.js';
import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { initializeEquipment, grantEquipment, equipmentOrder, deriveHeroStats, adjacent, validEquipment, depositEquipment, awardEquipmentGoals, merchantEquipment } from '../src/game/Equipment.js';
import { queueProduction, cancelProduction, productionReason } from '../src/game/Production.js';
import { queueConstruction } from '../src/game/Work.js';
import { executeHeroOrder, enlistHero, releaseHeroFromBattle } from '../src/game/Hero.js';
import { startSupply } from '../src/game/Expedition.js';
import { parseChatCommand, ChatCommands } from '../src/game/ChatCommands.js';
import { equipmentSummary } from '../src/game/EquipmentCommands.js';
import { encodeWorld, decodeWorld } from '../src/state/Persistence.js';
import { RESOURCE_TYPES, stockLimit } from '../src/state/economy.js';
import { I18n } from '../src/i18n/I18n.js';
import { initializeVisit } from '../src/game/Trading.js';
const setup=()=>{const g=new Game(null),w=g.world,h=w.getVillage('home');for(const id of RESOURCE_TYPES)h[id]=200;h.tools=0;return {g,w,h,hero:w.state.hero,e:w.state.hero.equipment};};
const advance=(g,n)=>{for(let j=0;j<n;j++){g.world.state.time++;g.work.update();}};
const place=(w,id,x,y,rotated=false,active=true)=>equipmentOrder(w,{operation:'place',id,x,y,rotated,active});
{
 const {g,w,h,e,hero}=setup();const before=structuredClone(e);initializeEquipment(w);assert.deepEqual(e,before,'migration is idempotent');
 assert.ok(queueConstruction(w,{action:'build_smith'}).ok);advance(g,50);
 assert.equal(queueProduction(w,'gear_mace_rare',1).code,'unlock');
 assert.ok(queueProduction(w,'gear_mace_common',3).ok);advance(g,90);assert.equal(e.crafted,3);
 assert.ok(queueProduction(w,'gear_plate_rare',1).ok);advance(g,60);assert.equal(e.items.filter(i=>i.grade==='rare').length,1);
 const start=h.iron;assert.ok(queueProduction(w,'gear_greatsword_common',2).ok);advance(g,30);assert.ok(cancelProduction(w,'gear_greatsword_common').ok);assert.equal(h.iron,start-10,'only completed item consumed');
 const sword=e.items[0];assert.ok(place(w,sword.id,0,0).ok);const hp=hero.hp;
 assert.equal(place(w,sword.id,5,4).ok,false,'bounds');assert.ok(place(w,sword.id,0,0,true).ok,'rotation');assert.equal(hero.hp,hp);
 const armor=e.items.find(i=>i.definition==='plate'), charm=grantEquipment(w,'ward','common','test');
 assert.ok(place(w,armor.id,0,1).ok);assert.ok(place(w,charm.id,2,1).ok);
 assert.ok(adjacent(armor,charm));const stats=deriveHeroStats(hero);assert.ok(stats.armor>1);
 const extra=e.items.find(i=>i.definition==='mace');assert.equal(place(w,extra.id,3,0).code,'roles');assert.ok(place(w,extra.id,3,0,false,false).ok);assert.deepEqual(deriveHeroStats(hero),stats,'cargo weapon has no effect');
 assert.equal(equipmentOrder(w,{operation:'sell',id:sword.id}).code,'equipped');
 assert.ok(equipmentOrder(w,{operation:'lock',id:armor.id}).ok);const position=[armor.x,armor.y];assert.equal(equipmentOrder(w,{operation:'remove',id:armor.id}).code,'locked');
 assert.ok(equipmentOrder(w,{operation:'auto',goal:'attack'}).ok);assert.deepEqual([e.items.find(i=>i.id===armor.id).x,e.items.find(i=>i.id===armor.id).y],position);
 assert.equal(hero.hp,hp,'rearranging does not heal');assert.ok(validEquipment(e));
 const copy=decodeWorld(encodeWorld(w)).world;assert.deepEqual(copy.state.hero.equipment,e);
 const corrupt=structuredClone(e);corrupt.items.push({...corrupt.items[0]});assert.equal(validEquipment(corrupt),false);
 const overlap=structuredClone(e);const two=overlap.items.filter(i=>i.location==='grid');two[1].x=two[0].x;two[1].y=two[0].y;assert.equal(validEquipment(overlap),false);
 h.tools=2;assert.ok(equipmentOrder(w,{operation:'expand'}).ok);assert.equal(e.width,8);assert.equal(h.tools,0);
 for(const locale of ['ko','en','ja'])assert.doesNotMatch(equipmentSummary(w,new I18n({locale,storage:null})),/gear\./);
 g.stop();
}
{
 const {g,w,h,e,hero}=setup();
 const great=grantEquipment(w,'greatsword','common','test'),small=grantEquipment(w,'shortblade','common','test'),ward=grantEquipment(w,'ward','common','test'),path=grantEquipment(w,'pathfinder','common','test');
 for(let n=0;n<3;n++)grantEquipment(w,'ember','common','test');e.width=8;e.height=6;
 equipmentOrder(w,{operation:'auto',goal:'attack'});const attack=deriveHeroStats(hero);
 equipmentOrder(w,{operation:'auto',goal:'expedition'});const efficient=deriveHeroStats(hero);assert.ok(efficient.efficiency>attack.efficiency);
 hero.hp=hero.maxHp;const unit={};assert.ok(enlistHero(w,unit));assert.equal(unit.damage,deriveHeroStats(hero).damage);assert.equal(unit.armor,deriveHeroStats(hero).armor);unit.hp-=3;releaseHeroFromBattle(w,unit);
 const hp=hero.hp;equipmentOrder(w,{operation:'auto',goal:'survival'});assert.ok(hero.hp<=hp);
 hero.mode='home';hero.hp=hero.maxHp;
 assert.ok(executeHeroOrder(w,{action:'hero_dispatch',target:'home',parameters:{}}).ok);
 assert.equal(place(w,e.items.find(i=>i.location==='store').id,0,0).code,'away');
 g.hero.beginEncounter();const encounter=structuredClone(hero.encounter);equipmentOrder(w,{operation:'place',id:e.items.find(i=>i.location==='grid').id,x:0,y:0,rotated:false});assert.deepEqual(hero.encounter,encounter);
 hero.mode='supply_wait';const rations=h.rations,medicine=h.medicine;assert.ok(startSupply(w).ok);assert.equal(h.rations,rations-2);assert.equal(h.medicine,medicine-1);
 g.stop();
}
{
 const {g,w,e,hero}=setup();hero.dungeonsCleared=8;hero.dungeon.eliteWins=3;hero.dungeon.bossWins=2;awardEquipmentGoals(w);awardEquipmentGoals(w);
 assert.equal(e.items.filter(i=>i.grade==='unique').length,1);assert.equal(e.items.filter(i=>i.grade==='mythic').length,1);
 assert.ok(depositEquipment(w));const myth=e.items.find(i=>i.grade==='mythic');assert.ok(place(w,myth.id,0,0).ok);
 const second=grantEquipment(w,'worldheart','mythic','test');assert.equal(place(w,second.id,2,0).code,'roles');
 while(grantEquipment(w,'ward','common','full')){}const loot=grantEquipment(w,'mace','rare','loot','loot');assert.ok(loot);assert.equal(depositEquipment(w),false);
 hero.mode='cargo_wait';hero.scene.phase='cargo_wait';hero.waitReason='storage';assert.ok(executeHeroOrder(w,{action:'hero_recall',target:'home',parameters:{}}).ok);assert.equal(hero.mode,'returning');
 const source=w.state.factions[0];w.state.life.caravan={id:'caravan-99',source:source.id,stage:'visiting',departAt:999,cash:12,revision:0};assert.equal(merchantEquipment(w,{}).code,'space');assert.equal(w.state.life.caravan.equipmentSold,undefined);
 assert.equal(merchantEquipment(w,{visitId:'caravan-98'}).code,'merchant','stale visit rejected');
 g.stop();
}
// Real chat execution boundary in all supported languages, including negatives.
for(const [locale,craft,placement,lock,compare] of [['ko','제작 커먼 대검 1','배치 eq-1 A1','잠금 eq-1','비교 eq-1'],['en','craft common greatsword 1','place eq-1 A1','lock eq-1','compare eq-1'],['ja','製作 コモン 大剣 1','配置 eq-1 A1','固定 eq-1','比較 eq-1']]){
 const {g,w}=setup();g.i18n.setLocale(locale);const c=new ChatCommands(g);queueConstruction(w,{action:'build_smith'});advance(g,50);
 assert.ok((await c.send(craft)).ok);assert.ok((await c.send(placement)).ok);assert.ok((await c.send(lock)).ok);
 const before=structuredClone(w.state.hero.equipment.items);assert.ok((await c.send(compare)).ok);assert.deepEqual(w.state.hero.equipment.items,before);
 g.stop();
}
assert.equal(parseChatCommand('eq-1은 팔지 마').operation,'lock');
assert.equal(parseChatCommand('새 대검을 A1에 세로로 넣어').operation,'place');
for(const bad of ['eq-1을 팔지 마','do not sell eq-1','eq-1を売らない','장비가 좋으면 팔아'])assert.equal(parseChatCommand(bad).type,'invalid');
{
 const {g,w,h,hero,e}=setup();const armor=grantEquipment(w,'plate','common','test');
 const before=hero.hp;assert.ok(place(w,armor.id,0,0).ok);assert.equal(hero.hp,before);
 g.hero.update(250);assert.equal(hero.mode,'recovering');for(let j=0;j<49;j++)g.hero.update(250);
 assert.equal(hero.mode,'home');assert.equal(hero.hp,hero.maxHp,'increased capacity uses normal recovery, no permanent dispatch lock');
 const visit={id:'caravan-99',source:w.state.factions[0].id,stage:'visiting',arriveAt:w.state.time,departAt:w.state.time+100,stock:{},earned:0};
 w.state.life.caravan=visit;initializeVisit(w,visit);const silver=h.silver;
 assert.ok(merchantEquipment(w,{visitId:visit.id}).ok);assert.equal(h.silver,silver-18);assert.equal(visit.equipmentStock,0);
 assert.equal(merchantEquipment(w,{visitId:visit.id}).code,'limit');assert.equal(h.silver,silver-18);
 assert.ok(queueConstruction(w,{action:'build_smith'}).ok);advance(g,50);
 while(grantEquipment(w,'ward','common','full')){}
 const iron=h.iron;assert.ok(queueProduction(w,'gear_shortblade_common',1).ok);advance(g,100);
 const job=w.state.production.jobs.at(-1);assert.equal(productionReason(w,job),'capacity');assert.equal(job.completed,0);
 assert.ok(cancelProduction(w,job.recipeId).ok);assert.equal(h.iron,iron,'full storage preserves refund and never loses item output');
 g.stop();
}
{
 const {g,w,e,hero}=setup();e.items=[];
 const armor=grantEquipment(w,'plate','common','test'),ward=grantEquipment(w,'ward','common','test');
 place(w,armor.id,0,0);const alone=deriveHeroStats(hero);place(w,ward.id,2,0);const together=deriveHeroStats(hero);
 assert.equal(together.armor-alone.armor,1,'two shared edges trigger ward only once');
 assert.equal(together.maxHp-alone.maxHp,4,'charm HP plus one same-tag pair');
 const save=structuredClone(e);save.items[0].definition='unknown';assert.equal(validEquipment(save),false);
 g.stop();
}
console.log('equipment: crafting, grid, roles, locks, stats, goals, capacity, save and multilingual execution passed');

{const {g,w,h,e}=setup();e.items=[];const a=grantEquipment(w,'shortblade','common','test'),b=grantEquipment(w,'plate','common','test'),c=grantEquipment(w,'ward','rare','test'),d=grantEquipment(w,'mace','common','test');b.locked=true;place(w,d.id,0,0);const before=h.iron;assert.ok(executeEquipmentOrder(w,parseChatCommand('커먼 장비 분해해')).ok);assert.equal(h.iron,before+1);assert.deepEqual(e.items.map(i=>i.id),[b.id,c.id,d.id]);g.stop();}
