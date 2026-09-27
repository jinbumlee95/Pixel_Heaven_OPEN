import assert from 'node:assert/strict';
import { createInitialWorld } from '../src/game/World.js';
import { tick } from '../src/game/Simulation.js';
import { WorldDecisions } from '../src/game/WorldDecisions.js';
import { createWorldContext, getWorldNeeds } from '../src/game/WorldNeeds.js';
import { decideWorldAction } from '../src/llm/worldLLM.js';
import { executeWorldAction } from '../src/actions/worldActions.js';
import { RESOURCE_TYPES, RESOURCE_RULES, BUILDING_COSTS, ECONOMY,
  housingCapacity, spendResources, canAffordResources } from '../src/state/economy.js';

const world = createInitialWorld();
const home = world.getVillage('home');
assert.equal(RESOURCE_TYPES.length, 17);
for (const resource of RESOURCE_TYPES) assert.equal(world.state.resources[resource], RESOURCE_RULES.starting[resource]);
assert.equal(housingCapacity(home), 12);
const originalPawns = world.state.entities.size;
// No visual or spatial state is consulted by aggregate production.
const isolated = structuredClone(world.state);
for (const key of ['entities', 'occupied', 'terrain', 'buildings']) Object.defineProperty(isolated, key, {
  get() { throw new Error(`Aggregate economy accessed ${key}`); },
});
for (let n = 0; n < 10; n++) tick(isolated);
assert.equal(isolated.villages[0].population, 8, 'There is no birth every ten seconds');
while (isolated.time < ECONOMY.settlementGrowthInterval) tick(isolated);
assert.equal(isolated.villages[0].population, 9);
assert.ok(isolated.villages[0].stone > home.stone);
assert.ok(isolated.villages[0].iron > home.iron, 'Mining and smelting turn coal into stored iron');
assert.ok(isolated.villages[0].cloth > home.cloth, 'Provisioned weaving supplies cloth');
assert.ok(isolated.faith.points > 41 && isolated.faith.points < 43);
while (isolated.time < 4000) tick(isolated);
assert.equal(isolated.villages[0].population, 12, 'Growth stops at housing capacity');

const poor = { ...home, wood: 100, cloth: 0 };
const beforePoor = structuredClone(poor);
assert.equal(canAffordResources(poor, BUILDING_COSTS.build_house), false);
assert.equal(spendResources(poor, BUILDING_COSTS.build_house), false);
assert.deepEqual(poor, beforePoor);
for (const cost of [{ wood: -1 }, { gold: Infinity }, { unknown: 1 }]) {
  assert.equal(spendResources(poor, cost), false);
  assert.deepEqual(poor, beforePoor);
}
const build = action => ({ actor: 'home', target: 'home', action, reason: 'housing_shortage', parameters: {} });
home.wood = 100;
const beforeBuild = Object.fromEntries(RESOURCE_TYPES.map(resource => [resource, home[resource]]));
assert.equal(executeWorldAction(world, build('build_house')).ok, true);
for (const resource of RESOURCE_TYPES) assert.equal(home[resource], beforeBuild[resource] - (BUILDING_COSTS.build_house[resource] ?? 0));
home.population = 20;
home.cloth = 0;
assert.ok(getWorldNeeds(world.state).some(need => need.type === 'housing_shortage'));
const context = createWorldContext(world.state);
const proposal = await decideWorldAction({ ...context, triggers: [{ actor: 'home', reason: 'housing_shortage' }] });
assert.equal(proposal.action, 'none', 'The village cannot propose a house when a non-wood ingredient is missing');
context.villages[0].constructionCosts.build_house.stone = 0;
assert.equal(BUILDING_COSTS.build_house.stone, 8, 'LLM context never exposes mutable cost registries');

const full = createInitialWorld();
const blocked = full.getVillage('home');
for (const resource of RESOURCE_TYPES) blocked[resource] = 100;
blocked.settlementRadius = 0;
const snapshot = structuredClone(full.state);
assert.equal(executeWorldAction(full, build('build_house')).code, 'no_space');
assert.deepEqual(full.state, snapshot, 'Failed placement spends no part of the basket');

const starving = createInitialWorld();
Object.assign(starving.getVillage('home'), { food: 0, farmCount: 0 });
for (let i = 0; i < 29; i++) tick(starving.state);
assert.equal(starving.getVillage('home').population, 8, 'Food failure leaves time to respond');
tick(starving.state);
assert.equal(starving.getVillage('home').population, 7);

const rainy = createInitialWorld();
const watered = rainy.getVillage('home');
Object.assign(watered, { weather: 'rain', rainStrength: 2, rainUntil: 120 });
for (let i = 0; i < 119; i++) tick(rainy.state);
assert.equal(watered.weather, 'rain');
tick(rainy.state);
assert.equal(watered.weather, 'clear', 'Scripted rain ends at its one-day deadline');
assert.equal(watered.rainStrength, undefined);
assert.equal(watered.rainUntil, undefined);
Object.assign(watered, { weather: 'drought', droughtFactor: 0.4, rainStrength: 2, rainUntil: 121 });
tick(rainy.state);
assert.equal(watered.weather, 'drought', 'Expired rain cannot erase an active drought');
assert.equal(watered.droughtFactor, 0.4);
assert.equal(watered.rainStrength, undefined);
assert.equal(watered.rainUntil, undefined);

const longRun = createInitialWorld();
const decisions = new WorldDecisions(longRun);
for (let i = 0; i < 10000; i++) {
  tick(longRun.state);
  await decisions.update();
  const village = longRun.getVillage('home');
  for (const resource of RESOURCE_TYPES) {
    assert.ok(Number.isFinite(village[resource]) && village[resource] >= 0, resource);
    assert.equal(longRun.state.resources[resource], village[resource]);
  }
  assert.ok(Number.isFinite(longRun.state.faith.points) && longRun.state.faith.points >= 0 && longRun.state.faith.points <= 100);
  assert.ok(village.population <= 8 + Math.floor(longRun.state.time / ECONOMY.settlementGrowthInterval));
}
assert.ok(longRun.getVillage('home').population > 8, 'A provisioned settlement can still grow');
assert.equal(longRun.state.entities.size, originalPawns, 'Population growth never adds decorative pawns');
decisions.stop();
console.log(`expandedEconomy: passed (10,000 ticks; ${longRun.getVillage('home').population} residents)`);
