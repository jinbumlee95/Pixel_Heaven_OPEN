import assert from 'node:assert/strict';
import { DIVINE_ACTIONS, validateDivineSchema as valid, validateDivineInterpretation } from '../src/llm/schemas.js';

const base = { status: 'understood', action: 'create_rain', target: 'north', parameters: {} };
for (const action of DIVINE_ACTIONS) assert.ok(valid({ ...base, action }));
for (const value of [null, [], {}, { ...base, action: 'destroy_world' }, { ...base, status: 'unclear' },
  { ...base, target: '' }, { ...base, target: 1 }, { ...base, x: 100 }, { ...base, parameters: [] },
  { ...base, parameters: null }, Object.create(base)]) assert.equal(valid(value), false);
for (const strength of [-1, 0, 2, NaN, Infinity, '1', undefined]) {
  assert.equal(valid({ ...base, parameters: { strength } }), false);
}
assert.ok(valid({ ...base, parameters: { strength: 0.5 } }));
for (const amount of [0, -1, 1001, 1.5, Infinity, '50']) {
  assert.equal(valid({ ...base, action: 'increase_food', parameters: { amount } }), false);
}
assert.ok(valid({ ...base, action: 'increase_food', parameters: { amount: 1000 } }));
for (const parameters of [{ direction: 'up' }, { x: 1, y: 2 }, { direction: 'north', extra: true }, { amount: 10 }]) {
  assert.equal(valid({ ...base, action: 'create_forest', parameters }), false);
}
assert.equal(valid({ ...base, parameters: { direction: 'north' } }), false);
assert.ok(validateDivineInterpretation(base));
for (const confidence of [0, 0.2, 1]) {
  const unclear = { status: 'unclear', confidence };
  assert.ok(validateDivineInterpretation(unclear));
  assert.equal(valid(unclear), false);
}
for (const confidence of [-0.1, 1.1, NaN, Infinity, '0.2', null, undefined]) {
  assert.equal(validateDivineInterpretation({ status: 'unclear', confidence }), false);
}
assert.equal(validateDivineInterpretation({ status: 'unclear', confidence: 0.2, action: 'create_rain' }), false);
assert.equal(validateDivineInterpretation(Object.create({ status: 'unclear', confidence: 0.2 })), false);
console.log('schemas: passed');
