const domainState=state=>{const copy=structuredClone(state);delete copy.recent_events;delete copy.eventSequence;return copy;};
// Historical queue/refund contracts use the pre-expansion fixture; new play is tested in intentRepair/diplomacy/work.
import assert from 'node:assert/strict';
import { interpretOracle } from '../src/game/PriestInterpretation.js';
import { Game } from '../src/game/Game.js';
import { tick } from '../src/game/Simulation.js';

for (const [text, intent] of [['Make them remember', 'remembrance'], ['선조를 기억하라', 'remembrance'],
  ['Have faith', 'faith'], ['함께 평화롭게 살자', 'peace'], ['Seek vengeance', 'conflict']]) {
  assert.equal(interpretOracle(text).intent, intent);
}
for (const text of ['moon', "don't remember", '기억하지 마라', 'remember and seek revenge']) assert.equal(interpretOracle(text), null);

const game = new Game(null, { systems: false });
const priest = game.priestEntity;
const settlement = game.world.getVillage('home');
settlement.wood = 100;
Object.assign(settlement, { stone: 100, silver: 20, gold: 10 });
settlement.religion = 'none';
const before = settlement.wood;
const reply = await game.sendDivineMessage('Make them remember', 'home');
assert.equal(reply.code, 'unclear');
assert.match(reply.message, /temple/);
assert.equal(settlement.templeCount ?? 0, 0, 'interpretation itself does not execute');
assert.equal(game.worldDecisions.interpretations.length, 1);
for (let i = 0; i < 10; i++) { tick(game.world.state); await game.worldDecisions.update(); }
const chain = game.worldDecisions.events.filter(e => e.messageId === 1);
assert.deepEqual(chain.map(e => e.action), ['oracle_message', 'priest_interpretation', 'build_temple']);
assert.ok(chain.every(e => e.actor === 'home'));
assert.equal(settlement.templeCount, 1);
assert.ok(settlement.wood < before + settlement.population * 0.025 * 10);
assert.equal(game.world.state.entities.get(priest.id), priest);
assert.equal(game.world.state.entities.size, 5);
assert.equal(game.worldDecisions.interpretations.length, 0);
const saved = structuredClone(game.world.state);
await game.worldDecisions.update();
assert.deepEqual(game.world.state, saved, 'same oracle is never applied twice');

await game.sendDivineMessage('믿음을 가져라', 'home');
game.world.state.time = 20;
await game.worldDecisions.update();
assert.equal(settlement.religion, 'sky_god');
assert.equal(game.worldDecisions.events.filter(e => e.messageId === 2).at(-1).action, 'change_religion');
const factionsBeforePeace = structuredClone(game.world.state.factions);
await game.sendDivineMessage('Let us live together in peace', 'home');
game.world.state.time = 30;
await game.worldDecisions.update();
const alliance = game.worldDecisions.events.filter(e => e.messageId === 3).at(-1);
assert.equal(alliance.action, 'interpretation_not_applied');
assert.equal(alliance.messageKey, 'event.oracle.no_action');
assert.deepEqual(game.world.state.factions, factionsBeforePeace, 'A symbolic peace request cannot force an external faction into an alliance');
assert.equal(game.world.state.villages.length, 1, 'An interpretation does not create another controllable settlement');

const hostile = new Game(null, { systems: false });
Object.assign(hostile.world.getVillage('home'), { happiness: 20, religion: 'none' });
const factionsBeforeConflict = structuredClone(hostile.world.state.factions);
await hostile.sendDivineMessage('Seek vengeance', 'home');
hostile.world.state.time = 10;
await hostile.worldDecisions.update();
const war = hostile.worldDecisions.events.filter(e => e.messageId === 1).at(-1);
assert.equal(war.action, 'interpretation_not_applied');
assert.equal(war.messageKey, 'event.oracle.no_action');
assert.deepEqual(hostile.world.state.factions, factionsBeforeConflict, 'An outside group retains its own stance');
await hostile.sendDivineMessage('평화롭게 함께 살자', 'home');
hostile.world.state.time = 20;
await hostile.worldDecisions.update();
const peace = hostile.worldDecisions.events.filter(e => e.messageId === 2).at(-1);
assert.equal(peace.action, 'interpretation_not_applied');
assert.deepEqual(hostile.world.state.factions, factionsBeforeConflict);

// Insufficient resources produce a linked no-action outcome, not a retry loop.
const poor = new Game(null, { systems: false });
poor.world.getVillage('home').wood = 0;
await poor.sendDivineMessage('Make them remember');
poor.world.state.time = 10;
await poor.worldDecisions.update();
assert.equal(poor.worldDecisions.events.at(-1).action, 'interpretation_not_applied');
assert.equal(poor.worldDecisions.events.at(-1).messageId, 1);
assert.equal(poor.worldDecisions.interpretations.length, 0);

// The engine binds a response to this interpretation, not any valid action.
let finish;
const slow = new Game(null, { systems: false, decideWorld: () => new Promise(resolve => { finish = resolve; }) });
slow.world.getVillage('home').wood = 100;
Object.assign(slow.world.getVillage('home'), { stone: 100, silver: 20, gold: 10 });
slow.world.state.faith.points = 100;
await slow.sendDivineMessage('Make them remember');
slow.world.state.time = 10;
const pending = slow.worldDecisions.update();
const snapshot = structuredClone(slow.world.state);
finish({ actor: 'home', action: 'farm', target: 'home', reason: 'interpretation_of_divine_message', parameters: {} });
await pending;
assert.equal(slow.worldDecisions.lastResult.code, 'stale_decision');
snapshot.faith.points += 8; snapshot.faith.spent -= 8;
assert.deepEqual(domainState(slow.world.state), domainState(snapshot));
await slow.sendDivineMessage('Make them remember');
slow.world.state.time = 20;
const expired = slow.worldDecisions.update();
slow.world.state.time = 100;
const aged = structuredClone(slow.world.state);
finish({ actor: 'home', action: 'build_temple', target: 'home', reason: 'interpretation_of_divine_message', parameters: {} });
await expired;
assert.equal(slow.worldDecisions.lastResult.code, 'stale_decision');
aged.faith.points += 8; aged.faith.spent -= 8;
assert.deepEqual(domainState(slow.world.state), domainState(aged));
for (let i = 0; i < 9; i++) await slow.sendDivineMessage('Make them remember');
assert.equal(slow.worldDecisions.interpretations.length, 8);
console.log('priestInterpretation: passed');
