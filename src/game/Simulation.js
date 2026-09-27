import { updateReligion } from './Religion.js';
import { faithRule } from '../content/religion.js';
import { stockLimit } from '../state/economy.js';
import { syncResourceTotals } from '../state/worldState.js';
import { ECONOMY, RESOURCE_RULES, RESOURCE_TYPES, isExpandedEconomy,
  housingCapacity, resourceAmount, canAffordResources, spendResources } from '../state/economy.js';
import { accrueFaith } from './Faith.js';

export const TICK_INTERVAL_MS = 1000;
export const RULES = Object.freeze({
  foodPerPerson: 0.12, consumptionPerPerson: 0.1, woodPerPerson: 0.025,
  growthEveryTicks: 10, growthRate: 0.02, starvationRate: 0.02,
});

export function foodBalance(village, globalWeather = 'clear') {
  const weather = village.weather ?? globalWeather;
  const weatherFactor = weather === 'rain' ? 1 + 0.25 * (village.rainStrength ?? 1)
    : weather === 'drought' ? (village.droughtFactor ?? 0.4) : 1;
  // Legacy minimal states without a farm count retain their original math.
  const workers = village.labor ? Math.min(village.labor.farming, (village.farmCount ?? 0) * ECONOMY.workersPerFarm) : village.farmCount === undefined ? village.population
    : Math.min(village.population, village.farmCount * ECONOMY.workersPerFarm);
  return { production: workers * (village.labor ? 0.24 : RULES.foodPerPerson) * weatherFactor * (village.harvestCondition ?? 1),
    consumption: village.population * RULES.consumptionPerPerson };
}

// Aggregate math only: no grid, building or decorative entity reads.
export function tick(state) {
  state.time += 1;
  for (const village of state.villages) {
    if (Number.isFinite(village.rainUntil) && state.time >= village.rainUntil) {
      if (village.weather === 'rain') village.weather = 'clear';
      delete village.rainStrength;
      delete village.rainUntil;
    }
    if(village.id==='home'&&state.religion?.commandments.includes('toil')&&state.time%60===0)village.happiness=Math.max(0,village.happiness-1);
    const population = Math.max(0, Math.floor(Number.isFinite(village.population) ? village.population : 0));
    village.population = population;
    const expanded = isExpandedEconomy(village);
    for (const resource of expanded ? RESOURCE_TYPES : ['food', 'wood']) village[resource] = resourceAmount(village, resource);
    const prior=Object.fromEntries(RESOURCE_TYPES.map(id=>[id,resourceAmount(village,id)]));
    const balance = foodBalance(village, state.weather);
    const production=balance.production*faithRule(state,'foodProduction'),consumption=balance.consumption*faithRule(state,'foodConsumption');
    const available = village.food + production;
    village.food = Math.max(0, available - consumption);
    village.wood += (village.labor ? Math.min(village.labor.woodcutting, village.forestCapacity ?? 4) * 0.2 : population * RULES.woodPerPerson)*faithRule(state,'woodProduction');
    if (available < consumption) {
      village.starvationTicks = (village.starvationTicks ?? 0) + 1;
      if (!expanded || village.starvationTicks >= ECONOMY.settlementStarvationInterval) {
        village.population = Math.max(0, population - Math.ceil(population * RULES.starvationRate));
        village.starvationTicks = 0;
      }
    } else if (expanded) {
      village.starvationTicks = 0;
      if (population > 0 && state.time % (ECONOMY.settlementGrowthInterval*(state.religion?.commandments.includes('restraint')?2:1)) === 0
        && population < housingCapacity(village)
        && village.food >= population * RULES.consumptionPerPerson * ECONOMY.settlementReserveTicks) village.population++;
    } else if (population > 0 && state.time % RULES.growthEveryTicks === 0
      && village.food >= population * RULES.consumptionPerPerson * RULES.growthEveryTicks) {
      village.population += Math.max(1, Math.floor(population * RULES.growthRate));
    }
    if (expanded && population > 0) advanceMaterials(village, state.time, population,
      village.id === 'home' && state.production?.jobs.some(j => j.status === 'working'));
    if(village.productionVersion===1)for(const id of RESOURCE_TYPES)village[id]=Math.min(Math.max(prior[id],stockLimit(village,id)),village[id]);
  }
  accrueFaith(state);
  syncResourceTotals(state);
  updateReligion(state);
}

function advanceMaterials(village, time, population, reservedCrafters = false) {
  if (village.productionVersion === 1) {
    // Bounded aggregate collection: no per-citizen or full-map searches.
    const ore = Math.min(village.oreDeposit ?? 0, (village.labor?.mining ?? 0) * 0.04, Math.max(0, stockLimit(village,'iron_ore') - village.iron_ore));
    village.iron_ore += ore; village.oreDeposit -= ore;
    village.fiber += Math.min(village.labor?.farming ?? 0, (village.farmCount ?? 0) * ECONOMY.workersPerFarm) * 0.008 * (village.harvestCondition ?? 1);
  }
  for (const [resource, rate] of Object.entries(RESOURCE_RULES.gathering)) village[resource] += (village.labor ? village.labor.mining * 8 : population) * rate;
  if (time % RESOURCE_RULES.processInterval === 0) {
    const scale = reservedCrafters ? 0 : Math.min(RESOURCE_RULES.maxProcessScale, (village.labor ? village.labor.crafting * 8 : population) / RESOURCE_RULES.processWorkers);
    const reserves = { food: population * RULES.consumptionPerPerson * ECONOMY.settlementReserveTicks, wood: ECONOMY.houseWood, coal: 2 };
    for (const process of RESOURCE_RULES.processes) {
      if (village.productionVersion === 1 && ['smelting', 'weaving'].includes(process.id)) continue;
      if (village[process.output] >= RESOURCE_RULES.stockPerProcessScale * scale) continue;
      const cost = Object.fromEntries(Object.entries(process.input).map(([resource, amount]) => [resource, amount * scale]));
      if (!canAffordResources(village, cost) || Object.entries(cost).some(([resource, amount]) =>
        village[resource] - amount < (reserves[resource] ?? 0))) continue;
      spendResources(village, cost);
      village[process.output] += process.amount * scale;
    }
  }
  if (time % RESOURCE_RULES.householdInterval === 0) {
    for (const [resource, amount] of Object.entries(RESOURCE_RULES.householdPerPerson)) village[resource] = Math.max(0, village[resource] - amount * population);
  }
}
