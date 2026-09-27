// Historical queue/refund contracts use the pre-expansion fixture; new play is tested in intentRepair/diplomacy/work.
import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { executeDivineAction } from '../src/actions/divineActions.js';
import { interpretDivineMessage } from '../src/llm/divineLLM.js';
import { interpretOracle } from '../src/game/PriestInterpretation.js';
import { I18n } from '../src/i18n/I18n.js';
import { HERO_RULES } from '../src/game/Hero.js';
import { tick } from '../src/game/Simulation.js';

const action = (name, parameters = {}) => ({ status: 'understood', action: name, target: 'home', parameters });
const game = new Game(null, { random: () => .9 });
assert.equal(game.world.state.faith.points, 30);
assert.equal(executeDivineAction(game.world, action('create_rain')).faithCost, 18);
assert.equal(game.world.state.faith.points, 12);
const beforeRejected = structuredClone(game.world.state);
assert.equal(executeDivineAction(game.world, action('increase_food')).code, 'insufficient_faith');
assert.deepEqual(game.world.state, beforeRejected, 'Insufficient faith cannot modify inventory, weather, hero or event queues');
const dispatched = await game.sendDivineMessage('영웅을 던전으로 파견하라');
assert.equal(dispatched.ok, true);
assert.equal(game.world.state.faith.points, 4);
assert.equal(game.world.state.hero.mode, 'outbound');
const beforeDuplicate = structuredClone(game.world.state);
assert.equal((await game.sendDivineMessage('Send the hero to the dungeon')).code, 'busy');
assert.deepEqual(game.world.state, beforeDuplicate);
assert.equal((await game.sendDivineMessage('Recall the hero from the dungeon')).ok, true);
assert.equal(game.world.state.faith.points, 1);
for (let elapsed = 0; elapsed < HERO_RULES.returnMs; elapsed += 100) game.hero.update(100);
assert.equal(game.world.state.hero.mode, 'home');
assert.equal(game.world.state.hero.totalXp, 0, 'Recall before combat cannot farm XP');
assert.equal(game.world.state.entities.size, 5, 'Returning keeps one named hero');
for (let i = 0; i < 120; i++) tick(game.world.state);
assert.ok(Math.abs(game.world.state.faith.points - 7) < .001, 'Eight residents regenerate six faith per game day');
assert.equal(game.world.getVillage('home').weather, 'clear', 'A paid rain blessing is temporary');
game.stop();

for (const phrase of ['영웅을 안복귀시켜', '영웅을 못귀환시키게 해', '용사를 던전에 안파견해',
  '용사를 던전에 못파견해', '영웅을 던전에 파견하지 마', "don't send the hero to the dungeon",
  'if enemies arrive recall the hero', '勇者をダンジョンに派遣しないで', '勇者を呼び戻さないで',
  'Send the hero to the dungeon or recall the hero', '영웅을 파견하고 복귀시켜']) {
  assert.equal((await interpretDivineMessage(phrase))?.status, 'unclear', phrase);
  assert.equal(interpretOracle(phrase), null, 'A rejected hero order cannot become a symbolic priest action');
}
for (const locale of ['ko', 'en', 'ja']) {
  const i18n = new I18n({ locale, storage: null });
  for (const name of ['dispatch', 'recall']) {
    const phrase = i18n.t(`hero.prompt.${name}`);
    assert.equal((await interpretDivineMessage(phrase)).action, `hero_${name}`, phrase);
  }
}
for (const phrase of ['영웅은 마을로 돌아와', '영웅이 마을로 돌아오도록 해']) {
  assert.equal((await interpretDivineMessage(phrase)).action, 'hero_recall', phrase);
}
assert.equal(await interpretDivineMessage('영웅을 북쪽 마을로 복귀시켜라'), null);

// Symbolic interventions reserve once, then refund if the village cannot act.
const poor = new Game(null, { systems: false });
assert.equal((await poor.sendDivineMessage('Make them remember')).code, 'unclear');
assert.equal(poor.world.state.faith.points, 22);
poor.world.state.time = 10;
await poor.worldDecisions.update();
assert.equal(poor.world.state.faith.points, 30);
assert.equal(poor.world.getVillage('home').templeCount, 0);
poor.stop();

const success = new Game(null, { systems: false });
Object.assign(success.world.getVillage('home'), { wood: 100, stone: 100, silver: 20, gold: 10 });
success.worldDecisions.onEvent = event => { if (event.action === 'build_temple') success.worldDecisions.stop(); };
await success.sendDivineMessage('Make them remember');
success.world.state.time = 10;
await success.worldDecisions.update();
assert.equal(success.world.getVillage('home').templeCount, 1);
assert.equal(success.world.state.faith.points, 22, 'Stopping after success cannot refund an applied intervention');
success.stop();

const canceled = new Game(null, { systems: false });
await canceled.sendDivineMessage('Make them remember');
canceled.stop(); canceled.stop();
assert.equal(canceled.world.state.faith.points, 30, 'Canceling pending interpretations refunds once');

let finishLateDecision;
const lateProvider = new Promise(resolve => { finishLateDecision = resolve; });
const inFlight = new Game(null, { systems: false, decideWorld: () => lateProvider });
Object.assign(inFlight.world.getVillage('home'), { wood: 100, stone: 100, silver: 20, gold: 10 });
await inFlight.sendDivineMessage('Make them remember');
inFlight.world.state.time = 10;
const interrupted = inFlight.worldDecisions.update();
assert.equal(inFlight.world.state.faith.points, 22);
inFlight.stop();
await interrupted;
assert.equal(inFlight.world.state.faith.points, 30, 'Stopping an active provider refunds its reservation once');
finishLateDecision({ action: 'build_temple', actor: 'home', target: 'home', parameters: {},
  reason: 'interpretation_of_divine_message' });
await lateProvider;
await Promise.resolve();
assert.equal(inFlight.world.getVillage('home').templeCount, 0, 'A late canceled reply cannot execute or spend again');
assert.equal(inFlight.world.state.faith.points, 30);
console.log('faithIntervention: passed');
