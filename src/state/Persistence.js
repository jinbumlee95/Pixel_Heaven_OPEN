import { validReligion } from '../game/Religion.js';
import { validEquipment } from '../game/Equipment.js';
import { RECIPES } from '../content/production.js';
import { validExpedition, AWAY_MODES } from '../game/Expedition.js';
import { validTradeVisit } from '../game/Trading.js';
import { validOrder } from '../game/ChatCommands.js';
import { World } from '../game/World.js';
import { defaultContent, builtinPack } from '../content/builtin.js';
import { createContentRegistry } from '../content/ContentRegistry.js';
import { RESOURCE_TYPES } from './economy.js';
import { validProduction } from '../game/Production.js';
import { validLegends } from '../game/Legends.js';
import { validWonders } from '../game/Wonders.js';

export const SAVE_VERSION = 5;
const mapNames = ['buildings', 'terrain', 'entities', 'groundTiles'];
function checkData(value, depth = 0, budget = { count: 0 }) {
  if (++budget.count > 200000 || depth > 40) throw Error('save_too_large');
  if (typeof value === 'number' && !Number.isFinite(value)) throw Error('invalid_number');
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  if (!value || typeof value !== 'object') throw Error('invalid_data');
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw Error('invalid_key');
    checkData(child, depth + 1, budget);
  }
}
export function encodeWorld(world, runtime = {}, packs = []) {
  const state = structuredClone(world.state);
  delete state.occupied;
  for (const key of mapNames) state[key] = [...(state[key] ?? new Map())];
  const document = { version: SAVE_VERSION, state, nextId: world.nextId, runtime, packs };
  // JSON discards optional undefined fields; validate the actual persisted form.
  const text = JSON.stringify(document);
  if (text.length > 8_000_000) throw Error('save_too_large');
  checkData(JSON.parse(text));
  return text;
}
export function decodeWorld(text) {
  if (typeof text !== 'string' || text.length > 8_000_000) throw Error('invalid_save');
  const data = JSON.parse(text); checkData(data);
  if (![1, 2, 3, 4, SAVE_VERSION].includes(data.version)) throw Error('unsupported_save_version');
  if (data.version === 1) {
    if(!data.state.groundTiles){const anchor=data.state.villages?.[0]?.anchor;
      data.state.groundTiles=anchor?[-2,-1,0,1].flatMap(dx=>[4,5,6,7].map(dy=>{const position={x:anchor.x+dx,y:anchor.y+dy};return [`${position.x},${position.y}`,{type:'stone_paving',villageId:'home',position}];})):[];
    }
    data.runtime ??= {}; data.packs ??= []; data.version = 2;
  }
  const state = data.state;
  if(state.eventSequence!==undefined&&(!Number.isSafeInteger(state.eventSequence)||state.eventSequence<0))throw Error('invalid_event_sequence');
  if (!state || !Number.isSafeInteger(state.time) || state.time < 0 || state.playerSettlementId !== 'home'
    || !Array.isArray(state.villages) || state.villages.length !== 1 || state.villages[0].id !== 'home') throw Error('invalid_settlement');
  const home = state.villages[0];
  if (home.productionVersion !== undefined && home.productionVersion !== 1) throw Error('invalid_production_version');
  if (home.oreDeposit !== undefined && (!Number.isFinite(home.oreDeposit) || home.oreDeposit < 0 || home.oreDeposit > 240)) throw Error('invalid_ore_deposit');
  if (data.version === 2) {
    // Preserve all existing stock and work. No free materials or retroactive output.
    home.iron_ore ??= 0; home.fiber ??= 0;
    data.version = 3;
  }
  if(data.version===3){for(const id of ['tools','planks','medicine','rations','crafts'])home[id]??=0;data.version=4;}
  if (!Number.isSafeInteger(home.population) || home.population < 0 || home.population > 100000) throw Error('invalid_population');
  for (const id of RESOURCE_TYPES) if (!Number.isFinite(home[id]) || home[id] < 0) throw Error('invalid_resources');
  if(state.religion&&!validReligion(state.religion))throw Error('invalid_religion');
  if (!state.faith || !Number.isFinite(state.faith.points) || state.faith.points < 0 || state.faith.points > (state.religion?1020:100)) throw Error('invalid_faith');
  const content = data.packs?.length ? createContentRegistry([builtinPack, ...data.packs]) : defaultContent;
  for(const id of Object.keys(content.resources)){home[id]??=0;if(!Number.isFinite(home[id])||home[id]<0)throw Error('invalid_resources');}
  if(home.productionVersion===1||Object.keys(content.resources).length>RESOURCE_TYPES.length){
  home.modResources=Object.keys(content.resources).filter(id=>!RESOURCE_TYPES.includes(id));
  home.resourceLimits=Object.fromEntries(Object.entries(content.resources).map(([id,r])=>[id,r.stackLimit]));
  }
  if(state.rules && JSON.stringify(state.rules)!==JSON.stringify(content.rules))throw Error('pack_rules_mismatch');
  for (const key of mapNames) {
    if (!Array.isArray(state[key]) || state[key].length > 20000) throw Error('invalid_map');
    const entries = state[key]; state[key] = new Map(entries);
    if (entries.length !== state[key].size) throw Error('duplicate_id');
  }
  state.occupied = new Map();
  const world = new World(state, { content });
  if (!Number.isSafeInteger(data.nextId) || data.nextId < 1) throw Error('invalid_sequence');
  world.nextId = data.nextId;
  const ids = new Set();
  for (const key of ['buildings', 'terrain', 'entities']) for (const [id, object] of state[key]) {
    const definition = content.get(object.type);
    if (object.id !== id || ids.has(id) || !definition || object.villageId !== 'home'
      || definition.kind!==({buildings:'building',terrain:'terrain',entities:'entity'}[key])
      || object.footprint?.w !== definition.footprint.w || object.footprint?.h !== definition.footprint.h
      || !Number.isInteger(object.position?.x) || !Number.isInteger(object.position?.y)
      || object.position.x < 0 || object.position.y < 0 || object.position.x + object.footprint.w > 2000
      || object.position.y + object.footprint.h > 2000) throw Error('invalid_object');
    ids.add(id);
    if(object.damage!==undefined&&(!Number.isFinite(object.damage)||object.damage<0||object.damage>100))throw Error('invalid_damage');
    const sequence=Number(id.split('_').at(-1));
    if(!Number.isSafeInteger(sequence)||sequence>=world.nextId)throw Error('invalid_sequence');
    if (object.hidden) continue;
    for (let y = 0; y < object.footprint.h; y++) for (let x = 0; x < object.footprint.w; x++) {
      const cell = `${object.position.x + x},${object.position.y + y}`;
      if (state.occupied.has(cell)) throw Error('overlapping_objects');
    }
    world.occupy(object);
  }
  for (const [key, tile] of state.groundTiles) {
    if (content.get(tile.type)?.kind !== 'ground' || key !== `${tile.position?.x},${tile.position?.y}`
      || !Number.isInteger(tile.position?.x) || !Number.isInteger(tile.position?.y)
      || tile.position.x<0 || tile.position.y<0 || tile.position.x>=2000 || tile.position.y>=2000) throw Error('invalid_ground');
  }
  if (![...state.entities.values()].some(entity => entity.type === 'priest')) throw Error('missing_priest');
  if (state.hero && state.entities.get(state.hero.entityId)?.type!=='hero') throw Error('missing_hero');
  if(state.sanctuary&&(state.terrain.get(state.sanctuary.treeId)?.type!=='world_tree'||state.buildings.get(state.sanctuary.altarId)?.type!=='altar'))throw Error('invalid_sanctuary');
  if (!data.runtime || typeof data.runtime !== 'object' || !Array.isArray(data.packs)) throw Error('invalid_runtime');
  validateSystems(state,data.runtime,content);
  return { world, runtime: data.runtime, packs: data.packs };
}

function validateSystems(s,r,content) {
  if (s.production && !validProduction(s.production, s.time, content.recipes??RECIPES)) throw Error('invalid_production');
  const number=(n,min=0,max=Number.MAX_SAFE_INTEGER)=>{if(!Number.isFinite(n)||n<min||n>max)throw Error('invalid_system_number');};
  const array=(a,max)=>{if(!Array.isArray(a)||a.length>max)throw Error('invalid_system_list');return a;};
  const one=(v,choices)=>{if(!choices.includes(v))throw Error('invalid_system_state');};
  const point=p=>{number(p?.x,0,1999);number(p?.y,0,1999);if(!Number.isInteger(p.x)||!Number.isInteger(p.y))throw Error('invalid_position');};
  const unique=items=>{if(new Set(items.map(i=>i.id)).size!==items.length)throw Error('duplicate_id');};
  const h=s.villages[0];point(h.anchor);number(h.settlementRadius,1,100);number(h.happiness,0,100);
  if(s.legends!==undefined&&!validLegends(s.legends))throw Error('invalid_legends');
  if(s.wonders!==undefined&&!validWonders(s.wonders))throw Error('invalid_wonders');
  for(const key of ['randomState','motionRandomState','wonderRandomState'])if(s[key]!==undefined){number(s[key],0,4294967295);if(!Number.isInteger(s[key]))throw Error('invalid_random');}
  if(h.labor){let sum=0;for(const role of ['farming','woodcutting','mining','crafting','building','defense','husbandry']){number(h.labor[role],0,h.population);if(!Number.isInteger(h.labor[role]))throw Error('invalid_labor');sum+=h.labor[role];}if(sum>h.population)throw Error('invalid_labor');}
  if(s.factions){unique(array(s.factions,30));if(s.factions.length<20)throw Error('invalid_factions');for(const f of s.factions){one(f.stance,['hostile','neutral','allied']);one(f.temperament,['aggressive','mercantile','cooperative','guarded']);number(f.strength,0,100);for(const n of Object.values(f.resources))number(n);if(!f.relations||typeof f.relations!=='object')throw Error('invalid_relations');}}
  if(s.eventQueue){unique(array(s.eventQueue,4));for(const p of s.eventQueue){one(p.kind,['raid','drought','fire','flood','cold']);one(p.stage,['forecast','active','resolved','averted']);number(p.announcedAt);number(p.startAt,p.announcedAt);number(p.endAt,p.startAt);number(p.severity,1,3);if(p.playerDecision!==undefined)one(p.playerDecision,['autonomous','receiving','responded','failed']);if(!p.mitigation||typeof p.mitigation!=='object')throw Error('invalid_mitigation');for(const e of array(p.exposure??[],24))point(e.position);}}
  if(s.work){number(s.work.sequence);number(s.work.lastTick);array(s.work.ledger,24);unique(array(s.work.jobs,24));for(const j of s.work.jobs){one(j.status,['working','complete','cancelled']);number(j.required,1);number(j.progress,0,j.required);point(j.position);number(j.footprint?.w,1,8);number(j.footprint?.h,1,8);for(const [id,n]of Object.entries(j.cost)){one(id,RESOURCE_TYPES);number(n);}if(!j.repairId&&!['house','farmland','temple','smelter','weaver','smith','warehouse','sawmill','apothecary','kitchen'].includes(j.type))throw Error('invalid_job');}}
  if(s.combat){if(s.combat.nextCleanupAt!==undefined)number(s.combat.nextCleanupAt);if(s.combat.cleanupRequested!==undefined&&typeof s.combat.cleanupRequested!=='boolean')throw Error('invalid_cleanup');one(s.combat.stage,['idle','preparing','approaching','fighting','resolved']);unique(array(s.combat.units,12));array(s.combat.works,12);array(s.combat.effects,24);for(const u of s.combat.units){point(u.position);number(u.hp);number(u.maxHp,1);if(u.hp>u.maxHp)throw Error('invalid_health');one(u.side,['home','enemy','ally']);}}
  if(s.hero?.equipment&&!validEquipment(s.hero.equipment))throw Error('invalid_equipment');
  if(s.hero){const h=s.hero;one(h.mode,['awaiting','home','defending','outbound','exploring','fighting','victory','returning','recovering',...AWAY_MODES]);if(!validExpedition(h))throw Error('invalid_expedition');number(h.level,1,50);number(h.hp,0,h.maxHp);number(h.maxHp,1);number(h.xp);number(h.scene?.elapsedMs);number(h.scene?.durationMs);}
  if(s.story){one(s.story.profile,['steady','changing','gentle']);one(s.story.personality,['careful','hopeful']);array(s.story.memories,100);number(s.story.nextSequence,1);}
  if(s.diplomacy){unique(array(s.diplomacy.proposals,32));for(const p of s.diplomacy.proposals){one(p.status,['pending','counteroffer','accepted','rejected']);one(p.kind,['alliance','truce','trade']);number(p.responseAt);number(p.expiresAt,p.responseAt);for(const n of Object.values(p.cost))number(n);if(p.status==='counteroffer'&&p.extraCost?.silver!==3)throw Error('invalid_counteroffer');}}
  if(s.life){for(const id of ['sheep','deer','hunger','huntUntil','nextFeed','nextVisit','nextWolves','lastTick','sequence'])number(s.life[id]);number(s.life.sheep,0,6);number(s.life.deer,0,6);if(s.life.caravan){const c=s.life.caravan;one(c.stage,['forecast','visiting','departed']);number(c.arriveAt);number(c.departAt,c.arriveAt);number(c.earned,-100000,100000);if(!validTradeVisit(c,content.resources))throw Error('invalid_trade');if(c.equipmentStock!==undefined)number(c.equipmentStock,0,1);for(const id of ['food','herbs','cloth','sheep'])number(c.stock[id]);}if(s.life.lastTrade&&!validTradeVisit(s.life.lastTrade,content.resources))throw Error('invalid_trade');if(!s.life.representatives||typeof s.life.representatives!=='object')throw Error('invalid_representatives');}
  for(const [id,max]of Object.entries({divineHistory:50,interpretations:8,events:50,activeNeeds:30}))if(r[id]!==undefined)array(r[id],max);
  for(const e of r.divineHistory??[]){if(e.order&&!validOrder(e.order))throw Error('invalid_order');if(typeof e.message!=='string'||e.message.length>500||e.selectedTarget!=='home'||(e.outcome==='pending'&&e.processing==='interpreting'))throw Error('invalid_oracle');}
  if(r.nextMessageId!==undefined){number(r.nextMessageId,1);if((r.divineHistory??[]).some(e=>!Number.isInteger(e.id)||e.id>=r.nextMessageId))throw Error('invalid_message_sequence');}
  if(s.life)for(const [type,id]of Object.entries(s.life.representatives)){one(type,['merchant','pack_donkey','sheep','deer','wolf']);if(s.entities.get(id)?.type!==type)throw Error('invalid_representative');}
  for(const p of r.interpretations??[]){if(p.actor!=='home'||!['faith','peace','conflict','remembrance'].includes(p.intent))throw Error('invalid_interpretation');number(p.faithCost,0,100);number(p.time);}
}

// A saved mutable PRNG state belongs to the world, not to a closure that is lost on reload.
export function worldRandom(world, seed = 72913, key = 'randomState') {
  world.state[key] ??= (Number(seed) || 72913) >>> 0;
  return () => {
    world.state[key] = (Math.imul(world.state[key], 1664525) + 1013904223) >>> 0;
    return world.state[key] / 4294967296;
  };
}

export function parsePack(text) {
  if (typeof text !== 'string' || text.length > 1_000_000) throw Error('pack_too_large');
  const pack = JSON.parse(text);
  createContentRegistry([builtinPack, pack]);
  return pack;
}
export function parsePacks(text) {
  if(typeof text!=='string'||text.length>1_000_000)throw Error('pack_too_large');
  const parsed=JSON.parse(text), packs=Array.isArray(parsed)?parsed:[parsed];
  createContentRegistry([builtinPack,...packs]);return packs;
}
