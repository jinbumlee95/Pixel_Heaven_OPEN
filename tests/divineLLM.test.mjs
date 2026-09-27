import assert from 'node:assert/strict';
import { interpretDivineMessage as interpret, inspectDivineDestination } from '../src/llm/divineLLM.js';
import { validateDivineSchema, validateDivineInterpretation } from '../src/llm/schemas.js';

const cases = [
  ['make it rain here', 'create_rain'],
  ['우리 정착지에 비를 내려라', 'create_rain'],
  ['세계수 정착지에 비를 내려라', 'create_rain'],
  ['Bless the village', 'bless_village'],
  ['Bless my settlement', 'bless_village'],
  ['우리 정착지를 축복해', 'bless_village'],
  ['Curse our settlement', 'curse_village'],
  ['우리 마을을 저주해', 'curse_village'],
  ['Give food to Worldtree Settlement', 'increase_food'],
  ['내 정착지에 식량을 내려라', 'increase_food'],
  ['create a forest', 'create_forest'],
];
for (const [message, action] of cases) {
  const parsed = await interpret(message, Object.freeze({ defaultTarget: 'home' }));
  assert.equal(parsed.action, action, message);
  assert.equal(parsed.target, 'home', message);
  assert.ok(validateDivineSchema(parsed), message);
  assert.equal(Object.hasOwn(parsed.parameters, 'x'), false);
}
const directions = [
  ['north', '북쪽'], ['south', '남쪽'], ['east', '동쪽'], ['west', '서쪽'],
  ['northeast', '북동쪽'], ['northwest', '북서쪽'], ['southeast', '남동쪽'], ['southwest', '남서쪽'],
];
for (const [direction, korean] of directions) {
  for (const message of [`plant a forest ${direction} of our settlement`, `우리 정착지 ${korean}에 숲을 만들어라`]) {
    const parsed = await interpret(message, { defaultTarget: 'home' });
    assert.equal(parsed.target, 'home', message);
    assert.equal(parsed.parameters.direction, direction, message);
  }
}
assert.equal((await interpret('plant a forest north-east of my settlement')).parameters.direction, 'northeast');
assert.deepEqual((await interpret('create a forest in Worldtree Settlement')).parameters, {});
assert.equal((await interpret('create a forest northwest', { defaultTarget: 'home' })).target, 'home');
for (const message of ['rain in the east village', 'rain in north village', 'bless south settlement',
  'rain in the north village and south village', '북쪽 마을에 식량을 내려라', '남쪽 정착지를 축복해',
  'make Oak tribe remember me', 'rain in the village of Albion',
  'Oak마을에 비를 내려줘', 'rain in 새벽 village', 'rain in the village named 새벽']) {
  assert.equal(inspectDivineDestination(message).unsupported, true, message);
  assert.equal(await interpret(message), null, 'named external destinations cannot fall back to home');
}
for (const message of ['Rain for Ashen Banner', '잿빛 깃발을 축복해', '灰の旗に食料を与えて']) {
  const context = Object.freeze({ defaultTarget: 'home', foreignNames: Object.freeze(['Ashen Banner', '잿빛 깃발', '灰の旗']) });
  assert.equal(inspectDivineDestination(message, context).unsupported, true, message);
  assert.equal(await interpret(message, context), null, message);
}
for (const message of ['moon', 'make the moon jealous of the sun', '달이 태양을 질투하게 해라',
  'rain and food', 'forest northeast and southwest', 'bless both',
  "don't create rain", '숲을 만들지 마라', '모든 사람을 축복해']) {
  const result = await interpret(message);
  assert.deepEqual(result, { status: 'unclear', confidence: 0.2 }, message);
  assert.ok(validateDivineInterpretation(result));
  assert.equal(validateDivineSchema(result), false);
}
for (const message of ['', 'x'.repeat(501), null]) {
  assert.equal(await interpret(message), null, String(message));
}
console.log('divineLLM: passed');
