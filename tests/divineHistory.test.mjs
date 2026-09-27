import assert from 'node:assert/strict';
import { Game, DIVINE_HISTORY_LIMIT } from '../src/game/Game.js';

const game = new Game(null);
await game.sendDivineMessage('make it rain in our village', 'home');
await game.sendDivineMessage('moon');
await game.sendDivineMessage('rain in the east village');
assert.deepEqual(game.divineHistory.map(e => e.outcome), ['applied', 'unclear', 'rejected']);
assert.equal(game.divineHistory[0].message, 'make it rain in our village');
assert.equal(game.divineHistory[0].selectedTarget, 'home');
assert.equal(game.divineHistory[0].target, 'home');
assert.equal(game.divineHistory[1].priestId, game.priestEntity.id);
assert.ok(game.divineHistory.every(e => e.reply.length > 0 && e.completedTime === 0));
const size = game.divineHistory.length;
for (const invalid of ['', '  ', null, 'x'.repeat(501)]) {
  assert.equal((await game.sendDivineMessage(invalid)).code, 'invalid_message');
}
assert.equal(game.divineHistory.length, size);
for (let i = 0; i < 55; i++) await game.sendDivineMessage(`moon ${i}`);
assert.equal(game.divineHistory.length, DIVINE_HISTORY_LIMIT);
assert.equal(game.divineHistory[0].message, 'moon 5');
assert.equal(game.divineHistory.at(-1).message, 'moon 54');
assert.equal(new Set(game.divineHistory.map(e => e.id)).size, DIVINE_HISTORY_LIMIT);
assert.equal(new Game(null).divineHistory.length, 0);

const failure = new Game(null, { interpret: async () => { throw new Error('secret provider details'); } });
const before = structuredClone(failure.world.state);
const result = await failure.sendDivineMessage('rain');
assert.equal(result.code, 'delivery_failed');
assert.equal(result.message.includes('secret'), false);
assert.equal(failure.divineHistory[0].outcome, 'rejected');
assert.deepEqual(failure.world.state, before);

// FIFO delivery preserves message/reply pairing for concurrent submissions.
const resolvers = [];
const delayed = new Game(null, { interpret: () => new Promise(resolve => resolvers.push(resolve)) });
const first = delayed.sendDivineMessage('first');
const second = delayed.sendDivineMessage('second');
assert.deepEqual(delayed.divineHistory.map(e => e.outcome), ['pending', 'pending']);
assert.equal(resolvers.length, 1);
resolvers[0]({ status: 'understood', action: 'increase_food', target: 'home', parameters: {} });
await first;
assert.deepEqual(delayed.divineHistory.map(e => e.outcome), ['applied', 'pending']);
resolvers[1]({ status: 'unclear', confidence: 0.1 });
await second;
assert.deepEqual(delayed.divineHistory.map(e => [e.message, e.outcome]), [['first', 'applied'], ['second', 'unclear']]);
console.log('divineHistory: passed');
