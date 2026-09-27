import { ECONOMY, RESOURCE_TYPES, buildingCost, housingCapacity, resourceAmount, reserveTicks, isExpandedEconomy } from '../state/economy.js';
import { foodBalance, RULES } from './Simulation.js';
import { SOCIETY } from '../state/society.js';

export function describeVillage(village, weather, rules = {}) {
  const balance = foodBalance(village, weather);
  const production=balance.production*(rules.foodProduction??1),consumption=balance.consumption*(rules.foodConsumption??1);
  const housing = housingCapacity(village);
  return { id: village.id, name: village.name, population: village.population,
    ...Object.fromEntries(RESOURCE_TYPES.map(resource => [resource, resourceAmount(village, resource)])),
    ...(village.labor ? { labor: { ...village.labor }, farmCapacity: (village.farmCount ?? 0) * ECONOMY.workersPerFarm } : {}),
    economyVersion: village.economyVersion, housing, production, consumption,
    constructionCosts: Object.fromEntries(['build_house', 'farm', 'build_temple'].map(action => [action, { ...buildingCost(village, action) }])),
    reserve: consumption * reserveTicks(village), happiness: village.happiness,
    religion: village.religion, relations: { ...village.relations }, templeCount: village.templeCount ?? 0,
    crisis: village.crisis ? { ...village.crisis } : null };
}

export function getWorldNeeds(state) {
  const needs = [];
  for (const village of state.villages) {
    const data = describeVillage(village, state.weather, state.rules);
    if (village.population <= 0) continue;
    const villageParam = { villageId: village.id, name: village.name };
    const raidPlan = state.eventQueue?.find(plan => plan.id === village.crisis?.planId && plan.kind === 'raid');
    const defended = (village.defenseUntil ?? 0) >= village.crisis?.resolveAt
      || Boolean(raidPlan && (raidPlan.mitigation.defense || village.preparedRaidId === raidPlan.id));
    if (village.crisis?.kind === 'raid') needs.push({ villageId: village.id, type: 'raid',
      message: `${village.name}: the raid resolves at tick ${village.crisis.resolveAt}. ${defended ? 'Defenders are ready.' : 'Prepare defenders now.'}`,
      messageKey: defended ? 'need.raid_ready' : 'need.raid',
      messageParams: { village: villageParam, tick: village.crisis.resolveAt },
      exampleKey: 'prompt.defense', messageExampleKey: 'prompt.defense',
      example: `prepare for battle in the ${village.id} village` });
    if (village.crisis?.kind === 'drought' && village.weather === 'drought') needs.push({ villageId: village.id, type: 'drought',
      message: `${village.name}: drought is reducing the harvest. Send rain to avert famine.`,
      messageKey: 'need.drought', messageParams: { village: villageParam },
      exampleKey: 'prompt.rain', messageExampleKey: 'prompt.rain',
      example: `make it rain in the ${village.id}` });
    if (state.villages.some(other => other.population > 0 && village.relations?.[other.id] === 'war')) needs.push({ villageId: village.id, type: 'conflict',
      message: `${village.name}: fighting consumes food and lives. Seek peace or prepare defenders.`,
      messageKey: 'need.conflict', messageParams: { village: villageParam },
      exampleKey: 'prompt.peace', messageExampleKey: 'prompt.peace',
      example: 'Let us live together in peace' });
    if ((village.templeCount ?? 0) > 0 && village.religion === 'none') needs.push({ villageId: village.id, type: 'faith_crisis',
      messageKey: 'need.faith_crisis', messageParams: { village: villageParam },
      exampleKey: 'prompt.faith', messageExampleKey: 'prompt.faith',
      message: `${village.name}: a new temple has prompted debate about faith.`, example: 'Have faith' });
    if (data.production + 1e-9 < data.consumption || data.food < data.reserve) {
      needs.push({ villageId: village.id, type: 'food_shortage',
        message: `${village.name}: ${data.food < data.consumption ? 'famine threatens lives' : data.food < data.reserve ? 'food reserves are low' : 'harvest cannot keep up with consumption'}. Rain or food could help.`,
        messageKey: data.food < data.consumption ? 'need.famine' : data.food < data.reserve ? 'need.low_food' : 'need.low_harvest',
        messageParams: { village: villageParam }, exampleKey: 'prompt.rain', messageExampleKey: 'prompt.rain',
        example: `make it rain in the ${village.id}` });
    }
    if (data.population > data.housing || (isExpandedEconomy(village) && data.population >= Math.ceil(data.housing * 0.8))) {
      const crowded = data.population > data.housing;
      needs.push({ villageId: village.id, type: 'housing_shortage',
        message: crowded ? `${village.name}: ${data.population - data.housing} people need housing. The village is seeking space.`
          : `${village.name}: homes are nearly full. The village is planning space for new residents.`,
        messageKey: crowded ? 'need.housing_shortage' : 'need.housing_planning',
        messageParams: { village: villageParam, people: Math.max(0, data.population - data.housing) },
        example: null });
    }
  }
  return needs;
}

// Plain detached data only; never hand the model Maps, entities, or World methods.
export function createWorldContext(state) {
  return { time: state.time, rules: { ...ECONOMY, ...SOCIETY, consumptionPerPerson: RULES.consumptionPerPerson },
    villages: state.villages.map(v => describeVillage(v, state.weather, state.rules)),
    triggers: getWorldNeeds(state).map(n => ({ actor: n.villageId, reason: n.type })),
    recent_events: structuredClone(state.recent_events.slice(-10)) };
}
