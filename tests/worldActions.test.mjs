import assert from 'node:assert/strict';
import { createInitialWorld } from './fixtures/legacyWorld.mjs';
import { executeWorldAction as execute, validateWorldSchema } from '../src/actions/worldActions.js';
import { syncResourceTotals } from '../src/state/worldState.js';

const action = (name, parameters = {}, target = 'north') => ({ actor: 'north', action: name, target,
  reason: 'food_shortage', parameters });
const world = createInitialWorld();
const north = world.getVillage('north');
const south = world.getVillage('south');
assert.ok(execute(world, action('farm', { direction: 'northeast' })).ok);
assert.equal(north.farmCount, 6);
assert.equal(north.wood, 30);
const farm = world.state.recent_events.at(-1).position;
assert.ok(farm.x > north.anchor.x && farm.y < north.anchor.y);
assert.ok(execute(world, action('build_house')).ok);
assert.equal(north.houseCount, 5);
assert.equal(north.wood, 10);
const totalFood = north.food + south.food;
const totalWood = north.wood + south.wood;
assert.ok(execute(world, action('trade', { food: 25 }, 'south')).ok);
assert.equal(north.food, 185);
assert.equal(south.food, 185);
assert.equal(north.wood, 5);
assert.equal(south.wood, 65);
assert.equal(world.state.resources.food, totalFood);
assert.equal(world.state.resources.wood, totalWood);
const population = north.population + south.population;
assert.ok(execute(world, action('migrate', { people: 5 }, 'south')).ok);
assert.equal(north.population, 66);
assert.equal(south.population, 117);
assert.equal(north.population + south.population, population);
assert.equal(world.state.entities.size, 7);

for (const bad of [null, { action: 'none', actor: 'north' }, action('destroy_world'),
  action('farm', { x: 0, y: 0 }), action('farm', { direction: 'up' }),
  action('trade', { food: -1 }, 'south'), action('migrate', { people: 1.5 }, 'south'),
  action('migrate', { people: Infinity }, 'south'), { ...action('farm'), reason: '<'.repeat(161) }]) {
  assert.equal(validateWorldSchema(bad), false);
  const before = structuredClone(world.state);
  assert.equal(execute(world, bad).ok, false);
  assert.deepEqual(world.state, before);
}
for (const invalid of [action('farm'), action('trade', { food: 100 }, 'south'),
  action('migrate', { people: 20 }, 'south'), action('migrate', { people: 1 }),
  action('farm', {}, 'south'), { ...action('farm'), actor: 'east' }]) {
  const before = structuredClone(world.state);
  assert.equal(execute(world, invalid).ok, false);
  assert.deepEqual(world.state, before);
}
const beforeNone = structuredClone(world.state);
assert.deepEqual(execute(world, { action: 'none' }), { ok: true, event: null });
assert.deepEqual(world.state, beforeNone);
north.wood = 100;
north.settlementRadius = 0; // The anchor is occupied by its town hall.
syncResourceTotals(world.state);
const full = structuredClone(world.state);
assert.equal(execute(world, action('farm')).code, 'no_space');
assert.equal(execute(world, action('build_house')).code, 'no_space');
assert.deepEqual(world.state, full);
console.log('worldActions: passed');
