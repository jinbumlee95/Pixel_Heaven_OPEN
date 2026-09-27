import assert from 'node:assert/strict';
import { createWorldState } from '../src/state/worldState.js';
import { FAITH_RULES, quoteDivineCost, canSpendFaith, spendFaith, refundFaith,
  accrueFaith, faithGenerationPerDay } from '../src/game/Faith.js';

const state = createWorldState();
assert.equal(state.faith.points, 30);
assert.equal(faithGenerationPerDay(state), 6);
state.villages.push({ id: 'outside', population: 1000000 });
assert.equal(faithGenerationPerDay(state), 6, 'Outside groups do not generate player faith');
assert.equal(accrueFaith(state, 120), 6);
assert.equal(state.faith.points, 36);
state.villages[0].population = 16;
assert.equal(faithGenerationPerDay(state), 12);
assert.equal(quoteDivineCost({ action: 'create_rain', parameters: {} }), 18);
for (const strength of [0.1, 1, 2, 3]) assert.equal(quoteDivineCost({ action: 'create_rain', parameters: { strength } }), 18,
  'Any rain that averts a whole drought pays the same base price');
assert.equal(quoteDivineCost({ action: 'increase_food', parameters: { amount: 1000 } }), 350,
  'A large miracle cannot bypass the influence budget through a flat price');
assert.equal(quoteDivineCost('hero_dispatch'), 8);
assert.equal(quoteDivineCost('hero_recall'), 3);
assert.equal(quoteDivineCost('interpretation'), 8);
assert.equal(quoteDivineCost({ action: 'prepare_defense', parameters: { preparation: 'cover' } }), 6);
assert.equal(canSpendFaith(state, 36), true);
assert.equal(spendFaith(state, 18), true);
assert.equal(spendFaith(state, 18), true);
assert.equal(state.faith.points, 0);
for (const bad of [1, -1, NaN, Infinity, '1']) {
  const before = structuredClone(state);
  assert.equal(spendFaith(state, bad), false);
  assert.deepEqual(state, before, 'Rejected spending is atomic');
}
assert.equal(refundFaith(state, 18), true);
assert.equal(state.faith.points, 18);
assert.equal(state.faith.spent, 18);
accrueFaith(state, 1000000);
assert.equal(state.faith.points, FAITH_RULES.capacity);
assert.equal(accrueFaith(state, 120), 0, 'A full pool cannot bank hidden overflow');
state.villages[0].population = 0;
spendFaith(state, 10);
assert.equal(accrueFaith(state, 120), 0);
assert.equal(state.faith.points, 90, 'An abandoned settlement generates no faith');
const beforeBadElapsed = structuredClone(state);
for (const bad of [-1, Infinity, NaN]) assert.equal(accrueFaith(state, bad), 0);
assert.deepEqual(state, beforeBadElapsed);
const legacy = createWorldState({ villages: [{ id: 'fixture', population: 8 }] });
assert.equal(accrueFaith(legacy), 0);
assert.equal(legacy.faith, undefined, 'Historical fixtures do not acquire a live player influence system');
console.log('faith: passed');
