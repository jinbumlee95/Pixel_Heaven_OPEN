import { faithRule } from '../content/religion.js';
import { GAME_DAY_SECONDS } from './GameTime.js';

export const FAITH_RULES = Object.freeze({ initial: 30, capacity: 100, perPersonPerDay: 0.75 });
export const DIVINE_FAITH_COSTS = Object.freeze({
  prepare_fire: 6, prepare_flood: 6, prepare_cold: 6,
  hold_festival: 8, propose_alliance: 8, propose_truce: 8,
  build_house: 8, farm: 8, build_temple: 8,
  create_rain: 18, create_forest: 12, bless_village: 10, curse_village: 10,
  increase_food: 0.35, interpretation: 8, hero_dispatch: 8, hero_recall: 3,
  prepare_defense: Object.freeze({ balanced: 10, cover: 6, barricade: 8, trap: 6, traps: 6 }),
});
export const createFaithState = () => ({ points: FAITH_RULES.initial,
  capacity: FAITH_RULES.capacity, generated: 0, spent: 0 });
const validCost = cost => Number.isFinite(cost) && cost >= 0;

// This quotes a validated action. Target/schema validation stays at the engine
// mutation boundary, where rejected commands cannot charge a partial price.
export function quoteDivineCost(action) {
  const name = typeof action === 'string' ? action : action?.action;
  const parameters = typeof action === 'object' ? action?.parameters ?? {} : {};
  if (name === 'prepare_defense') return DIVINE_FAITH_COSTS.prepare_defense[parameters.preparation ?? 'balanced'] ?? 0;
  if (name === 'increase_food') return validCost(parameters.amount ?? 50)
    ? Math.ceil((parameters.amount ?? 50) * DIVINE_FAITH_COSTS.increase_food) : 0;
  const base = DIVINE_FAITH_COSTS[name];
  if (typeof base !== 'number') return 0;
  // Any rain averts one committed drought, so its price cannot be discounted
  // by asking for a fractional intensity while retaining the full protection.
  const strength = ['bless_village', 'curse_village'].includes(name) ? parameters.strength ?? 1 : 1;
  return validCost(strength) ? Math.ceil(base * strength) : 0;
}
export function canSpendFaith(state, cost) {
  return validCost(cost) && Number.isFinite(state.faith?.points)
    && state.faith.points >= cost && state.faith.points >= 0;
}
export function spendFaith(state, cost) {
  if (!canSpendFaith(state, cost)) return false;
  state.faith.points -= cost;
  state.faith.spent = (Number.isFinite(state.faith.spent) ? state.faith.spent : 0) + cost;
  return true;
}
export function faithCapacity(state) {
  const home=state.villages.find(v=>v.id==='home');
  return state.religion?Math.min(1000,60+(state.religion.treeLevel??0)*20+Math.max(0,home?.population??0)*5+Math.max(0,home?.templeCount??0)*20):FAITH_RULES.capacity;
}
export function refundFaith(state, cost) {
  if (!validCost(cost) || !canSpendFaith(state, 0)) return false;
  state.faith.points = state.faith.points + cost;
  state.faith.spent = Math.max(0, (Number.isFinite(state.faith.spent) ? state.faith.spent : 0) - cost);
  return true;
}
export function faithGenerationPerDay(state) {
  const home = state.villages.find(village => village.id === state.playerSettlementId) ?? state.villages[0];
  const population = Number.isFinite(home?.population) ? Math.max(0, home.population) : 0;
  const morale = Math.max(0.6, Math.min(1.3, 1 + ((home?.happiness ?? 63) - 63) * 0.005));
  const temple = 1 + (home?.religion === 'none' ? 0 : home?.templeCondition ?? home?.templeCount ?? 0) * 0.25;
  const devotion = (home?.devotionUntil ?? 0) > state.time ? 1.25 : 1;
  return population * FAITH_RULES.perPersonPerDay * morale * temple * devotion * (1+(state.religion?.treeLevel??0)*0.1) * faithRule(state,'faithProduction');
}
export function accrueFaith(state, seconds = 1) {
  if (!state.faith || !validCost(seconds) || seconds === 0) return 0;
  const capacity=faithCapacity(state);
  const before = Number.isFinite(state.faith.points) ? Math.max(0,state.faith.points) : 0;
  const received = Math.min(Math.max(0,capacity - before), faithGenerationPerDay(state) * seconds / GAME_DAY_SECONDS);
  state.faith.points = before + received;
  state.faith.capacity = capacity;
  state.faith.generated = (Number.isFinite(state.faith.generated) ? state.faith.generated : 0) + received;
  return received;
}
