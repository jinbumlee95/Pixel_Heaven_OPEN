import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { interpretDivineMessage } from '../src/llm/divineLLM.js';
import { PREPARATION_SUPPLIES } from '../src/game/Combat.js';
import { quoteDivineCost } from '../src/game/Faith.js';
import { TICK_INTERVAL_MS } from '../src/game/Simulation.js';
import { syncResourceTotals } from '../src/state/worldState.js';

const previousRAF = globalThis.requestAnimationFrame;
const previousCancelRAF = globalThis.cancelAnimationFrame;
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
const games = [];
const FRAME_MS = 100;

function runningGame(options = {}) {
  let draw = 0;
  const forecastDraws = [0, 0, 0.99, 0];
  const game = new Game(null, { ritual: true, seed: 7,
    random: () => forecastDraws[draw++ % forecastDraws.length],
    decideWorld: async () => ({ action: 'none' }), ...options });
  // Only the browser display/scheduler is absent. The Game frame, ritual,
  // demo interpreter, engine validation, forecasts and combat stay real.
  game.renderer.render = () => {};
  game.counters = { update() {} };
  game.eventsView = { updateNeeds() {}, add() {} };
  game.running = true;
  game.previousTime = 0;
  // This fixture isolates preparation/reception from a several-day economy.
  // Real validation and production still run against explicit stored reserves.
  Object.assign(game.world.getVillage('home'), { food: 500, wood: 80, stone: 80,
    iron: 20, copper: 20, coal: 20, herbs: 20, cloth: 20, silver: 10, gold: 5 });
  game.world.state.faith.points = game.world.state.faith.capacity;
  syncResourceTotals(game.world.state);
  games.push(game);
  return game;
}

async function frame(game, elapsed = FRAME_MS) {
  game.frame(game.previousTime + elapsed);
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
}

async function until(game, condition, limit = 1500) {
  for (let index = 0; index < limit && !condition(); index++) await frame(game);
  assert.ok(condition(), 'Real Game frames must reach the expected state within the bound');
}
const framesThrough = (game, time) => Math.max(1,
  Math.ceil((time - game.world.state.time + 2) * TICK_INTERVAL_MS / FRAME_MS));

try {
  const game = runningGame();
  const control = runningGame();
  const home = game.world.getVillage('home');
  const plan = game.world.state.eventQueue[0];
  assert.equal(plan.kind, 'raid');
  const originalActors = [...game.world.state.entities.keys()];
  const initialWood = home.wood;
  const pending = game.sendDivineMessage('우리 정착지의 전투조를 소집해줘', 'home', { planId: plan.id });
  assert.equal(game.ritual.current.stage, 'approaching');
  assert.equal(plan.battlePreparation, undefined);
  assert.equal(game.world.state.combat.units.length, 0);
  assert.equal(game.world.state.combat.works.length, 0);
  assert.equal(home.wood, initialWood, 'Submitting an oracle cannot immediately charge preparation');

  // A same-clock control world accounts for ordinary resource production.
  // No early defense, facility or wood debit may appear during reception.
  let sawReceiving = false;
  for (let index = 0; index < 200 && game.divineHistory[0].outcome === 'pending'; index++) {
    if (game.ritual.current.stage === 'receiving') sawReceiving = true;
    if (['approaching', 'receiving'].includes(game.ritual.current.stage)) {
      assert.equal(plan.battlePreparation, undefined);
      assert.equal(game.world.state.combat.units.length, 0);
      assert.equal(game.world.state.combat.works.length, 0);
      assert.equal(home.wood, control.world.getVillage('home').wood);
      assert.equal(game.world.state.faith.spent, 0, 'The pending altar ritual cannot charge faith');
    }
    await frame(game);
    await frame(control);
  }
  assert.ok(sawReceiving, 'Combat preparation still waits through the visible receiving stage');
  assert.equal(game.divineHistory[0].outcome, 'applied');
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.event.action, 'prepare_defense');
  assert.ok(Math.abs(home.wood - (control.world.getVillage('home').wood - 4)) < 1e-9,
    'The received balanced preparation charges exactly four wood beyond normal production');
  for (const [resource, amount] of Object.entries(PREPARATION_SUPPLIES.balanced)) {
    assert.ok(Math.abs(home[resource] - (control.world.getVillage('home')[resource] - amount)) < 1e-9,
      `The preparation charges its ${resource} cost once after reception`);
  }
  assert.equal(game.world.state.faith.spent,
    quoteDivineCost({ action: 'prepare_defense', parameters: { preparation: 'balanced' } }));
  assert.deepEqual(plan.battlePreparation.kinds, ['balanced']);
  assert.equal(plan.battlePreparation.woodSpent, 4);
  assert.deepEqual(plan.battlePreparation.resourcesSpent, PREPARATION_SUPPLIES.balanced);
  assert.equal(game.world.state.combat.stage, 'preparing');
  assert.deepEqual(game.world.state.combat.units.map(unit => unit.role), ['swordsman', 'archer', 'mage', 'rogue']);
  assert.deepEqual(game.world.state.combat.works.map(work => work.type), ['cover', 'barricade', 'trap']);
  assert.deepEqual([...game.world.state.entities.values()].filter(entity => ['priest','villager','hero'].includes(entity.type)).map(entity => entity.id), originalActors,
    'Mustering does not replace or multiply the Priest and representative villagers');

  // Ordinary building and nature placement must respect combat occupancy.
  // The control proves these cells otherwise fit the same initial settlement.
  const houseFootprint = game.world.content.get('house').footprint;
  const controlHome = control.world.getVillage('home');
  for (const work of game.world.state.combat.works) {
    assert.equal(control.world.isAreaEmpty(controlHome, work.position, houseFootprint), true);
    const before = structuredClone(game.world.state);
    assert.equal(game.world.placeBuilding('house', 'home', work.position), null, work.type);
    assert.equal(game.world.placeTerrain('forest', 'home', work.position), null, work.type);
    assert.deepEqual(game.world.state, before, 'Rejected construction cannot damage or overwrite battle works');
  }
  const barricade = game.world.state.combat.works.find(work => work.type === 'barricade');
  const overlapsAtRightEdge = { x: barricade.position.x - houseFootprint.w + 1, y: barricade.position.y };
  assert.equal(control.world.isAreaEmpty(controlHome, overlapsAtRightEdge, houseFootprint), true);
  assert.equal(game.world.placeBuilding('house', 'home', overlapsAtRightEdge), null,
    'Every footprint cell is checked even when the building anchor misses the barricade');
  const ordinarySite = game.world.findEmptyArea(home, houseFootprint);
  assert.ok(game.world.placeBuilding('house', 'home', ordinarySite),
    'Combat reservations still permit ordinary construction on other clear ground');
  control.stop();

  await until(game, () => plan.stage === 'active', framesThrough(game, plan.startAt));
  assert.equal(game.world.state.combat.planId, plan.id);
  assert.ok(game.world.state.combat.units.some(unit => unit.side === 'enemy'),
    'The Game-owned forecast creates real enemy combatants at its announced arrival');
  assert.equal(game.renderer.cameraTour.current?.id, plan.id,
    'Game connects the actual raid arrival to the renderer camera tour');
  assert.equal(game.world.state.recent_events.filter(event => event.action === 'combat_started' && event.planId === plan.id).length, 1);
  assert.deepEqual([...game.world.state.entities.values()].filter(entity => ['priest','villager','hero'].includes(entity.type)).map(entity => entity.id), originalActors);
  const activeBarricade = game.world.state.combat.works.find(work => work.type === 'barricade');
  const beforeBlockedMove = structuredClone(game.world.state);
  assert.equal(game.world.moveEntity(game.priestEntity, activeBarricade.position), false,
    'The Priest cannot walk into an active battle barricade');
  assert.equal(game.world.placeBuilding('house', 'home', activeBarricade.position), null);
  assert.deepEqual(game.world.state, beforeBlockedMove);
  game.stop();

  // Reception and model delays can outlive the forecast the player selected.
  // Keep a real interpreter behind a provider-delay gate while Game frames
  // advance through the actual raid. A late response must revalidate planId.
  let releaseModel;
  const modelGate = new Promise(resolve => { releaseModel = resolve; });
  const delayed = runningGame({ interpret: async (...args) => {
    await modelGate;
    return interpretDivineMessage(...args);
  } });
  const expiredPlan = delayed.world.state.eventQueue[0];
  const delayedReply = delayed.sendDivineMessage('Prepare barricades for our settlement', 'home', { planId: expiredPlan.id });
  await until(delayed, () => delayed.ritual.current.stage === 'interpreting');
  assert.equal(expiredPlan.battlePreparation, undefined);
  await until(delayed, () => expiredPlan.stage === 'resolved', framesThrough(delayed, expiredPlan.endAt));
  assert.equal(delayed.divineHistory[0].outcome, 'pending');
  const endedBattle = structuredClone(delayed.world.state.combat);
  const endedPlan = structuredClone(expiredPlan);
  const woodAfterBattle = delayed.world.getVillage('home').wood;
  const faithAfterBattle = structuredClone(delayed.world.state.faith);
  releaseModel();
  const lateResult = await delayedReply;
  assert.equal(lateResult.ok, false);
  assert.equal(lateResult.code, 'invalid_context');
  assert.equal(delayed.world.getVillage('home').wood, woodAfterBattle,
    'Expired preparation must not charge the settlement after inference finishes');
  assert.deepEqual(delayed.world.state.faith, faithAfterBattle,
    'An expired preparation cannot charge faith after inference finishes');
  assert.deepEqual(delayed.world.state.combat, endedBattle,
    'Late preparation cannot create facilities or replenish a completed battle');
  assert.deepEqual(expiredPlan, endedPlan);
  assert.equal(delayed.world.state.recent_events.some(event => event.action === 'prepare_defense'), false);
  assert.equal(delayed.divineHistory[0].outcome, 'rejected');
  assert.equal(delayed.priestEntity.activity, undefined);
  delayed.stop();
} finally {
  for (const game of games) game.stop();
  if (previousRAF) globalThis.requestAnimationFrame = previousRAF; else delete globalThis.requestAnimationFrame;
  if (previousCancelRAF) globalThis.cancelAnimationFrame = previousCancelRAF; else delete globalThis.cancelAnimationFrame;
}

console.log('combatIntegration: passed');
