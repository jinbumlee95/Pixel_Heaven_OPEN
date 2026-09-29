import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { ChatCommands, parseChatCommand } from '../src/game/ChatCommands.js';
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

// "prepare the Flood" and similar natural phrasings reach the flood preparation.
for (const [text, kind] of [['prepare the Flood', 'flood'], ['prepare for the flood', 'flood'], ['prepare flood', 'flood'],
  ['prepare the fire', 'fire'], ['prepare for wildfire', 'fire'], ['prepare for winter', 'cold'], ['prepare the cold', 'cold']])
  assert.deepEqual(parseChatCommand(text), { type: 'decision', name: 'respond', kind }, text);
const noFlood = makeFloodGame(false);
const none = await noFlood.commands.send('prepare the Flood');
assert.equal(none.messageKey, 'cw.noForecast');
assert.match(noFlood.i18n.formatMessage(none), /no “Flood” is forecast/);
noFlood.stop();
// In AI mode a model that misreads the request cannot block the preparation.
const flood = makeFloodGame(true);
flood.localAI.api = { availability: async () => 'available', create: async () => ({ destroy() {}, clone: async () => ({ destroy() {},
  prompt: async p => p.startsWith('Verify') ? '{"matches":false}' : '{"intent":"none","value":"","amount":0,"direction":"","target":"home"}' }) }) };
await flood.localAI.detect(); await flood.localAI.enable();
const prepared = await flood.commands.send('prepare the Flood');
assert.equal(prepared.ok, true, flood.i18n.formatMessage(prepared));
flood.stop();
function makeFloodGame(withFlood) {
  const g = new Game(null, { seed: 42, ritual: false, i18n: new I18n({ locale: 'en', storage: null }) });
  g.commands = new ChatCommands(g);
  const s = g.world.state;
  Object.assign(s.villages[0], { wood: 50, stone: 50 });
  if (withFlood) Object.assign(s.eventQueue.find(p => p.kind !== 'raid'), { kind: 'flood', harvestFactor: null, exposure: [], damage: { food: 0, people: 0, structures: 10 } });
  else s.eventQueue = s.eventQueue.filter(p => p.kind === 'raid');
  return g;
}
console.log('debugFixes: passed');
