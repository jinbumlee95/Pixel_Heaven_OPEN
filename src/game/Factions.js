import { recordEvent } from '../game/EventJournal.js';
import { syncResourceTotals } from '../state/worldState.js';

export const FACTION_RULES = Object.freeze({ count: 24, minCount: 20, maxCount: 30,
  interval: 15, pairsPerUpdate: 6, historyLimit: 24, maxResource: 500, aidInterval: 60 });
const TEMPERAMENTS = ['aggressive', 'mercantile', 'cooperative', 'guarded'];
const STANCES = ['hostile', 'neutral', 'allied', 'neutral', 'hostile', 'allied'];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function seedNumber(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  if (typeof seed !== 'string') return 72913;
  let value = 2166136261;
  for (const char of seed) value = Math.imul(value ^ char.codePointAt(0), 16777619) >>> 0;
  return value;
}

function nextRandom(state) {
  state.rngState = (Math.imul(state.rngState, 1664525) + 1013904223) >>> 0;
  return state.rngState / 4294967296;
}

export function createSeededRandom(seed = 72913) {
  const state = { rngState: seedNumber(seed) };
  return () => nextRandom(state);
}

export function createFactions({ count = FACTION_RULES.count, seed = 72913 } = {}) {
  if (!Number.isInteger(count) || count < FACTION_RULES.minCount || count > FACTION_RULES.maxCount) {
    throw new RangeError('An external world contains 20–30 factions.');
  }
  const random = createSeededRandom(seed);
  const factions = Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return { id: `faction-${number}`, nameKey: `faction.name.${number}`, name: `Outer group ${number}`,
      temperament: TEMPERAMENTS[Math.floor(random() * TEMPERAMENTS.length)],
      strength: 35 + Math.floor(random() * 50),
      resources: { food: 70 + Math.floor(random() * 90), wood: 35 + Math.floor(random() * 75) },
      stance: STANCES[index % STANCES.length], relations: {} };
  });
  // A few existing ties make the outside world feel established. These groups
  // have no grid position, population entities, map, or player command queue.
  for (let index = 0; index + 1 < factions.length; index += 4) {
    setPairRelation(factions[index], factions[index + 1], index % 8 === 0 ? 'war' : 'allied');
  }
  return factions;
}

function setPairRelation(a, b, value) {
  a.relations[b.id] = value;
  b.relations[a.id] = value;
}

export function factionReference(faction) {
  return { factionId: faction.id, nameKey: faction.nameKey, name: faction.name };
}

export function summarizeFactions(factions, time = 0) {
  const hostile = factions.filter(faction => faction.stance === 'hostile');
  const allied = factions.filter(faction => faction.stance === 'allied');
  const traders = factions.filter(faction => faction.stance !== 'hostile' && faction.resources.food >= 25);
  const count = Math.max(1, factions.length);
  const score = (items, value) => Math.round(clamp(items.reduce((sum, faction) => sum + value(faction), 0) / count, 0, 100));
  return { threat: score(hostile, faction => faction.strength),
    support: score(allied, faction => faction.strength),
    trade: score(traders, faction => Math.min(100, faction.resources.food / 2)),
    hostileCount: hostile.length, alliedCount: allied.length,
    neutralCount: factions.length - hostile.length - allied.length, updatedAt: time };
}

// Read-only hooks for Emergence: this module never creates a second raid timer.
export function chooseHostileFaction(state, random) {
  const hostile = (state.factions ?? []).filter(faction => faction.stance === 'hostile' && faction.strength >= 20);
  if (!hostile.length) return null;
  if (!random) return structuredClone(hostile.reduce((best, faction) => faction.strength > best.strength ? faction : best));
  const total = hostile.reduce((sum, faction) => sum + faction.strength, 0);
  let cursor = clamp(Number(random()) || 0, 0, 1 - Number.EPSILON) * total;
  for (const faction of hostile) {
    cursor -= faction.strength;
    if (cursor < 0) return structuredClone(faction);
  }
  return structuredClone(hostile.at(-1));
}

export function allySupport(state) {
  return summarizeFactions(state.factions ?? [], state.time).support / 100;
}

export class Factions {
  constructor(world, { onEvent = () => {}, seed = 72913 } = {}) {
    this.world = world;
    this.onEvent = onEvent;
    const state = world.state;
    state.factions ??= createFactions({ seed });
    state.factionHistory ??= [];
    state.factionSimulation ??= { rngState: (seedNumber(seed) ^ 0x9e3779b9) >>> 0,
      nextUpdate: state.time + FACTION_RULES.interval, nextAid: state.time + FACTION_RULES.aidInterval,
      lastTick: state.time, sequence: 0 };
    state.worldConditions ??= summarizeFactions(state.factions, state.time);
  }

  random() { return nextRandom(this.world.state.factionSimulation); }

  record(action, actor, target, params = {}, message = '') {
    const state = this.world.state;
    const event = { source: 'factions', action: `faction_${action}`, actor: actor.id,
      target: target?.id ?? 'home', time: state.time,
      id: `faction-event-${++state.factionSimulation.sequence}`,
      messageKey: `faction.event.${action}`, message,
      messageParams: { faction: factionReference(actor),
        ...(target ? { target: factionReference(target) } : {}), ...params } };
    state.factionHistory.push(event);
    if (state.factionHistory.length > FACTION_RULES.historyLimit) state.factionHistory.shift();
    recordEvent(state,event);
    this.onEvent(event);
  }

  interact(a, b) {
    const relation = a.relations[b.id] ?? 'neutral';
    const roll = this.random();
    if (relation === 'war') {
      if (Math.min(a.strength, b.strength) < 22 || Math.min(a.resources.food, b.resources.food) < 12 || roll < 0.2) {
        setPairRelation(a, b, 'neutral');
        this.record('truce', a, b, {}, `${a.name} and ${b.name} agreed to a truce.`);
      } else {
        const loss = 3 + Math.floor(this.random() * 5);
        a.strength = Math.max(5, a.strength - loss);
        b.strength = Math.max(5, b.strength - loss - 1);
        a.resources.food = Math.max(0, a.resources.food - 4);
        b.resources.food = Math.max(0, b.resources.food - 4);
        this.record('conflict', a, b, { loss }, `${a.name} and ${b.name} lost strength in a border conflict.`);
      }
      return;
    }
    if (relation === 'allied' || (roll < 0.4 && a.temperament !== 'aggressive')) {
      const food = Math.min(5, a.resources.food, FACTION_RULES.maxResource - b.resources.food);
      const wood = Math.min(2, b.resources.wood, FACTION_RULES.maxResource - a.resources.wood);
      if (food > 0 && wood > 0) {
        a.resources.food -= food; b.resources.food += food;
        b.resources.wood -= wood; a.resources.wood += wood;
        this.record('trade', a, b, { food, wood }, `${a.name} traded ${food} food for ${wood} wood with ${b.name}.`);
      }
      return;
    }
    if (a.temperament === 'aggressive' && roll < 0.65) {
      const food = Math.min(9, b.resources.food, FACTION_RULES.maxResource - a.resources.food);
      b.resources.food -= food; a.resources.food += food;
      a.strength = Math.max(5, a.strength - 2);
      b.strength = Math.max(5, b.strength - 4);
      setPairRelation(a, b, 'war');
      this.record('raid', a, b, { food }, `${a.name} raided ${b.name} and took ${food} food.`);
    } else if (a.temperament !== 'aggressive' && b.temperament !== 'aggressive' && roll < 0.8) {
      setPairRelation(a, b, 'allied');
      this.record('alliance', a, b, {}, `${a.name} and ${b.name} formed an alliance.`);
    } else {
      const gain = Math.min(2, 100 - a.strength);
      a.strength += gain;
      if (gain > 0) this.record('recovery', a, null, { strength: gain }, `${a.name} recovered ${gain} strength.`);
    }
  }

  updateHomeAid() {
    const state = this.world.state;
    const simulation = state.factionSimulation;
    if (state.time < simulation.nextAid) return;
    simulation.nextAid = state.time + FACTION_RULES.aidInterval;
    const home = state.villages.find(village => village.id === 'home');
    if (!home || home.population <= 0) return;
    const donor = state.factions.filter(faction => faction.stance === 'allied' && faction.resources.food >= 30)
      .sort((a, b) => b.resources.food - a.resources.food)[0];
    if (donor && home.food < home.population * 3) {
      const food = 6;
      donor.resources.food -= food;
      home.food += food;
      this.record('aid', donor, null, { food }, `${donor.name} sent ${food} food to our settlement.`);
      syncResourceTotals(state);
    }
  }

  update() {
    const state = this.world.state;
    const simulation = state.factionSimulation;
    if (state.time <= simulation.lastTick) return;
    simulation.lastTick = state.time;
    if (state.time < simulation.nextUpdate) return;
    simulation.nextUpdate = state.time + FACTION_RULES.interval;
    for (const faction of state.factions) {
      faction.resources.food = clamp(faction.resources.food + 4 - Math.ceil(faction.strength / 25), 0, FACTION_RULES.maxResource);
      faction.resources.wood = clamp(faction.resources.wood + 1, 0, FACTION_RULES.maxResource);
      faction.strength = clamp(faction.strength + (faction.resources.food > 20 ? 1 : -1), 5, 100);
      const previous = faction.stance;
      if (faction.stance === 'hostile' && faction.strength < 25) faction.stance = 'neutral';
      else if ((faction.treatyUntil ?? 0) <= state.time && faction.stance === 'neutral' && faction.temperament === 'aggressive' && faction.strength > 65 && this.random() < 0.12) faction.stance = 'hostile';
      else if (faction.stance === 'neutral' && faction.temperament === 'cooperative' && faction.resources.food > 80 && this.random() < 0.12) faction.stance = 'allied';
      if (previous !== faction.stance) this.record(`stance_${faction.stance}`, faction, null, {}, `${faction.name} is now ${faction.stance} toward our settlement.`);
    }
    // Shuffle at most thirty aggregate records; six disjoint pairs per update.
    const order = [...state.factions];
    for (let index = order.length - 1; index > 0; index--) {
      const other = Math.floor(this.random() * (index + 1));
      [order[index], order[other]] = [order[other], order[index]];
    }
    for (let index = 0; index < Math.min(order.length - 1, FACTION_RULES.pairsPerUpdate * 2); index += 2) {
      this.interact(order[index], order[index + 1]);
    }
    this.updateHomeAid();
    state.worldConditions = summarizeFactions(state.factions, state.time);
  }

  snapshot() {
    const { factions, factionHistory, factionSimulation, worldConditions } = this.world.state;
    return structuredClone({ factions, factionHistory, factionSimulation, worldConditions });
  }
}
