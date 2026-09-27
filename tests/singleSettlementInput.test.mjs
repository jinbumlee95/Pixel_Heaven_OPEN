import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorldState } from '../src/state/worldState.js';
import { World } from '../src/game/World.js';
import { inspectDivineDestination, interpretDivineMessage } from '../src/llm/divineLLM.js';
import { executeDivineAction } from '../src/actions/divineActions.js';

const initial = createWorldState();
assert.equal(initial.playerSettlementId, 'home');
assert.equal(initial.villages.length, 1);
assert.deepEqual(initial.villages.map(({ id, name, population, food, wood }) => ({ id, name, population, food, wood })),
  [{ id: 'home', name: 'Worldtree Settlement', population: 8, food: 30, wood: 15 }]);
const fixtures = [{ id: 'fixture', name: 'Explicit fixture' }];
const custom = createWorldState({ villages: fixtures });
assert.equal(custom.playerSettlementId, undefined);
fixtures[0].name = 'Changed outside';
assert.equal(custom.villages[0].name, 'Explicit fixture', 'test fixtures cannot alias a live world');

for (const message of ['Send rain here', 'Make it rain in my settlement', 'Send rain to our settlement',
  'Rain in Worldtree Settlement', 'Rain in the world tree settlement',
  '우리 정착지에 비를 내려라', '세계수 정착지에 비를 내려줘', '여기에 비를 내려줘',
  '私たちの集落に雨を降らせよ', '世界樹の集落に雨を降らせて', 'ここに雨を降らせて']) {
  const action = await interpretDivineMessage(message);
  assert.equal(action?.status, 'understood', message);
  assert.equal(action?.target, 'home', message);
  assert.equal(action?.action, 'create_rain', message);
}
for (const message of ['Grow a forest northeast of our settlement', '우리 정착지 북동쪽에 숲을 만들어라', '私たちの集落の北東に森を作れ']) {
  const action = await interpretDivineMessage(message);
  assert.equal(action?.target, 'home', message);
  assert.equal(action?.parameters.direction, 'northeast', message);
}
for (const message of ['Prepare our settlement’s defenses', '우리 정착지의 방어를 준비해', '私たちの集落の防衛を準備して']) {
  const action = await interpretDivineMessage(message);
  assert.equal(action?.target, 'home', message);
  assert.equal(action?.action, 'prepare_defense', message);
}
for (const message of ['Send rain to north village', 'Bless Albion settlement', 'Rain in the village of Albion',
  'Rain in north and south villages', 'Make Oak tribe remember me', 'Bless an enemy faction',
  '북쪽 마을에 비를 내려줘', '남쪽 정착지를 축복해', '푸른 부족을 기억하게 하라',
  '北の村に雨を降らせて', '南の集落を祝福して', '隣の部族に記憶を残せ']) {
  assert.equal(inspectDivineDestination(message).unsupported, true, message);
  assert.equal(await interpretDivineMessage(message), null, message);
}
for (const message of ['Bless Ashen Banner', '잿빛 깃발에 비를 내려줘', '灰の旗に雨を降らせて']) {
  assert.equal(inspectDivineDestination(message, { foreignNames: ['Ashen Banner', '잿빛 깃발', '灰の旗'] }).unsupported, true, message);
}

const world = new World();
world.state.faith.points = 100; // This test isolates destination/forecast binding across multiple orders.
world.state.time = 10;
world.state.eventQueue = [
  { id: 'past', kind: 'raid', stage: 'resolved', startAt: 5 },
  { id: 'late-raid', kind: 'raid', stage: 'forecast', startAt: 120 },
  { id: 'early-raid', kind: 'raid', stage: 'forecast', startAt: 80 },
  { id: 'later-drought', kind: 'drought', stage: 'forecast', startAt: 150 },
  { id: 'early-drought', kind: 'drought', stage: 'forecast', startAt: 90 },
];
const command = (action, target = 'home') => ({ status: 'understood', action, target, parameters: {} });
const explicitlyPrepared = executeDivineAction(world, command('prepare_defense'), { planId: 'late-raid' });
assert.equal(explicitlyPrepared.ok, true);
assert.equal(world.state.eventQueue.find(event => event.id === 'late-raid').mitigation.defense, true);
assert.equal(world.state.eventQueue.find(event => event.id === 'early-raid').mitigation, undefined,
  'a selected forecast is honored instead of quietly preparing another event');
const prepared = executeDivineAction(world, command('prepare_defense'));
assert.equal(prepared.ok, true);
assert.equal(world.getVillage('home').preparedRaidId, 'early-raid');
assert.equal(prepared.messageKey, 'event.divine.prepare_defense_forecast');
assert.equal(prepared.messageParams.tick, 80, 'response names the announced raid, not a shorter temporary buff');
assert.ok(world.getVillage('home').defenseUntil < 80, 'forecast defense is explicitly bound beyond ordinary defense duration');
assert.equal(world.state.eventQueue.find(event => event.id === 'early-raid').mitigation.defense, true);
assert.equal(world.state.eventQueue.find(event => event.id === 'late-raid').mitigation.defense, true, 'multiple preparations remain bound independently');
for (const planId of ['missing', 'past', 'early-raid', 123]) {
  const snapshot = structuredClone(world.state);
  assert.equal(executeDivineAction(world, command('create_rain'), { planId }).code, 'invalid_context');
  assert.deepEqual(world.state, snapshot, 'stale or mismatched forecast requests cannot partially apply');
}
assert.equal(executeDivineAction(world, command('create_rain')).ok, true);
assert.equal(world.state.eventQueue.find(event => event.id === 'early-drought').mitigation.rain, true);
assert.equal(world.state.eventQueue.find(event => event.id === 'later-drought').mitigation, undefined, 'one rain command does not neutralize every future drought');
assert.equal(executeDivineAction(world, command('create_rain'), { planId: 'later-drought' }).ok, true);
assert.equal(world.state.eventQueue.find(event => event.id === 'later-drought').mitigation.rain, true);
world.state.villages.push({ ...structuredClone(world.getVillage('home')), id: 'foreign' });
const before = structuredClone(world.state);
assert.equal(executeDivineAction(world, command('create_rain', 'foreign')).code, 'invalid_target');
assert.deepEqual(world.state, before, 'even a legacy village object is not player-controllable when home is declared');

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.doesNotMatch(html, /id="divine-target"/);
assert.match(html, /id="oracle-process"/);
assert.doesNotMatch(html, /<button|<select/);
assert.match(html, /id="event-forecast"/);
console.log('single settlement input: passed');
