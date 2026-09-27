const domainState=state=>{const copy=structuredClone(state);delete copy.recent_events;delete copy.eventSequence;return copy;};
import assert from 'node:assert/strict';
import { createInitialWorld } from './fixtures/legacyWorld.mjs';
import { executeDivineAction, validateDivineAction } from '../src/actions/divineActions.js';
import { executeWorldAction, validateWorldAction } from '../src/actions/worldActions.js';
import { getWorldNeeds } from '../src/game/WorldNeeds.js';
import { WorldDecisions } from '../src/game/WorldDecisions.js';
import { Emergence } from '../src/game/Emergence.js';
import { eventCatalogs } from '../src/i18n/events.js';
import { I18n } from '../src/i18n/I18n.js';

const locales = ['en', 'ko', 'ja'];
const translators = Object.fromEntries(locales.map(locale => [locale, new I18n({ locale, storage: null })]));
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
for (const locale of locales) {
  assert.deepEqual(Object.keys(eventCatalogs[locale]).sort(), Object.keys(eventCatalogs.en).sort());
  for (const [key, template] of Object.entries(eventCatalogs[locale])) {
    assert.ok(template.trim(), `${locale}:${key} must not be blank`);
    assert.deepEqual(placeholders(template), placeholders(eventCatalogs.en[key]), `${locale}:${key} parameters`);
  }
}

function translated(record) {
  assert.ok(record.messageKey, `Descriptor missing for ${record.action ?? record.type ?? record.code}`);
  for (const locale of locales) {
    assert.ok(eventCatalogs[locale][record.messageKey], `${locale}:${record.messageKey} is missing`);
    const text = translators[locale].formatMessage(record);
    assert.ok(text.length > 0);
    assert.doesNotMatch(text, /\{\w+\}/, `${locale}:${record.messageKey} has unresolved parameters`);
  }
  return record;
}

const world = createInitialWorld();
const divine = (action, parameters = {}) => executeDivineAction(world, {
  status: 'understood', action, target: 'north', parameters });
const rain = translated(divine('create_rain').event);
assert.deepEqual(locales.map(locale => translators[locale].formatMessage(rain)), [
  'Rain falls on North village.', '북쪽 마을에 비가 내립니다.', '北の村に雨が降ります。']);
for (const [action, parameters] of [['prepare_defense', {}], ['create_forest', {}],
  ['bless_village', { strength: 1 }], ['curse_village', { strength: 1 }], ['increase_food', { amount: 1000 }]]) {
  translated(divine(action, parameters).event);
}
assert.match(translators.en.formatMessage(world.state.recent_events.at(-1)), /1,000/);
translated(validateDivineAction(world, { action: 'unsupported' }));
translated(validateWorldAction(world, { action: 'unsupported' }));

const worldAction = (action, actor = 'north', target = actor, parameters = {}, reason = 'food_shortage') =>
  ({ actor, action, target, reason, parameters });
for (const action of ['build_house', 'farm', 'build_temple', 'change_religion', 'trade', 'migrate', 'start_war', 'form_alliance']) {
  const targetWorld = createInitialWorld();
  const north = targetWorld.getVillage('north');
  const south = targetWorld.getVillage('south');
  north.wood = south.wood = 100;
  north.food = south.food = 10000;
  north.houseCount = south.houseCount = 100;
  north.templeCount = 1;
  const command = action === 'change_religion' ? worldAction(action, 'north', 'north', { religion: 'earth_god' })
    : action === 'trade' ? worldAction(action, 'north', 'south', { food: 25 })
      : action === 'migrate' ? worldAction(action, 'north', 'south', { people: 5 })
        : ['start_war', 'form_alliance'].includes(action) ? worldAction(action, 'south', 'north')
          : worldAction(action);
  if (action === 'build_temple') north.templeCount = 0;
  const result = executeWorldAction(targetWorld, command);
  assert.ok(result.ok, `${action}: ${result.code}`);
  translated(result.event);
  assert.equal(result.event.reason, 'food_shortage', 'Canonical reason is never translated');
  const before = structuredClone(targetWorld.state);
  for (const locale of locales) translators[locale].formatMessage(result.event);
  assert.deepEqual(targetWorld.state, before, 'Formatting must not mutate the simulation');
}

const needy = createInitialWorld();
const n = needy.getVillage('north');
const s = needy.getVillage('south');
n.crisis = { kind: 'raid', resolveAt: 55 };
n.food = 0;
n.houseCount = 0;
n.relations.south = 'war';
s.relations.north = 'war';
s.crisis = { kind: 'drought', resolveAt: 65 };
s.weather = 'drought';
s.templeCount = 1;
for (const need of getWorldNeeds(needy.state)) {
  translated(need);
  if (need.exampleKey) for (const locale of locales) {
    assert.doesNotMatch(translators[locale].t(need.exampleKey, need.messageParams), /\{\w+\}/);
  }
}
n.defenseUntil = 60;
assert.equal(translated(getWorldNeeds(needy.state).find(need => need.type === 'raid')).messageKey, 'need.raid_ready');
const resolved = new WorldDecisions(needy);
resolved.updateNeeds();
for (const v of needy.state.villages) {
  v.crisis = null; v.weather = 'rain'; v.relations = {}; v.religion = 'sky_god';
  v.food = 10000; v.farmCount = 100; v.houseCount = 100;
}
resolved.updateNeeds();
assert.equal(resolved.events.filter(event => event.action === 'resolved').length, 8);
resolved.events.forEach(translated);

for (const random of [() => 0, () => 0.9]) {
  const crisisWorld = createInitialWorld();
  const events = [];
  const emergence = new Emergence(crisisWorld, { random, onEvent: event => events.push(event) });
  crisisWorld.state.time = 40; emergence.update();
  crisisWorld.state.time = 65; emergence.update();
  assert.equal(events.length, 2);
  events.forEach(translated);
}

// Re-rendering the history changes its presentation, never the original oracle,
// event links, action IDs, or the state used to validate a pending decision.
const original = '先祖を記憶して <b>기억</b> {village}';
const oracleWorld = createInitialWorld();
const decisions = new WorldDecisions(oracleWorld);
assert.ok(decisions.enqueueInterpretation({ actor: 'south', messageId: 7,
  original, intent: 'remembrance', interpretation: 'Legacy priest text' }));
oracleWorld.state.time = 10;
await decisions.update();
const chain = decisions.events.filter(event => event.messageId === 7);
assert.deepEqual(chain.map(event => event.action), ['oracle_message', 'priest_interpretation', 'build_temple']);
assert.equal(chain[0].messageParams.original, original);
for (const locale of locales) {
  assert.ok(translators[locale].formatMessage(chain[0]).endsWith(original), 'Original player text is preserved byte for byte');
  chain.slice(1).forEach(translated);
}
assert.equal(chain[2].reason, 'interpretation_of_divine_message');
const snapshot = structuredClone({ chain, state: oracleWorld.state });
for (const locale of locales) {
  translators.en.setLocale(locale);
  chain.forEach(event => translators.en.formatMessage(event));
}
assert.deepEqual({ chain, state: oracleWorld.state }, snapshot);

let finish;
const slowWorld = createInitialWorld();
const slow = new WorldDecisions(slowWorld, { decide: () => new Promise(resolve => { finish = resolve; }) });
slow.enqueueInterpretation({ actor: 'north', messageId: 8, original: 'remember',
  intent: 'remembrance', interpretation: 'Legacy text' });
slowWorld.state.time = 10;
const pending = slow.update();
await Promise.resolve();
slowWorld.state.time = 100;
const beforeExpired = structuredClone(slowWorld.state);
finish(worldAction('build_temple', 'north', 'north', {}, 'interpretation_of_divine_message'));
await pending;
assert.equal(slow.lastResult.code, 'stale_decision');
assert.equal(slow.events.find(event => event.action === 'interpretation_not_applied').messageKey, 'event.oracle.expired');
translated(slow.lastResult);
slow.events.filter(event => event.action === 'interpretation_not_applied').forEach(translated);
assert.deepEqual(domainState(slowWorld.state), domainState(beforeExpired), 'Expired interpretation cannot mutate world state');

const legacy = { message: 'A saved event from before localization.' };
assert.equal(translators.ja.formatMessage(legacy), legacy.message, 'Old event records keep their readable fallback');
console.log('eventMessages: passed');
