const domainState=state=>{const copy=structuredClone(state);delete copy.recent_events;delete copy.eventSequence;return copy;};
import assert from 'node:assert/strict';
import { createInitialWorld } from './fixtures/legacyWorld.mjs';
import { WorldDecisions } from '../src/game/WorldDecisions.js';
import { tick } from '../src/game/Simulation.js';
import { executeDivineAction } from '../src/actions/divineActions.js';

const world = createInitialWorld();
const decisions = new WorldDecisions(world);
for (let i = 0; i < 9; i++) { tick(world.state); await decisions.update(); }
assert.equal(world.getVillage('south').farmCount, 5);
assert.equal(decisions.events.filter(e => e.action === 'need').length, 1);
tick(world.state);
await decisions.update();
assert.equal(world.getVillage('south').farmCount, 6);
assert.equal(decisions.events.filter(e => e.action === 'farm').length, 1);
await decisions.update();
assert.equal(world.getVillage('south').farmCount, 6);
for (let i = 0; i < 600; i++) {
  tick(world.state);
  await decisions.update();
  for (const v of world.state.villages) {
    assert.ok(Number.isFinite(v.food) && v.food >= 0 && v.wood >= 0);
    assert.ok(Number.isInteger(v.population) && v.population >= 0);
    assert.equal(v.houseCount, [...world.state.buildings.values()].filter(b => b.villageId === v.id && b.type === 'house').length);
    assert.equal(v.farmCount, [...world.state.terrain.values()].filter(b => b.villageId === v.id && b.type === 'farmland').length);
  }
  assert.equal(world.state.resources.food, world.state.villages.reduce((n, v) => n + v.food, 0));
  assert.equal(world.state.resources.wood, world.state.villages.reduce((n, v) => n + v.wood, 0));
}
assert.equal(world.state.entities.size, 7);
assert.ok(decisions.events.some(e => e.action === 'build_house'));
assert.ok(decisions.events.length <= 50 && world.state.recent_events.length <= 50);
assert.ok(world.state.occupied.size < 1000);

let calls = 0;
let resolve;
const slowWorld = createInitialWorld();
const slow = new WorldDecisions(slowWorld, { decide: () => {
  calls++;
  return new Promise(done => { resolve = done; });
} });
slowWorld.state.time = 10;
const pending = slow.update();
await Promise.resolve();
slowWorld.state.time = 20;
assert.equal(slow.update(), pending);
assert.equal(calls, 1);
// A divine rescue while the model thinks makes its old shortage decision stale.
slowWorld.getVillage('south').farmCount = 8;
executeDivineAction(slowWorld, { status: 'understood', action: 'create_rain', target: 'south', parameters: {} });
const rescued = structuredClone(slowWorld.state);
resolve({ actor: 'south', action: 'farm', target: 'south', reason: 'food_shortage', parameters: {} });
await pending;
assert.equal(slow.lastResult.code, 'stale_decision');
assert.deepEqual(domainState(slowWorld.state), domainState(rescued));
assert.equal(slow.nextCheck, 30, 'cooldown starts after the slow decision settles');
slowWorld.state.time = 29;
assert.equal(slow.update(), null);
assert.equal(calls, 1, 'no immediate catch-up request after a delayed response');

const healthy = createInitialWorld();
for (const v of healthy.state.villages) { v.farmCount = 100; v.houseCount = 100; }
const quiet = new WorldDecisions(healthy, { decide: () => { throw new Error('Should not run without a trigger'); } });
healthy.state.time = 30;
assert.equal(quiet.update(), null);
assert.equal(quiet.lastResult, null);
const broken = new WorldDecisions(createInitialWorld(), { decide: () => { throw new Error('provider details'); } });
broken.world.state.time = 10;
const prior = structuredClone(broken.world.state);
await broken.update();
assert.equal(broken.lastResult.code, 'decision_failed');
assert.deepEqual(domainState(broken.world.state), domainState(prior));
assert.equal(broken.pending, null);
const bad = new WorldDecisions(createInitialWorld(), { decide: () => ({ action: 'erase_map' }) });
bad.world.state.time = 10;
await bad.update();
assert.equal(bad.lastResult.code, 'invalid_action');
let finish;
const stopped = new WorldDecisions(createInitialWorld(), { decide: () => new Promise(r => { finish = r; }) });
stopped.world.state.time = 10;
const ending = stopped.update();
await Promise.resolve();
stopped.stop();
const beforeStop = structuredClone(stopped.world.state);
finish({ actor: 'south', action: 'farm', target: 'south', reason: 'food_shortage', parameters: {} });
await ending;
assert.deepEqual(stopped.world.state, beforeStop);
console.log('worldDecisions: passed');
