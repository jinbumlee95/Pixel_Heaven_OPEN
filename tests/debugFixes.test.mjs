import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { ChatCommands } from '../src/game/ChatCommands.js';
import { I18n } from '../src/i18n/I18n.js';
import { orderExpedition } from '../src/game/Expedition.js';

const game = new Game(null, { seed: 42, ritual: false, i18n: new I18n({ locale: 'en', storage: null }) });
game.commands = new ChatCommands(game);

// Status labels the storyteller pace instead of a bare "Every 10 days".
const status = (await game.commands.send('status')).message;
assert.match(status, /World storyteller: Every 10 days/);

// Depth/supply orders explain the real reason, not the recall message.
const hero = game.world.state.hero;
assert.equal(hero.mode, 'home');
for (const operation of ['deeper', 'supply']) {
  assert.equal(orderExpedition(game.world, { type: 'order', name: 'expedition', operation }).messageKey, 'exp.notAway');
}
const reply = await game.commands.send('go deeper');
assert.equal(reply.ok, false);
assert.match(game.i18n.formatMessage(reply), /not on an expedition/);
hero.mode = 'exploring'; hero.recallRequested = true;
assert.equal(orderExpedition(game.world, { type: 'order', name: 'expedition', operation: 'deeper' }).messageKey, 'exp.returning');
game.stop();
console.log('debugFixes: passed');
