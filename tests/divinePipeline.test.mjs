import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { tick } from '../src/game/Simulation.js';

const game = new Game(null);
const before = structuredClone(game.world.state);
assert.ok((await game.sendDivineMessage('우리 마을에 식량을 내려라')).ok);
assert.equal(game.world.getVillage('home').food, before.villages[0].food + 50);
assert.equal(game.world.state.villages.length, 1);
const afterFood = structuredClone(game.world.state);
assert.equal((await game.sendDivineMessage('rain in the east village')).code, 'invalid_target');
assert.deepEqual(game.world.state, afterFood, 'A foreign destination cannot be redirected home');
assert.equal((await game.sendDivineMessage('Make them remember', 'faction-01')).code, 'invalid_target');
assert.equal(game.worldDecisions.interpretations.length, 0, 'Foreign selection cannot enter the symbolic fallback');
assert.deepEqual(game.world.state, afterFood);
const saved = structuredClone(game.world.state);
assert.equal((await game.sendDivineMessage('moon')).code, 'unclear');
saved.entities.get(game.priestEntity.id).lastInterpretation = game.priestEntity.lastInterpretation;
assert.deepEqual(game.world.state, saved);

// A future provider can be swapped in without changing the caller. Check the
// engine distrusts malformed output and simulation can advance while awaiting it.
let finish;
const delayed = new Game(null, { interpret: (_message, context) => {
  assert.equal(context.defaultTarget, 'home');
  assert.ok(Object.isFrozen(context));
  return new Promise(resolve => { finish = resolve; });
} });
const pending = delayed.sendDivineMessage('test', 'home');
tick(delayed.world.state);
const during = structuredClone(delayed.world.state);
finish({ status: 'understood', action: 'erase_map', target: 'home', parameters: {} });
assert.equal((await pending).code, 'invalid_action');
assert.deepEqual(delayed.world.state, during);
assert.equal(delayed.world.state.time, 1);

const forged = new Game(null, { interpret: async () => ({ status: 'understood',
  action: 'increase_food', target: 'faction-01', parameters: { amount: 50 } }) });
const beforeForged = structuredClone(forged.world.state);
assert.equal((await forged.sendDivineMessage('Give food to our village')).code, 'invalid_target');
assert.deepEqual(forged.world.state, beforeForged, 'Even a valid model schema cannot command an external faction');
console.log('divinePipeline: passed');
