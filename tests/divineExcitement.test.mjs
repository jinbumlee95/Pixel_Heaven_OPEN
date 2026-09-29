import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { ChatCommands, parseChatCommand, executeChatOrder } from '../src/game/ChatCommands.js';
import { I18n } from '../src/i18n/I18n.js';
import { stepWorld } from '../src/game/WorldStep.js';
import { SMITE_RULES } from '../src/game/Combat.js';
import { LEGENDS } from '../src/game/Legends.js';
import { WONDER_RULES } from '../src/game/Wonders.js';
import { validOracleOrder } from '../src/llm/OracleOrders.js';
import { decodeOracleIntent } from '../src/llm/OracleIntent.js';
import { decodeWorld } from '../src/state/Persistence.js';

const makeGame = () => {
  const game = new Game(null, { seed: 42, ritual: false, i18n: new I18n({ locale: 'en', storage: null }) });
  game.commands = new ChatCommands(game);
  return game;
};
const advance = async (game, seconds) => { for (let i = 0; i < seconds; i++) await stepWorld(game, 1000); };

// Smite grammar in three languages; negation and prose never strike.
for (const text of ['smite', 'Smite the raiders!', 'strike the enemies with lightning', 'call down lightning on the invaders',
  'lightning strike', '벼락을 내려라', '적에게 번개를 내려줘', '천벌', '雷を落とせ', '敵に雷を落として', '天罰'])
  assert.deepEqual(parseChatCommand(text), { type: 'order', name: 'smite' }, text);
for (const text of ["don't smite", 'never call down lightning', '벼락을 내리지 마', 'lightning is pretty'])
  assert.notDeepEqual(parseChatCommand(text), { type: 'order', name: 'smite' }, text);
// AI mode can return the same bounded order.
assert.equal(validOracleOrder({ type: 'order', name: 'smite' }), true);
assert.deepEqual(decodeOracleIntent({ intent: 'divine_smite', value: '', amount: 0, direction: '', target: 'home' }), { type: 'order', name: 'smite' });
assert.equal(decodeOracleIntent({ intent: 'divine_smite', value: 'x', amount: 0, direction: '', target: 'home' }), null);

const game = makeGame();
const state = game.world.state;
// No battle: nothing happens and nothing is charged.
const faithBefore = state.faith.points;
const idle = await game.commands.send('smite the raiders');
assert.equal(idle.ok, false);
assert.equal(idle.messageKey, 'combat.failure.no_raid');
assert.equal(state.faith.points, faithBefore);
// Nothing is earned on a fresh world.
assert.deepEqual(state.legends.earned, {});

// Reach the first forecast raid (seed 42 → forecast-1 at 20:00).
const raid = state.eventQueue.find(plan => plan.kind === 'raid');
assert.ok(raid, 'seed 42 forecasts a raid');
await advance(game, raid.startAt - state.time + 1);
assert.ok(['approaching', 'fighting'].includes(state.combat.stage), state.combat.stage);
state.faith.points = 60;
const enemiesBefore = state.combat.units.filter(u => u.side === 'enemy').map(u => u.hp);
const friendsBefore = state.combat.units.filter(u => u.side !== 'enemy').map(u => u.hp);
const strike = executeChatOrder(game.world, { type: 'order', name: 'smite' });
assert.equal(strike.ok, true, JSON.stringify(strike));
assert.equal(strike.event.action, 'smite');
assert.equal(state.faith.points, 60 - SMITE_RULES.faith);
const enemiesAfter = state.combat.units.filter(u => u.side === 'enemy').map(u => u.hp);
const damage = enemiesBefore.reduce((sum, hp, i) => sum + hp - enemiesAfter[i], 0);
assert.ok(damage >= SMITE_RULES.damage, `bolt damage ${damage}`);
assert.ok(strike.messageParams.hits >= 1);
assert.ok(state.combat.effects.some(effect => effect.type === 'lightning'));
assert.deepEqual(state.combat.units.filter(u => u.side !== 'enemy').map(u => u.hp), friendsBefore, 'the bolt spares our own side');
// Cooldown: a second bolt is refused without charging faith.
const again = executeChatOrder(game.world, { type: 'order', name: 'smite' });
assert.equal(again.messageKey, 'combat.failure.smite_cooldown');
assert.equal(state.faith.points, 60 - SMITE_RULES.faith);
// Not enough faith: refused before any damage.
await advance(game, SMITE_RULES.cooldown);
if (state.combat.units.some(u => u.side === 'enemy' && u.hp > 0) && ['approaching', 'fighting'].includes(state.combat.stage)) {
  state.faith.points = 3;
  const hp = state.combat.units.map(u => u.hp);
  assert.equal(executeChatOrder(game.world, { type: 'order', name: 'smite' }).code, 'insufficient_faith');
  assert.deepEqual(state.combat.units.map(u => u.hp), hp);
}
// The strike earned its legend exactly once.
assert.equal(state.legends.tally.smites, 1);
assert.ok(Object.hasOwn(state.legends.earned, 'wrath_of_heaven'));

// Legends pay once, capped by faith capacity, and list their progress.
assert.equal(Object.hasOwn(state.legends.earned, 'thriving_realm'), false);
state.villages[0].population = 20;
state.faith.points = 0;
game.legends.update();
assert.ok(Object.hasOwn(state.legends.earned, 'thriving_realm'));
assert.equal(state.faith.points, 25);
game.legends.update();
assert.equal(state.faith.points, 25, 'a legend pays once');
const earnedEvent = state.recent_events.findLast(e => e.action === 'legend_earned');
assert.match(game.i18n.formatMessage(earnedEvent), /Legend earned: Thriving Realm · \+25 faith/);
const list = (await game.commands.send('legends')).message;
assert.equal(list.split('\n').length, LEGENDS.length + 1);
assert.match(list, /✦ Thriving Realm — Reach 20 people \(20\/20\)/);

// Wonders use their own RNG stream, so threat forecasts are unaffected.
const randomBefore = state.randomState;
const sequenceBefore = state.wonders.sequence, tallyBefore = state.legends.tally.wonders;
assert.ok(sequenceBefore >= 1, 'wonders already happened during the first 20 minutes');
state.wonders.nextAt = state.time;
const happiness = state.villages[0].happiness;
game.wonders.update();
assert.equal(state.randomState, randomBefore, 'wonders never draw from the forecast RNG');
assert.equal(state.wonders.sequence, sequenceBefore + 1);
assert.ok(state.wonders.nextAt - state.time >= WONDER_RULES.minGap && state.wonders.nextAt - state.time <= WONDER_RULES.maxGap);
const wonder = state.recent_events.findLast(e => e.action === 'wonder');
assert.ok(wonder && game.i18n.formatMessage(wonder).startsWith('✧ Wonder:'), game.i18n.formatMessage(wonder));
assert.equal(state.legends.tally.wonders, tallyBefore + 1);
assert.ok(state.villages[0].happiness >= happiness);

// Save/load keeps legends, wonders and their RNG state; corrupt data is rejected.
const text = game.snapshot();
const restored = decodeWorld(text);
assert.deepEqual(restored.world.state.legends, state.legends);
assert.deepEqual(restored.world.state.wonders, state.wonders);
assert.equal(restored.world.state.wonderRandomState, state.wonderRandomState);
const broken = JSON.parse(text); broken.state.legends.earned.fake = 1;
assert.throws(() => decodeWorld(JSON.stringify(broken)), /invalid_legends/);
game.stop();

// Pilgrims only settle when there is room; a full village gets another wonder.
const crowded = makeGame();
const home = crowded.world.state.villages[0];
home.population = 100; home.happiness = 100;
crowded.world.state.wonders.nextAt = crowded.world.state.time;
crowded.world.state.wonders.last = null;
for (let i = 0; i < 6; i++) { crowded.world.state.wonders.nextAt = crowded.world.state.time; crowded.wonders.update(); }
assert.equal(home.population, 100);
assert.ok(!crowded.world.state.recent_events.some(e => e.wonderId === 'pilgrims' || e.wonderId === 'wandering_bard'));
crowded.stop();

// Every language renders the new messages without raw keys.
for (const locale of ['ko', 'en', 'ja']) {
  const i18n = new I18n({ locale, storage: null });
  for (const key of ['legend.earned', 'wonder.pilgrims', 'combat.smite.done', 'combat.failure.smite_cooldown', 'legend.help'])
    assert.notEqual(i18n.t(key, { legend: 'x', faith: 1, people: 1, hits: 1, fallen: 0, cost: 12, seconds: 3 }), key);
}
console.log('divineExcitement: smite, legends, wonders, persistence and three languages passed');
