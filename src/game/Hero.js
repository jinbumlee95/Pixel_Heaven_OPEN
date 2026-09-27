import { recordEvent } from '../game/EventJournal.js';
import { initializeDungeon, prepareDungeonRoute, dungeonEncounter } from './Dungeon.js';
import { baseHeroStats, initializeEquipment, deriveHeroStats, syncHeroEquipment, grantEquipment, depositEquipment, wearEquipment, awardEquipmentGoals } from './Equipment.js';
import { EXPEDITION, AWAY_MODES, bagSize, migrateExpedition, expeditionScene, depositBag, startSupply, startShipping } from './Expedition.js';
import { syncResourceTotals } from '../state/worldState.js';
import { canAffordResources, spendResources } from '../state/economy.js';

export const HERO_RULES = Object.freeze({ rooms: 3, outboundMs: 3000, exploreMs: 4000,
  // Three complete sword strikes: 8 frames × 120 ms from the art contract.
  fightMs: 2880, victoryMs: 900, returnMs: 3000, recoveryMs: 12000,
  maxElapsedMs: 250, supplies: Object.freeze({ food: 6, herbs: 1, coal: 1 }) });
export const DUNGEON_MONSTERS = Object.freeze([
  Object.freeze({ id: 'slime', hp: 14, damage: 2, xp: 12, loot: Object.freeze({ stone: 2 }) }),
  Object.freeze({ id: 'cave_bat', hp: 18, damage: 3, xp: 14, loot: Object.freeze({ iron: 2 }) }),
  Object.freeze({ id: 'stone_guardian', hp: 26, damage: 4, xp: 18, loot: Object.freeze({ silver: 1 }) }),
]);

const activeBattle = world => ['approaching', 'fighting'].includes(world.state.combat?.stage);
const homeOf = world => world.getVillage(world.state.playerSettlementId ?? 'home');
const failed = code => ({ ok: false, code, messageKey: `hero.failure.${code}`, messageParams: {} });
const entityOf = world => world.state.entities.get(world.state.hero?.entityId);
const cellKey = position => `${position.x},${position.y}`;

export const heroStats = baseHeroStats;

// Cosmetic routine only: no passive XP or resource production. The domain
// clock is saved and paused with the world; rendering never advances it.
export const HERO_TRAINING_MS = 16000;
export function heroTrainingPose(hero) {
  if (!hero || hero.mode !== 'home' || hero.hp < hero.maxHp) return { action: 'idle', elapsedMs: 0 };
  const time = hero.scene.elapsedMs % HERO_TRAINING_MS;
  for (const [start, action, duration] of [[4000, 'guard', 960], [7000, 'slash', 960], [11000, 'thrust', 960]])
    if (time >= start && time < start + duration) return { action, elapsedMs: time - start };
  return { action: 'idle', elapsedMs: 0 };
}

function setScene(hero, phase, durationMs = 0, extra = {}) {
  hero.mode = phase;
  hero.scene = { phase, elapsedMs: 0, durationMs, room: hero.room ?? 0,
    totalRooms: HERO_RULES.rooms, monsterId: phase === 'exploring' ? DUNGEON_MONSTERS[hero.room - 1]?.id ?? null : null,
    heroHp: hero.hp, enemyHp: 0,
    action: ['outbound', 'exploring', 'returning'].includes(phase) ? 'walk'
      : phase === 'fighting' ? 'slash' : phase === 'recovering' ? 'guard' : 'idle', ...extra };
}

// The named hero retains one entity identity. Absence releases its grid cell,
// so no invisible expedition pawn blocks new construction or villager routes.
export function hideHeroEntity(world) {
  const entity = entityOf(world);
  if (!entity) return;
  if (world.state.occupied.get(cellKey(entity.position)) === entity) world.state.occupied.delete(cellKey(entity.position));
  entity.hidden = true;
}

function restoreHeroEntity(world) {
  const entity = entityOf(world);
  const home = homeOf(world);
  if (!entity || !home) return false;
  if (!entity.hidden && world.state.occupied.get(cellKey(entity.position)) === entity) return true;
  const preferred = world.state.hero.homePosition;
  const position = world.isAreaEmpty(home, preferred, entity.footprint) ? preferred
    : world.findEmptyArea(home, entity.footprint);
  if (!position) return false;
  entity.position = { ...position };
  entity.hidden = false;
  entity.activity = 'hero';
  world.occupy(entity);
  return true;
}

export function validateHeroOrder(world, action) {
  if (!action || !['hero_dispatch', 'hero_recall'].includes(action.action)
    || action.target !== (world.state.playerSettlementId ?? 'home')
    || !action.parameters || typeof action.parameters !== 'object' || Array.isArray(action.parameters)
    || Object.keys(action.parameters).length) return failed('invalid_order');
  const hero = world.state.hero;
  const home = homeOf(world);
  if (!hero || !entityOf(world) || !home || home.population <= 0) return failed('unavailable');
  if (action.action === 'hero_dispatch') {
    if (hero.mode === 'awaiting') return failed('arriving');
    if (hero.mode !== 'home' || hero.hp < hero.maxHp || bagSize(hero) || hero.equipment?.items.some(i=>i.location==='loot')) return failed('busy');
    if (activeBattle(world)) return failed('defending');
    const supplies = home.economyVersion === 2 ? HERO_RULES.supplies : { food: HERO_RULES.supplies.food };
    if (!canAffordResources(home, supplies)) return failed('supplies');
  } else if (!AWAY_MODES.filter(mode=>mode!=='returning').includes(hero.mode) || hero.recallRequested) return failed('not_away');
  return { ok: true };
}

export function executeHeroOrder(world, action) {
  const validation = validateHeroOrder(world, action);
  if (!validation.ok) return validation;
  const hero = world.state.hero;
  if (action.action === 'hero_dispatch') {
    const home = homeOf(world);
    const supplies = home.economyVersion === 2 ? HERO_RULES.supplies : { food: HERO_RULES.supplies.food };
    if (!spendResources(home, supplies)) return failed('supplies');
    migrateExpedition(hero);
    hero.expeditionCount++;
    if(world.state.religion?.departure){if(world.state.religion.departure.missionId===null)world.state.religion.departure.missionId=hero.expeditionCount;else world.state.religion.departure=null;}
    hero.missionId=hero.expeditionCount; hero.cycleId=1; hero.depth=1; hero.nextDepth=1;
    hero.settledIds=[]; hero.supplies=1; hero.cycleComplete=false; hero.waitReason=null;
    hero.rngState = (Math.imul(hero.rngState, 1664525) + 1013904223) >>> 0;
    hero.runSeed = hero.rngState;
    initializeDungeon(hero);hero.dungeon.light=100;prepareDungeonRoute(hero);
    hero.room = 1;
    hero.rewardedRoom = 0;
    hero.clearRewarded = false;
    hero.recallRequested = false;
    hero.lastLoot = {};
    hero.encounter = null;
    hero.homePosition = { ...entityOf(world).position };
    hideHeroEntity(world);
    setScene(hero, 'outbound', HERO_RULES.outboundMs);
    syncResourceTotals(world.state);
  } else {
    hero.recallRequested = true;
    // A started attack finishes visibly and settles once. Travel/approach can
    // turn back immediately, without spawning another encounter or any XP.
    if (!['fighting', 'victory'].includes(hero.mode)) setScene(hero, 'returning', HERO_RULES.returnMs);
  }
  return { ok: true, messageKey: `hero.event.${action.action === 'hero_dispatch' ? 'dispatched' : 'recalled'}`,
    messageParams: { level: hero.level }, message: action.action === 'hero_dispatch'
      ? 'The hero sets out for the dungeon.' : 'The hero will return after the current encounter.' };
}

// A battle enlists this same hero, never a second expedition copy. The combat
// engine owns tactical HP until it calls releaseHeroFromBattle on resolution.
export function enlistHero(world, unit) {
  const hero = world.state.hero;
  if (!hero || hero.mode !== 'home' || hero.hp < hero.maxHp || !entityOf(world)) return false;
  syncHeroEquipment(hero);
  const stats = deriveHeroStats(hero);
  Object.assign(unit, { isHero: true, entityId: hero.entityId, hp: hero.hp, maxHp: hero.maxHp,
    damage: stats.damage, range: stats.range, cooldown: stats.cooldown, armor: stats.armor, equipmentIds:hero.equipment?.items.filter(i=>i.location==='grid'&&i.active).map(i=>i.id)??[] });
  hideHeroEntity(world);
  setScene(hero, 'defending');
  return true;
}

export function releaseHeroFromBattle(world, unit) {
  const hero = world.state.hero;
  if (!hero || hero.entityId !== unit?.entityId || hero.mode !== 'defending') return;
  hero.hp = Math.max(1, Math.min(hero.maxHp, unit.hp));
  wearEquipment(hero,unit.equipmentIds);
  unit.hidden = true;
  if (!restoreHeroEntity(world)) { setScene(hero, 'returning', HERO_RULES.returnMs); return; }
  setScene(hero, hero.hp < hero.maxHp ? 'recovering' : 'home', hero.hp < hero.maxHp ? HERO_RULES.recoveryMs : 0);
}

export class HeroSystem {
  constructor(world, { onEvent = () => {} } = {}) {
    this.world = world;
    this.onEvent = onEvent;
    const home = homeOf(world);
    if (!home || !world.content.get('hero')) return;
    if (!world.state.hero) {
      const existing = [...world.state.entities.values()].find(entity => entity.type === 'hero' && entity.villageId === home.id);
      const entity = existing ?? world.spawnEntity('hero', home.id, 'Hero');
      if (!entity) return;
      // New arrivals practice beside the sanctuary, outside the canopy/roof.
      // Existing saved residents retain their position; never teleport them.
      if (!existing) for (const [dx,dy] of [[4,6],[-4,6],[4,7],[-4,7]])
        if (world.moveEntity(entity,{x:home.anchor.x+dx,y:home.anchor.y+dy})) break;
      entity.activity = 'hero';
      const stats = heroStats();
      world.state.hero = { entityId: entity.id, level: 1, xp: 0, totalXp: 0, hp: stats.maxHp, maxHp: stats.maxHp,
        expeditionCount: 0, dungeonsCleared: 0, room: 0, rewardedRoom: 0, clearRewarded: false,
        recallRequested: false, homePosition: { ...entity.position }, lastLoot: {}, encounter: null,
        rngState: world.state.factionSimulation?.rngState ?? 72913, runSeed: 0 };
      setScene(world.state.hero, 'home');
    }
    migrateExpedition(world.state.hero);
    initializeEquipment(world);
    initializeDungeon(world.state.hero);
  }

  record(action, messageParams = {}) {
    const state = this.world.state;
    const event = { source: 'world', actor: 'home', action: `hero_${action}`, time: state.time,
      messageKey: `hero.event.${action}`, messageParams, message: `Hero: ${action.replaceAll('_', ' ')}.` };
    recordEvent(state,event);
    this.onEvent(event);
  }

  beginEncounter() {
    const hero = this.world.state.hero;
    if(hero.equipment?.items.filter(i=>i.location==='loot').length>=8){hero.waitReason='shipping';expeditionScene(hero,'cargo_wait');return;}
    const monster = DUNGEON_MONSTERS[hero.room - 1];
    const tier = hero.depth - 1;
    const variation = ((hero.runSeed ^ Math.imul(hero.room, 2654435761)) >>> 0) % 4;
    syncHeroEquipment(hero);
  const stats = deriveHeroStats(hero);
    const blessing=this.world.state.religion?.departure;
    if(blessing?.missionId===hero.missionId&&hero.cycleId===1)stats.armor+=blessing.armor;
    if(blessing?.missionId!==null&&(hero.cycleId>1||blessing?.missionId!==hero.missionId)&&blessing)this.world.state.religion.departure=null;
    const preview=dungeonEncounter(hero,monster,stats,variation);
    if(hero.room===2&&hero.dungeon?.route)hero.dungeon.route.committed=true;
    if(['spring','mystery'].includes(preview.kind)) {
      hero.encounter={room:hero.room,monsterId:monster.id,enemyMaxHp:1,damage:0,xp:0,loot:{},won:true,startHp:hero.hp,kind:preview.kind,stats, equipmentIds:[],equipmentDrop:null};
      setScene(hero,'fighting',1200,{monsterId:null,enemyHp:0,enemyMaxHp:1,action:'idle'});return;
    }
    const {enemyMaxHp,damage}=preview;
    if(hero.dungeon)hero.dungeon.light=Math.max(0,hero.dungeon.light-10-hero.depth*2);
    hero.encounter = { kind:preview.kind, light:preview.light, room: hero.room, monsterId: monster.id, enemyMaxHp,
      stats:structuredClone(stats), equipmentIds:hero.equipment?.items.filter(i=>i.location==='grid'&&i.active).map(i=>i.id)??[], equipmentDrop: (preview.kind==='elite'||hero.room===3&&(hero.cycleId%3===0))?{definition:['shortblade','lightarmor','ward','mace'][variation],grade:hero.depth>=2?'rare':'common'}:null,
      damage, xp: monster.xp + tier * 4, loot: { ...monster.loot }, won: damage < hero.hp, startHp: hero.hp };
    setScene(hero, 'fighting', HERO_RULES.fightMs, { monsterId: monster.id,
      enemyHp: enemyMaxHp, enemyMaxHp });
  }

  reward(xp, loot) {
    const hero = this.world.state.hero;
    const home = homeOf(this.world);
    hero.xp += xp;
    hero.totalXp += xp;
    const previousLevel = hero.level;
    while (hero.level < 50 && hero.xp >= hero.level * 40) {
      hero.xp -= hero.level * 40;
      hero.level++;
    }
    const maxHp = deriveHeroStats(hero).maxHp;
    hero.hp = Math.min(maxHp, hero.hp + maxHp - hero.maxHp);
    hero.maxHp = maxHp;
    for (const [resource, amount] of Object.entries(loot)) {
      hero.bag[resource] = (hero.bag[resource] ?? 0) + amount;
      hero.lastLoot[resource] = (hero.lastLoot[resource] ?? 0) + amount;
    }
    syncResourceTotals(this.world.state);
    if (hero.level > previousLevel) this.record('level_up', { level: hero.level });
  }

  finishEncounter() {
    const hero = this.world.state.hero;
    const encounter = hero.encounter;
    const settlementId=`${hero.missionId}:${hero.cycleId}:${encounter?.room}`;
    if (!encounter || hero.rewardedRoom >= encounter.room || hero.settledIds.includes(settlementId)) return;
    hero.settledIds.push(settlementId); hero.settledIds=hero.settledIds.slice(-8);
    hero.rewardedRoom = encounter.room;
    hero.hp = Math.max(1, hero.hp - encounter.damage);
    if (!encounter.won) {
      hero.cycleComplete=true; hero.supplies=0;
      this.record('retreated', { room: hero.room });
      setScene(hero, hero.recallRequested?'returning':'field_recovery', hero.recallRequested?HERO_RULES.returnMs:EXPEDITION.recoveryMs);
      return;
    }
    if(['spring','mystery'].includes(encounter.kind)) {
      hero.dungeon.light=Math.min(100,hero.dungeon.light+30);hero.hp=Math.min(hero.maxHp,hero.hp+12);
      if(encounter.kind==='mystery')this.reward(0,{silver:1});
    }
    if(encounter.kind==='elite')hero.dungeon.eliteWins++;
    if(encounter.kind==='boss')hero.dungeon.bossWins++;
    this.reward(encounter.xp, encounter.loot);
    if(encounter.equipmentDrop)grantEquipment(this.world,encounter.equipmentDrop.definition,encounter.equipmentDrop.grade,settlementId,'loot');
    wearEquipment(hero,encounter.equipmentIds);
    if(['spring','mystery'].includes(encounter.kind))recordEvent(this.world.state,{source:'world',actor:'home',action:'hero_rest',time:this.world.state.time,messageKey:'dungeon.peaceful',messageParams:{kind:{messageKey:'dungeon.'+encounter.kind,messageParams:{}}}});
    else this.record('encounter_won', { room: hero.room, xp: encounter.xp,
      monster: { messageKey: `hero.monster.${encounter.monsterId}`, messageParams: {} } });
    if (hero.room === HERO_RULES.rooms && !hero.clearRewarded) {
      hero.clearRewarded = true;
      hero.settledIds.push(`${hero.missionId}:${hero.cycleId}:clear`); hero.settledIds=hero.settledIds.slice(-8);
      hero.cycleComplete=true; hero.supplies=0;
      hero.dungeonsCleared++;
      this.reward(24, { gold: 2, silver: 2 });
      awardEquipmentGoals(this.world);
      this.record('dungeon_cleared', { count: hero.dungeonsCleared, xp: 24 });
    }
    setScene(hero, 'victory', HERO_RULES.victoryMs, { monsterId: ['spring','mystery'].includes(encounter.kind)?null:encounter.monsterId, enemyHp: 0 });
  }

  update(elapsedMs) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('Invalid hero elapsed time');
    const hero = this.world.state.hero;
    if (!hero || !elapsedMs) return;
    if (hero.mode === 'awaiting') {
      if (this.world.state.time >= hero.arriveAt && restoreHeroEntity(this.world)) { setScene(hero, 'home'); this.record('arrived'); }
      return;
    }
    syncHeroEquipment(hero);
    if (hero.mode === 'home') {
      if(hero.hp<hero.maxHp){setScene(hero,'recovering',HERO_RULES.recoveryMs);return;}
      depositEquipment(this.world);awardEquipmentGoals(this.world);
      if (bagSize(hero)) {depositBag(this.world); hero.waitReason=bagSize(hero)?'storage':null;}
      hero.scene.elapsedMs = (hero.scene.elapsedMs + Math.min(HERO_RULES.maxElapsedMs, elapsedMs)) % HERO_TRAINING_MS;
      return;
    }
    if (hero.mode === 'defending') return;
    if (hero.mode === 'supply_wait') { startSupply(this.world); return; }
    if (hero.mode === 'cargo_wait') {
      if (hero.waitReason==='storage') { if (depositBag(this.world)) {hero.waitReason=null; expeditionScene(hero,'camp',EXPEDITION.campMs);} }
      else startShipping(this.world);
      return;
    }
    const scene = hero.scene;
    scene.elapsedMs = Math.min(scene.durationMs, scene.elapsedMs + Math.min(HERO_RULES.maxElapsedMs, elapsedMs));
    if (hero.mode === 'fighting') {
      const progress = scene.elapsedMs / scene.durationMs;
      scene.enemyHp = Math.max(1, Math.ceil(hero.encounter.enemyMaxHp * (1 - progress)));
      scene.heroHp = Math.max(1, hero.encounter.startHp - Math.floor(hero.encounter.damage * progress));
    }
    if (scene.elapsedMs < scene.durationMs) return;
    switch (hero.mode) {
      case 'outbound':
        setScene(hero, 'exploring', HERO_RULES.exploreMs);
        break;
      case 'exploring':
        this.beginEncounter();
        break;
      case 'fighting':
        this.finishEncounter();
        break;
      case 'victory':
        if (hero.recallRequested) setScene(hero, 'returning', HERO_RULES.returnMs);
        else if (hero.room >= HERO_RULES.rooms) expeditionScene(hero,'camp',EXPEDITION.campMs);
        else { hero.room++; setScene(hero, 'exploring', HERO_RULES.exploreMs); }
        break;
      case 'camp':
        if (bagSize(hero)>=EXPEDITION.shippingThreshold||hero.equipment?.items.some(i=>i.location==='loot')) { startShipping(this.world); break; }
        if (hero.hp<hero.maxHp) { expeditionScene(hero,'field_recovery',EXPEDITION.recoveryMs); break; }
        if (!hero.supplies) { startSupply(this.world); break; }
        hero.cycleId++; hero.depth=hero.nextDepth; hero.room=1; hero.rewardedRoom=0;
        hero.clearRewarded=false; hero.cycleComplete=false; hero.encounter=null;
        hero.rngState=(Math.imul(hero.rngState,1664525)+1013904223)>>>0; hero.runSeed=hero.rngState;
        prepareDungeonRoute(hero);
        setScene(hero,'exploring',HERO_RULES.exploreMs);
        break;
      case 'field_recovery':
        hero.hp=hero.maxHp; expeditionScene(hero,'camp',EXPEDITION.campMs); break;
      case 'resupplying':
        hero.supplies=1; expeditionScene(hero,'camp',EXPEDITION.campMs); break;
      case 'shipping':
        hero.shipmentCount++;
        if (depositBag(this.world)) expeditionScene(hero,'camp',EXPEDITION.campMs);
        else {hero.waitReason='storage'; expeditionScene(hero,'cargo_wait');this.onEvent({source:'priest',action:'storage_wait',actor:'home',time:this.world.state.time,messageKey:'exp.wait.storage',messageParams:{}});}
        this.record('shipped'); break;
      case 'returning':
        if (!restoreHeroEntity(this.world)) { scene.elapsedMs = 0; break; }
        depositBag(this.world);
        hero.waitReason=bagSize(hero)?'storage':null;
        hero.recallRequested = false;
        hero.encounter = null;
        setScene(hero, hero.hp < hero.maxHp ? 'recovering' : 'home', hero.hp < hero.maxHp ? HERO_RULES.recoveryMs : 0);
        this.record('returned', { level: hero.level });
        break;
      case 'recovering':
        if (!restoreHeroEntity(this.world)) { scene.elapsedMs = 0; break; }
        hero.hp = hero.maxHp;
        setScene(hero, 'home');
        this.record('recovered');
        break;
    }
  }
}
