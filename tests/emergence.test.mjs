import assert from 'node:assert/strict';
import { createInitialWorld } from './fixtures/legacyWorld.mjs';
import { Emergence } from '../src/game/Emergence.js';
import { tick, foodBalance } from '../src/game/Simulation.js';
import { executeDivineAction } from '../src/actions/divineActions.js';
import { interpretDivineMessage } from '../src/llm/divineLLM.js';
import { executeWorldAction } from '../src/actions/worldActions.js';
import { WorldDecisions } from '../src/game/WorldDecisions.js';
import { getWorldNeeds, createWorldContext } from '../src/game/WorldNeeds.js';

const raidWorld = createInitialWorld();
const north = raidWorld.getVillage('north');
const events = [];
const raid = new Emergence(raidWorld, { random: () => 0, onEvent: e => events.push(e) });
raidWorld.state.time = 39;
raid.update();
assert.equal(north.crisis, null);
raidWorld.state.time = 40;
raid.update();
assert.equal(north.crisis.kind, 'raid');
assert.equal(north.crisis.resolveAt, 55);
assert.equal(raidWorld.state.villages.length, 2);
assert.equal(raidWorld.state.entities.size, 7);
const snapshot = structuredClone(raidWorld.state);
raid.update();
assert.deepEqual(raidWorld.state, snapshot, 'effects only occur once per tick');
assert.ok(getWorldNeeds(raidWorld.state).some(n => n.type === 'raid' && n.example.includes('battle')));
const context = createWorldContext(raidWorld.state);
context.villages[0].crisis.resolveAt = 999;
assert.equal(north.crisis.resolveAt, 55);
for (const text of ['prepare for battle', '전투 준비']) {
  const command = await interpretDivineMessage(text, { defaultTarget: 'north' });
  assert.equal(command.action, 'prepare_defense');
  assert.ok(executeDivineAction(raidWorld, command).ok);
}
assert.equal(north.defenseUntil, 70);
assert.ok(getWorldNeeds(raidWorld.state).some(n => n.message.includes('Defenders are ready')));
const people = north.population;
const food = north.food;
raidWorld.state.time = 55;
raid.update();
assert.equal(north.population, people);
assert.equal(north.food, food);
assert.equal(north.crisis, null);
assert.ok(events.at(-1).message.includes('defenders held'));

// Allies reduce losses; absent preparation and alliance, the full raid applies.
for (const allied of [false, true]) {
  const w = createInitialWorld();
  const e = new Emergence(w, { random: () => 0 });
  const n = w.getVillage('north');
  if (allied) executeWorldAction(w, { actor: 'north', action: 'form_alliance', target: 'south', reason: 'raid', parameters: {} });
  w.state.time = 40; e.update();
  w.state.time = 55; e.update();
  assert.equal(n.food, 160 - (allied ? 20 : 40));
  assert.equal(n.population, 71 - (allied ? 1 : 2));
  assert.equal(w.state.resources.food, w.state.villages.reduce((sum, v) => sum + v.food, 0));
}

const dryWorld = createInitialWorld();
const dry = new Emergence(dryWorld, { random: () => 0.9 });
const south = dryWorld.getVillage('south');
const production = foodBalance(south).production;
dryWorld.state.time = 40; dry.update();
assert.equal(south.weather, 'drought');
assert.equal(foodBalance(south).production, production * 0.4);
assert.ok(getWorldNeeds(dryWorld.state).some(n => n.type === 'drought'));
executeDivineAction(dryWorld, await interpretDivineMessage('make it rain', { defaultTarget: 'south' }));
dryWorld.state.time = 41; dry.update();
assert.equal(south.crisis, null);
assert.equal(south.weather, 'rain');
dryWorld.state.time = 100; dry.update();
assert.equal(south.weather, 'drought');
dryWorld.state.time = 125; dry.update();
assert.equal(south.weather, 'rain', 'natural expiry restores pre-drought weather');

// War has aggregate costs, defense reduces them, and alliance stops attrition.
const warWorld = createInitialWorld();
const war = new Emergence(warWorld);
const n = warWorld.getVillage('north');
const s = warWorld.getVillage('south');
executeWorldAction(warWorld, { actor: 'south', action: 'start_war', target: 'north', reason: 'food_shortage', parameters: {} });
executeDivineAction(warWorld, await interpretDivineMessage('prepare for battle', { defaultTarget: 'north' }));
warWorld.state.time = 10; war.update();
assert.equal(n.population, 71);
assert.equal(s.population, 111);
assert.equal(n.food, 159);
assert.equal(s.food, 207);
executeWorldAction(warWorld, { actor: 'south', action: 'form_alliance', target: 'north', reason: 'conflict', parameters: {} });
warWorld.state.time = 20; war.update();
assert.equal(s.population, 111);
assert.equal(s.food, 207);
executeWorldAction(warWorld, { actor: 'north', action: 'build_temple', target: 'north', reason: 'interpretation_of_divine_message', parameters: {} });
const happy = n.happiness;
warWorld.state.time = 30; war.update();
assert.equal(n.happiness, happy + 1);

// Seeded long run exercises crises + economic and social decisions together.
const world = createInitialWorld();
let seed = 7;
const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const decisions = new WorldDecisions(world);
let raids = 0; let droughts = 0;
const emerging = new Emergence(world, { random, onEvent: e => {
  decisions.record(e);
  if (e.action === 'raid') raids++;
  if (e.action === 'drought') droughts++;
} });
for (let i = 0; i < 1000; i++) {
  tick(world.state); emerging.update(); await decisions.update();
  for (const v of world.state.villages) {
    assert.ok(Number.isFinite(v.food) && v.food >= 0 && Number.isFinite(v.wood) && v.wood >= 0);
    assert.ok(Number.isInteger(v.population) && v.population >= 0);
    assert.ok(v.happiness >= 0 && v.happiness <= 100);
    assert.equal(v.templeCount, [...world.state.buildings.values()].filter(b => b.type === 'temple' && b.villageId === v.id).length);
    for (const [id, rel] of Object.entries(v.relations)) assert.equal(world.getVillage(id).relations[v.id], rel);
  }
  assert.equal(world.state.resources.food, world.state.villages.reduce((sum, v) => sum + v.food, 0));
  assert.equal(world.state.entities.size, 7);
  assert.equal(world.state.villages.length, 2);
  assert.ok(world.state.recent_events.length <= 50 && decisions.events.length <= 50);
}
assert.ok(raids > 0 && droughts > 0);
console.log('emergence: passed');
