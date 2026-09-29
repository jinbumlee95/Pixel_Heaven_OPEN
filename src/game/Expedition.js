import { validDungeon } from './Dungeon.js';
import { depositEquipment, deriveHeroStats } from './Equipment.js';
import { spendResources, stockLimit } from '../state/economy.js';
import { syncResourceTotals } from '../state/worldState.js';

export const EXPEDITION = Object.freeze({ capacity: 24, shippingThreshold: 9, shippingMs: 6000,
  supplyMs: 5000, campMs: 2000, recoveryMs: 12000, transportCost: 1, maxDepth: 5 });
export const AWAY_MODES = ['outbound','exploring','fighting','victory','camp','field_recovery','supply_wait','resupplying','shipping','cargo_wait','returning'];
export const bagSize = hero => Object.values(hero.bag ?? {}).reduce((a,b)=>a+b,0);

// Legacy rewards already reached home. Start an empty bag; never copy lastLoot.
export function migrateExpedition(hero) {
  if (hero.expeditionVersion === 1) return;
  Object.assign(hero, { expeditionVersion: 1, missionId: hero.expeditionCount, cycleId: 1,
    depth: 1, nextDepth: 1, bag: {}, settledIds: [], shipmentCount: 0,
    supplies: ['outbound','exploring','fighting','victory'].includes(hero.mode) ? 1 : 0,
    cycleComplete: false, waitReason: null });
}
export function expeditionScene(hero, mode, durationMs = 0) {
  hero.mode = mode;
  hero.scene = { phase: mode, elapsedMs: 0, durationMs, room: hero.room, totalRooms: 3,
    monsterId: null, heroHp: hero.hp, enemyHp: 0, action: mode === 'field_recovery' ? 'guard' : 'idle' };
}
export function depositBag(world) {
  const hero = world.state.hero, home = world.getVillage('home');
  for (const [id,n] of Object.entries(hero.bag)) {
    const accepted = Math.min(n, Math.max(0,Math.floor(stockLimit(home,id)-(home[id]??0))));
    home[id] = (home[id]??0)+accepted;
    hero.bag[id] -= accepted;
    if (!hero.bag[id]) delete hero.bag[id];
  }
  syncResourceTotals(world.state);
  return depositEquipment(world) && bagSize(hero) === 0;
}
export function orderExpedition(world, order) {
  const hero = world.state.hero;
  // Depth/supply orders need their own wording; the recall message confused players.
  if (!hero || (order.missionId!==undefined&&order.missionId!==hero.missionId) || !AWAY_MODES.includes(hero.mode))
    return {ok:false,messageKey:'exp.notAway',messageParams:{}};
  if (hero.recallRequested || hero.mode==='returning') return {ok:false,messageKey:'exp.returning',messageParams:{}};
  migrateExpedition(hero);
  if (order.operation === 'deeper') {
    if (hero.nextDepth >= EXPEDITION.maxDepth) return {ok:false,messageKey:'exp.depthLimit',messageParams:{}};
    hero.nextDepth++;
    return {ok:true,messageKey:'exp.depthOrdered',messageParams:{depth:hero.nextDepth}};
  }
  if (order.operation !== 'supply' || hero.mode !== 'supply_wait')
    return {ok:false,messageKey:'exp.noSupplyOrder',messageParams:{}};
  return startSupply(world);
}
export function startSupply(world) {
  const hero=world.state.hero, home=world.getVillage('home');
  const cost=home.rations>=2&&home.medicine>=1?{rations:2,medicine:1,silver:1}:home.economyVersion===2?{food:6,herbs:1,coal:1,silver:1}:{food:6,silver:1};
  if(cost.food&&deriveHeroStats(hero).efficiency)cost.food=Math.max(2,cost.food-deriveHeroStats(hero).efficiency);
  if (!spendResources(home,cost)) {
    hero.waitReason='supplies'; expeditionScene(hero,'supply_wait');
    return {ok:false,messageKey:'exp.missingSupplies',messageParams:{}};
  }
  hero.waitReason=null; expeditionScene(hero,'resupplying',EXPEDITION.supplyMs);
  syncResourceTotals(world.state);
  return {ok:true,messageKey:'exp.supplySent',messageParams:{}};
}
export function startShipping(world) {
  const hero=world.state.hero, home=world.getVillage('home');
  if (!spendResources(home,{silver:EXPEDITION.transportCost})) {
    hero.waitReason='shipping'; expeditionScene(hero,'cargo_wait'); return false;
  }
  hero.waitReason=null; expeditionScene(hero,'shipping',EXPEDITION.shippingMs);
  syncResourceTotals(world.state); return true;
}
export function validExpedition(hero) {
  if (hero.expeditionVersion===undefined) return true;
  const int=(n,min,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  return validDungeon(hero.dungeon) && hero.expeditionVersion===1 && int(hero.missionId,0) && int(hero.cycleId,1)
    && int(hero.depth,1,5) && int(hero.nextDepth,hero.depth,5) && int(hero.supplies,0,1)
    && int(hero.shipmentCount,0) && typeof hero.cycleComplete==='boolean'
    && [null,'supplies','shipping','storage'].includes(hero.waitReason)
    && int(hero.room,0,3) && int(hero.rewardedRoom,0,3) && typeof hero.clearRewarded==='boolean' && typeof hero.recallRequested==='boolean'
    && hero.scene?.phase===hero.mode
    && (hero.encounter===null || hero.encounter && int(hero.encounter.room,1,3) && ['slime','cave_bat','stone_guardian'].includes(hero.encounter.monsterId)
      && (hero.encounter.kind===undefined||['normal','elite','spring','mystery','boss'].includes(hero.encounter.kind))
      && (hero.encounter.light===undefined||int(hero.encounter.light,0,100))
      && Number.isFinite(hero.encounter.damage) && hero.encounter.damage>=0 && int(hero.encounter.xp,0,100)
      && Number.isFinite(hero.encounter.startHp) && hero.encounter.startHp>0 && Number.isFinite(hero.encounter.enemyMaxHp) && hero.encounter.enemyMaxHp>0
      && (hero.encounter.equipmentDrop===undefined||hero.encounter.equipmentDrop===null||['shortblade','lightarmor','ward','mace'].includes(hero.encounter.equipmentDrop.definition)&&['common','rare'].includes(hero.encounter.equipmentDrop.grade))
      && (hero.encounter.equipmentIds===undefined||Array.isArray(hero.encounter.equipmentIds)&&hero.encounter.equipmentIds.length<=5&&hero.encounter.equipmentIds.every(id=>hero.equipment?.items.some(i=>i.id===id)))
      && typeof hero.encounter.won==='boolean' && hero.encounter.loot && Object.entries(hero.encounter.loot).every(([id,n])=>['stone','iron','silver','gold'].includes(id)&&int(n,0,9)))
    && hero.bag && !Array.isArray(hero.bag) && Object.entries(hero.bag).every(([id,n])=>['stone','iron','silver','gold'].includes(id)&&int(n,0,24))
    && bagSize(hero)<=EXPEDITION.capacity && Array.isArray(hero.settledIds) && hero.settledIds.length<=8
    && new Set(hero.settledIds).size===hero.settledIds.length && hero.settledIds.every(id=>typeof id==='string'&&/^\d+:\d+:(?:[1-3]|clear)$/.test(id));
}
