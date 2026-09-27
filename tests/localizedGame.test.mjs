import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { I18n } from '../src/i18n/I18n.js';
import { LocalAI } from '../src/llm/LocalAI.js';

const i18n = new I18n({ locale: 'ko', storage: null });
let resolve;
const game = new Game(null, { i18n, interpret: () => new Promise(done => { resolve = done; }) });
const before = structuredClone(game.world.state);
const pending = game.sendDivineMessage('この村に雨を降らせて', 'home');
await Promise.resolve();
i18n.setLocale('ja');
assert.deepEqual(game.world.state, before, 'a locale change during inference cannot mutate the world');
assert.equal(game.divineHistory[0].outcome, 'pending');
resolve({ status: 'understood', action: 'create_rain', target: 'home', parameters: {} });
const result = await pending;
assert.equal(result.ok, true);
assert.equal(game.world.getVillage('home').weather, 'rain');
assert.match(i18n.formatMessage(game.divineHistory[0].replyMessage), /雨/);
const history = structuredClone(game.divineHistory);
i18n.setLocale('en');
assert.match(i18n.formatMessage(game.divineHistory[0].replyMessage), /Rain falls on Worldtree Settlement/);
assert.deepEqual(game.divineHistory, history);
assert.equal(game.divineHistory[0].message, 'この村に雨を降らせて');

// Model status remains structured without changing the legacy English callback.
let reported;
const ai = new LocalAI({ api: null, onStatus: text => { reported = text; } });
await ai.detect();
assert.match(reported, /unavailable/);
i18n.setLocale('ko');
assert.match(i18n.formatMessage(ai.statusMessage), /키워드/);
ai.report('Downloading on-device AI · 25%', 'ai.downloading', { percent: 25 });
assert.match(i18n.formatMessage(ai.statusMessage), /25%/);
ai.stop();

let notifications = 0;
for (const view of ['chat', 'religionPanel', 'equipmentPanel', 'eventsView', 'priestView']) {
  game[view] = { dispose: i18n.subscribe(() => notifications++) };
}
game.unsubscribeLocale = i18n.subscribe(() => notifications++);
game.stop();
assert.equal(i18n.listeners.size, 0, 'Game.stop disposes every locale subscription');
i18n.setLocale('ja');
assert.equal(notifications, 0);
assert.equal((await game.sendDivineMessage('rain')).messageKey, 'game.stopped');
console.log('localizedGame: passed');
