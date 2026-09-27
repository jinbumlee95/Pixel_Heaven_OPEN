import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';

const previousRAF = globalThis.requestAnimationFrame;
const previousCancelRAF = globalThis.cancelAnimationFrame;
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
const games = [];

function runningGame(options = {}) {
  const game = new Game(null, { ritual: true, random: () => 0.9,
    decideWorld: async () => ({ action: 'none' }), ...options });
  game.renderer.render = () => {};
  game.counters = { update() {} };
  game.eventsView = { updateNeeds() {}, add() {} };
  game.running = true;
  game.previousTime = 0;
  games.push(game);
  return game;
}

async function frame(game, elapsed = 100) {
  game.frame(game.previousTime + elapsed);
  // Flush queue/ritual promise continuations without sleeping the simulation.
  for (let turn = 0; turn < 6; turn++) await Promise.resolve();
}

async function until(game, condition, limit = 200) {
  for (let index = 0; index < limit && !condition(); index++) await frame(game);
  assert.ok(condition(), 'Production pipeline must reach the expected state in bounded frames');
}

try {
  let answer;
  let calls = 0;
  const game = runningGame({ interpret: () => {
    calls++;
    assert.deepEqual(game.priestEntity.position, game.world.state.sanctuary.reception);
    assert.equal(game.ritual.current.stage, 'interpreting');
    return new Promise(resolve => { answer = resolve; });
  } });
  const originalPosition = { ...game.priestEntity.position };
  const pending = game.sendDivineMessage('Send rain here');
  assert.equal(calls, 0, 'Neither the mock nor a real provider is called before physical reception');
  assert.deepEqual(game.priestEntity.position, originalPosition);
  assert.equal(game.ritual.current.stage, 'approaching');
  assert.equal(game.divineHistory[0].outcome, 'pending');
  await frame(game, 0);
  assert.deepEqual(game.priestEntity.position, originalPosition, 'Paused frames do not skip the procession');
  await until(game, () => game.ritual.current.stage === 'receiving');
  assert.equal(calls, 0);
  assert.equal(game.world.getVillage('home').weather ?? game.world.state.weather, 'clear');
  assert.equal(game.world.state.recent_events.some(event => event.source === 'divine'), false);
  for (let i = 0; i < 10; i++) await frame(game);
  assert.equal(calls, 0, 'Arriving at the altar still requires a visible receiving interval');
  await until(game, () => calls === 1);
  const receivingRecords = game.worldDecisions.events.filter(event => event.action === 'oracle_received');
  assert.equal(receivingRecords.length, 1);
  assert.equal(receivingRecords[0].messageId, 1);
  const timeBeforeThinking = game.world.state.time;
  const altarPosition = { ...game.priestEntity.position };
  for (let i = 0; i < 40; i++) await frame(game);
  assert.ok(game.world.state.time >= timeBeforeThinking + 4, 'Simulation continues during slow interpretation');
  assert.deepEqual(game.priestEntity.position, altarPosition, 'Wander cannot pull the Priest away from the altar during inference');
  assert.equal(game.priestEntity.facing, 'north');
  assert.equal(game.divineHistory[0].outcome, 'pending');
  answer({ status: 'understood', action: 'create_rain', target: 'home', parameters: {} });
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(game.world.getVillage('home').weather, 'rain');
  assert.equal(game.world.state.recent_events.filter(event => event.action === 'create_rain').length, 1);
  assert.equal(game.ritual.current.stage, 'idle');
  assert.equal(game.priestEntity.activity, undefined);
  assert.deepEqual(game.priestEntity.position, altarPosition);
  game.stop();

  // The next message must wait for its own receiving interval. The previous
  // message's late finally must not release the next request's activity lock.
  const order = [];
  const fifo = runningGame({ interpret: async message => {
    order.push(message);
    return { status: 'understood', action: 'increase_food', target: 'home', parameters: { amount: 5 } };
  } });
  const first = fifo.sendDivineMessage('first');
  const second = fifo.sendDivineMessage('second');
  await until(fifo, () => fifo.divineHistory[0].outcome === 'applied');
  assert.equal((await first).ok, true);
  assert.deepEqual(order, ['first']);
  assert.equal(fifo.divineHistory[1].outcome, 'pending');
  assert.equal(fifo.ritual.current.messageId, 2);
  assert.equal(fifo.priestEntity.activity, 'oracle');
  await until(fifo, () => fifo.divineHistory[1].outcome === 'applied');
  assert.equal((await second).ok, true);
  assert.deepEqual(order, ['first', 'second']);
  assert.equal(fifo.world.state.recent_events.filter(event => event.action === 'increase_food').length, 2);
  assert.equal(fifo.ritual.current.stage, 'idle');
  fifo.stop();

  let lateAnswer;
  const timed = runningGame({ interpret: () => new Promise(resolve => { lateAnswer = resolve; }) });
  timed.divineQueue.timeoutMs = 50;
  const timeout = timed.sendDivineMessage('rain');
  await until(timed, () => Boolean(lateAnswer));
  assert.equal(timed.priestEntity.activity, 'oracle');
  const timeoutResult = await timeout;
  assert.equal(timeoutResult.ok, false);
  assert.equal(timed.ritual.active, null, 'Queue timeout cancels the ritual as well as the request');
  assert.equal(timed.priestEntity.activity, undefined);
  const afterTimeout = structuredClone(timed.world.state);
  lateAnswer({ status: 'understood', action: 'increase_food', target: 'home', parameters: { amount: 999 } });
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  assert.deepEqual(timed.world.state, afterTimeout, 'A provider that ignores cancellation cannot apply a late miracle');
  assert.equal(timed.divineHistory[0].outcome, 'rejected');
  timed.stop();

  let stoppedCalls = 0;
  const stopped = runningGame({ interpret: async () => { stoppedCalls++; return null; } });
  const stopResult = stopped.sendDivineMessage('rain');
  await frame(stopped, 200);
  stopped.stop();
  const stoppedState = structuredClone(stopped.world.state);
  assert.equal((await stopResult).ok, false);
  assert.equal(stoppedCalls, 0);
  await frame(stopped);
  assert.deepEqual(stopped.world.state, stoppedState);
  assert.equal(stopped.priestEntity.activity, undefined);

  const missing = runningGame({ interpret: async () => { throw new Error('must not reach provider'); } });
  missing.world.state.sanctuary = null;
  assert.equal((await missing.sendDivineMessage('rain')).code, 'ritual_missing_sanctuary');
  assert.equal(missing.divineHistory[0].outcome, 'rejected');
  assert.equal(missing.priestEntity.activity, undefined);
  missing.stop();
} finally {
  for (const game of games) game.stop();
  if (previousRAF) globalThis.requestAnimationFrame = previousRAF; else delete globalThis.requestAnimationFrame;
  if (previousCancelRAF) globalThis.cancelAnimationFrame = previousCancelRAF; else delete globalThis.cancelAnimationFrame;
}

console.log('oraclePipeline: passed');
