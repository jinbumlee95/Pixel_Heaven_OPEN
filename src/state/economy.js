// Flat village inventories remain authoritative, including the historical
// food/wood fields used by faction aid, actions and isolated scenario fixtures.
import { RESOURCE_DEFINITIONS } from '../content/resources.js';
export const RESOURCE_TYPES = Object.freeze(Object.keys(RESOURCE_DEFINITIONS));
export const RESOURCE_RULES = Object.freeze({
  starting: Object.freeze({ food: 30, wood: 15, stone: 12, iron: 5, copper: 4,
    coal: 6, herbs: 4, cloth: 6, silver: 3, gold: 1, iron_ore: 0, fiber: 0, tools: 0, planks: 0, medicine: 0, rations: 0, crafts: 0 }),
  gathering: Object.freeze({ stone: 0.003, copper: 0.001, herbs: 0.0015,
    silver: 0.0002, gold: 0.00008 }),
  processInterval: 30, processWorkers: 8, maxProcessScale: 4,
  stockPerProcessScale: 12, householdInterval: 120,
  householdPerPerson: Object.freeze({ herbs: 0.04, cloth: 0.02 }),
  processes: Object.freeze([
    Object.freeze({ id: 'charcoal', input: Object.freeze({ wood: 2 }), output: 'coal', amount: 1 }),
    Object.freeze({ id: 'smelting', input: Object.freeze({ coal: 1 }), output: 'iron', amount: 1 }),
    // Households grow flax/fiber implicitly; provisions fund weaving work.
    Object.freeze({ id: 'weaving', input: Object.freeze({ food: 2 }), output: 'cloth', amount: 1 }),
  ]),
});
export const BUILDING_COSTS = Object.freeze({
  build_house: Object.freeze({ wood: 20, stone: 8, cloth: 2 }),
  farm: Object.freeze({ wood: 10, copper: 1, iron: 1 }),
  build_temple: Object.freeze({ wood: 30, stone: 20, silver: 5, gold: 2 }),
});
export const ECONOMY = Object.freeze({
  workersPerFarm: 12, peoplePerHouse: 30, settlementPeoplePerHouse: 12,
  houseWood: 20, farmWood: 10, reserveTicks: 12, settlementReserveTicks: 30, foodPerWood: 5, decisionInterval: 10,
  settlementGrowthInterval: 240, settlementStarvationInterval: 30,
});
export const isExpandedEconomy = village => village.economyVersion === 2;
export const reserveTicks = village => isExpandedEconomy(village) ? ECONOMY.settlementReserveTicks : ECONOMY.reserveTicks;
export function housingCapacity(village) {
  return Math.floor((village.housingCondition ?? 1) * (village.houseCount ?? 0) * (isExpandedEconomy(village)
    ? ECONOMY.settlementPeoplePerHouse : ECONOMY.peoplePerHouse));
}
export function resourceAmount(village, resource) {
  const value = village[resource];
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
export function canAffordResources(village, cost) {
  return Boolean(cost) && Object.entries(cost).every(([resource, amount]) =>
    (RESOURCE_TYPES.includes(resource) || village.modResources?.includes(resource)) && Number.isFinite(amount) && amount >= 0
      && resourceAmount(village, resource) >= amount);
}
// Validate the complete basket before charging any item.
export function spendResources(village, cost) {
  if (!canAffordResources(village, cost)) return false;
  for (const [resource, amount] of Object.entries(cost)) village[resource] = resourceAmount(village, resource) - amount;
  return true;
}
export function buildingCost(village, action) {
  const cost = BUILDING_COSTS[action];
  if (!cost) return null;
  // Historical minimal fixtures omit the schema marker. Playable new games
  // always use the complete basket; adding art cannot disable these costs.
  return isExpandedEconomy(village) ? cost : { wood: cost.wood };
}

export function stockLimit(home, id) { return (home.resourceLimits?.[id] ?? 1000) + (home.warehouseBonus ?? 0); }
