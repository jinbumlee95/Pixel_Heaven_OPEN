import assert from 'node:assert/strict';
import { World } from '../src/game/World.js';
import { createInitialWorld, createWorldState } from './fixtures/legacyWorld.mjs';
import { executeDivineAction as execute } from '../src/actions/divineActions.js';
import { tick } from '../src/game/Simulation.js';

const action = (name, parameters = {}, target = 'north') => ({ status: 'understood', action: name, target, parameters });
const world = createInitialWorld();
const north = world.getVillage('north');
const south = world.getVillage('south');
const southBefore = structuredClone(south);
assert.ok(execute(world, action('create_rain', { strength: 0.5 })).ok);
assert.equal(north.weather, 'rain');
assert.equal(world.state.weather, 'clear');
assert.deepEqual(south, southBefore);
const food = north.food;
tick(world.state);
assert.ok(Math.abs(north.food - (food + 60 * 0.12 * 1.125 - 71 * 0.1)) < 1e-9);
assert.ok(Math.abs(south.food - (southBefore.food + 60 * 0.12 - 112 * 0.1)) < 1e-9);
assert.ok(execute(world, action('bless_village')).ok);
assert.equal(north.happiness, 73);
assert.ok(execute(world, action('curse_village', { strength: 0.5 })).ok);
assert.equal(north.happiness, 68);
north.happiness = 99;
execute(world, action('bless_village'));
assert.equal(north.happiness, 100);
north.happiness = 1;
execute(world, action('curse_village'));
assert.equal(north.happiness, 0);
const beforeFood = north.food;
execute(world, action('increase_food', { amount: 50 }));
assert.equal(north.food, beforeFood + 50);
assert.equal(world.state.resources.food, north.food + south.food);
const forest = execute(world, action('create_forest', { direction: 'northeast' }));
assert.ok(forest.ok);
assert.ok(forest.event.position.x > north.anchor.x && forest.event.position.y < north.anchor.y);
const before = structuredClone(world.state);
for (const invalid of [null, action('not_real'), action('increase_food', {}, 'east'),
  action('increase_food', { amount: -5 }), action('create_forest', { x: 0, y: 0 }),
  action('create_forest', { direction: 'up' })]) {
  assert.equal(execute(world, invalid).ok, false);
  assert.deepEqual(world.state, before);
}
const full = new World(createWorldState());
full.getVillage('north').settlementRadius = 0;
full.placeTerrain('farmland', 'north', full.getVillage('north').anchor);
const fullBefore = structuredClone(full.state);
assert.equal(execute(full, action('create_forest')).code, 'no_space');
assert.deepEqual(full.state, fullBefore);
for (let i = 0; i < 70; i++) execute(world, action('increase_food'));
assert.equal(world.state.recent_events.length, 50);
console.log('divineActions: passed');
