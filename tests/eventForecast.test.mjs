import assert from 'node:assert/strict';
import { EventForecast, getForecasts, FORECAST_RULES } from '../src/game/EventForecast.js';
import { createFactions } from '../src/game/Factions.js';
import { executeDivineAction } from '../src/actions/divineActions.js';
import { forecastCatalogs } from '../src/i18n/forecast.js';
import { createInitialWorld } from '../src/game/World.js';
import { tick as economyTick } from '../src/game/Simulation.js';
import { Emergence } from '../src/game/Emergence.js';

function fixture() {
  const home = { id: 'home', name: 'Our settlement', population: 8, food: 100, wood: 20,
    happiness: 60, weather: 'clear', crisis: null, defenseUntil: 0 };
  const state = { time: 0, weather: 'clear', villages: [home], resources: { food: 100, wood: 20, stone: 0 },
    recent_events: [], factions: createFactions({ seed: 7 }).map(faction => ({ ...faction, stance: 'hostile' })) };
  return { state, getVillage(id) { return state.villages.find(village => village.id === id); } };
}
const advance = (world, forecast, tick) => { world.state.time = tick; forecast.update(); };
const committed = plan => ({ id: plan.id, kind: plan.kind, announcedAt: plan.announcedAt,
  startAt: plan.startAt, endAt: plan.endAt, sourceFactionId: plan.sourceFactionId,
  sourceNameKey: plan.sourceNameKey, severity: plan.severity, harvestFactor: plan.harvestFactor, damage: { ...plan.damage },
  entryDirection: plan.entryDirection, enemyComposition: [...plan.enemyComposition] });

const world = fixture();
let randomCalls = 0;
let roll = 0;
const warnings = [];
const forecast = new EventForecast(world, { random: () => { randomCalls++; return roll; }, onEvent: event => warnings.push(event) });
const plans = getForecasts(world.state);
assert.equal(plans.length, 2);
assert.equal(warnings.length, 2, 'Warnings are visible as soon as the future plans are committed');
for (const plan of plans.filter(p=>p.kind==='raid')) {
  assert.ok(plan.startAt - plan.announcedAt >= FORECAST_RULES.leadTicks);
  assert.ok(plan.sourceFactionId);
  assert.ok(plan.damage.food <= 20 && plan.damage.people <= 1);
  assert.ok(['north', 'east', 'south', 'west'].includes(plan.entryDirection));
  assert.equal(plan.enemyComposition.length, 3 + plan.severity);
}
assert.ok(plans[1].startAt - plans[0].startAt >= 90);
assert.ok(plans[1].startAt - plans[0].endAt >= 60, 'A recovery gap remains between threats');
const first = committed(plans[0]);
const countAfterScheduling = randomCalls;
roll = 0.99;
advance(world, forecast, first.startAt - 1);
assert.equal(randomCalls, countAfterScheduling);
assert.equal(world.state.villages[0].food, 100);
advance(world, forecast, first.startAt);
assert.equal(randomCalls, countAfterScheduling, 'No new random roll decides an announced event at its start');
assert.deepEqual(committed(world.state.eventQueue[0]), first);
assert.equal(world.state.eventQueue[0].stage, 'active');
advance(world, forecast, first.endAt);
assert.equal(world.state.villages[0].food, 100 - first.damage.food);
assert.equal(world.state.villages[0].population, 7);
assert.equal(world.state.eventQueue[0].stage, 'resolved');
assert.equal(world.state.villages[0].crisis, null);
assert.deepEqual(committed(world.state.eventQueue[0]), first, 'Later randomness never changes an existing plan');
const resolvedState = structuredClone(world.state);
forecast.update();
assert.deepEqual(world.state, resolvedState, 'Resolution damage is charged only once');
assert.equal(getForecasts(world.state).length, 2);
const detached = getForecasts(world.state);
detached[0].damage.food = 999;
assert.notEqual(getForecasts(world.state)[0].damage.food, 999);

// An order delivered far ahead of arrival remains bound to that specific raid,
// even after the old short defense timer has expired.
const defendedWorld = fixture();
const defended = new EventForecast(defendedWorld, { random: () => 0 });
const raid = getForecasts(defendedWorld.state)[0];
assert.ok(executeDivineAction(defendedWorld, { status: 'understood', action: 'prepare_defense', target: 'home', parameters: {} }).ok);
assert.equal(defendedWorld.state.villages[0].preparedRaidId, raid.id);
assert.ok(defendedWorld.state.villages[0].defenseUntil < raid.startAt);
advance(defendedWorld, defended, raid.startAt);
advance(defendedWorld, defended, raid.endAt);
assert.equal(defendedWorld.state.villages[0].food, 100);
assert.equal(defendedWorld.state.villages[0].population, 8);
assert.equal(defendedWorld.state.villages[0].preparedRaidId, null);
assert.equal(defendedWorld.state.eventQueue[0].outcome.defended, true);

assert.equal(plans.filter(p=>p.kind==='raid').length,1,'One unresolved raid, including warnings');

const dryWorld = fixture();
const dry = new EventForecast(dryWorld, { random: () => 0.9 });
const drought = getForecasts(dryWorld.state)[0];
executeDivineAction(dryWorld, { status: 'understood', action: 'create_rain', target: 'home', parameters: {} });
assert.equal(dryWorld.state.eventQueue[0].mitigation.rain, true);
advance(dryWorld, dry, drought.startAt);
assert.equal(dryWorld.state.eventQueue[0].stage, 'averted');
assert.equal(dryWorld.state.villages[0].weather, 'rain');
assert.equal(dryWorld.state.villages[0].crisis, null);

const untreatedWorld = fixture();
const untreated = new EventForecast(untreatedWorld, { random: () => 0.9 });
const untreatedPlan = getForecasts(untreatedWorld.state)[0];
advance(untreatedWorld, untreated, untreatedPlan.startAt);
assert.equal(untreatedWorld.state.villages[0].weather, 'drought');
assert.equal(untreatedWorld.state.villages[0].droughtFactor, untreatedPlan.harvestFactor);
advance(untreatedWorld, untreated, untreatedPlan.endAt);
assert.equal(untreatedWorld.state.villages[0].weather, 'clear');
assert.equal(untreatedWorld.state.villages[0].droughtFactor, undefined);

const peacefulWorld = fixture();
const peaceful = new EventForecast(peacefulWorld, { random: () => 0 });
const avoidedRaid = getForecasts(peacefulWorld.state)[0];
peacefulWorld.state.factions.find(faction => faction.id === avoidedRaid.sourceFactionId).stance = 'allied';
advance(peacefulWorld, peaceful, avoidedRaid.startAt);
assert.equal(peacefulWorld.state.eventQueue[0].stage, 'averted');
assert.equal(peacefulWorld.state.villages[0].population, 8);

for (let tick = 1; tick <= 10000; tick++) {
  advance(untreatedWorld, untreated, tick);
  assert.ok(untreatedWorld.state.eventQueue.length <= 4);
  assert.ok(untreatedWorld.state.recent_events.length <= 50);
  assert.equal(getForecasts(untreatedWorld.state).length, 2);
  const pending = getForecasts(untreatedWorld.state);
  assert.ok(pending[1].startAt - pending[0].endAt >= 60);
}
for (const locale of ['en', 'ko', 'ja']) {
  assert.deepEqual(Object.keys(forecastCatalogs[locale]).sort(), Object.keys(forecastCatalogs.en).sort());
  for (const event of untreatedWorld.state.recent_events) assert.ok(forecastCatalogs[locale][event.messageKey]);
}

// The economy expires scripted weather before the forecaster resolves events.
// Ending a drought must never resurrect a blessing whose deadline passed.
for (const remainingRain of [5, 60]) {
  const lifecycleWorld = createInitialWorld();
  const lifecycle = new EventForecast(lifecycleWorld, { random: () => 0.9 });
  const plan = lifecycleWorld.state.eventQueue[0];
  const home = lifecycleWorld.getVillage('home');
  lifecycleWorld.state.time = plan.startAt;
  Object.assign(home, { weather: 'rain', rainStrength: 1, rainUntil: plan.startAt + remainingRain });
  lifecycle.update();
  assert.equal(home.weather, 'drought');
  assert.equal(plan.previousWeather, 'rain');
  while (lifecycleWorld.state.time < plan.endAt) { economyTick(lifecycleWorld.state); lifecycle.update(); }
  assert.equal(home.weather, remainingRain > FORECAST_RULES.droughtDuration ? 'rain' : 'clear');
  assert.equal(home.droughtFactor, undefined);
  while (lifecycleWorld.state.time < plan.startAt + 60) { economyTick(lifecycleWorld.state); lifecycle.update(); }
  assert.equal(home.weather, 'clear');
  assert.equal(home.rainUntil, undefined);
  assert.equal(home.rainStrength, undefined);
}

// Early preparation belongs to its forecast, even though the harvest boost is
// temporary. Expiring the boost must not silently revoke purchased protection.
const preparedRainWorld = createInitialWorld();
const preparedRain = new EventForecast(preparedRainWorld, { random: () => 0.9 });
const protectedPlan = preparedRainWorld.state.eventQueue[0];
assert.ok(executeDivineAction(preparedRainWorld, { status: 'understood', action: 'create_rain',
  target: 'home', parameters: { strength: 0.1 } }, { planId: protectedPlan.id }).ok);
assert.equal(preparedRainWorld.state.faith.spent, 18);
while (preparedRainWorld.state.time < protectedPlan.startAt) { economyTick(preparedRainWorld.state); preparedRain.update(); }
assert.equal(preparedRainWorld.getVillage('home').weather, 'clear');
assert.equal(protectedPlan.stage, 'averted');
assert.equal(protectedPlan.outcome.rain, true);

// The historical emergence route has the same restoration guard. Both active
// and expired rain deadlines are checked without enabling another random event.
for (const deadline of [5, 30]) {
  const legacyWorld = createInitialWorld();
  const legacy = new Emergence(legacyWorld, { random: () => { throw new Error('No new crisis expected'); } });
  const home = legacyWorld.getVillage('home');
  Object.assign(home, { weather: 'drought', rainStrength: 1, rainUntil: deadline,
    crisis: { kind: 'drought', resolveAt: 10, previousWeather: 'rain' } });
  for (let i = 0; i < 10; i++) { economyTick(legacyWorld.state); legacy.update(); }
  assert.equal(home.weather, deadline > 10 ? 'rain' : 'clear');
  assert.equal(home.crisis, null);
}
console.log('eventForecast: passed');
