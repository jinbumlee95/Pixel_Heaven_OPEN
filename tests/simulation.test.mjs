import assert from 'node:assert/strict';
import { createWorldState } from '../src/state/worldState.js';
import { tick } from '../src/game/Simulation.js';

const state = createWorldState();
state.villages = [{ population: 100, food: 100, wood: 10 }];
// Trap accidental dependencies on visual or spatial state.
for (const key of ['entities', 'occupied', 'buildings']) {
  Object.defineProperty(state, key, { get() { throw new Error(`Simulation accessed ${key}`); } });
}
tick(state);
assert.equal(state.time, 1);
assert.equal(state.villages[0].food, 102);
assert.equal(state.villages[0].wood, 12.5);
assert.equal(state.villages[0].population, 100);
for (let i = 1; i < 10; i++) tick(state);
assert.equal(state.villages[0].population, 102);
assert.equal(state.resources.food, 120);
assert.equal(state.resources.wood, 35);

state.weather = 'drought';
Object.assign(state.villages[0], { population: 100, food: 0 });
tick(state);
assert.equal(state.villages[0].food, 0);
assert.equal(state.villages[0].population, 98);
Object.assign(state.villages[0], { population: 0, food: 0 });
for (let i = 0; i < 100; i++) tick(state);
assert.equal(state.villages[0].population, 0);
assert.equal(state.villages[0].food, 0);

const rainy = createWorldState();
rainy.weather = 'rain';
rainy.villages = [{ population: 100, food: 100, wood: 0 }];
tick(rainy);
assert.equal(rainy.villages[0].food, 105);
for (let i = 0; i < 3600; i++) tick(rainy);
assert.ok(rainy.villages.every(v => Number.isFinite(v.food) && v.food >= 0
  && Number.isInteger(v.population) && v.population >= 0));
console.log('simulation: passed');
