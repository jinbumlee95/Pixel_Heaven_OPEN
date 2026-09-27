// Historical queue/refund contracts use the pre-expansion fixture; new play is tested in intentRepair/diplomacy/work.
import assert from 'node:assert/strict';
import { I18n } from '../src/i18n/I18n.js';
import { createInitialWorld } from '../src/game/World.js';
import { Game } from '../src/game/Game.js';
import { getWorldNeeds } from '../src/game/WorldNeeds.js';
import { interpretDivineMessage } from '../src/llm/divineLLM.js';
import { interpretOracle } from '../src/game/PriestInterpretation.js';

// Response examples are executable game input, not just translated display copy.
const world = createInitialWorld();
const village = world.getVillage('home');
Object.assign(village, { food: 0, houseCount: 0, templeCount: 1, religion: 'none',
  crisis: { kind: 'raid', resolveAt: 55 }, weather: 'clear' });
const needs = getWorldNeeds(world.state);
village.defenseUntil = 60;
needs.push(getWorldNeeds(world.state).find(need => need.type === 'raid'));
village.crisis = { kind: 'drought', resolveAt: 65 };
village.weather = 'drought';
needs.push(...getWorldNeeds(world.state));
assert.deepEqual([...new Set(needs.filter(need => need.exampleKey).map(need => need.exampleKey))].sort(),
  ['prompt.defense', 'prompt.faith', 'prompt.rain']);

for (const locale of ['ko', 'en', 'ja']) {
  const i18n = new I18n({ locale, storage: null });
  for (const need of needs.filter(item => item.exampleKey)) {
    const phrase = i18n.t(need.exampleKey, need.messageParams);
    const parsed = await interpretDivineMessage(phrase, { defaultTarget: 'home' });
    if (['prompt.defense', 'prompt.rain'].includes(need.exampleKey)) {
      assert.equal(parsed.action, need.exampleKey === 'prompt.defense' ? 'prepare_defense' : 'create_rain', phrase);
      assert.equal(parsed.target, 'home', `${locale}: response reaches only the player's settlement`);
    } else {
      assert.equal(parsed.status, 'unclear', phrase);
      assert.equal(interpretOracle(phrase)?.intent, need.exampleKey === 'prompt.faith' ? 'faith' : 'peace', phrase);
    }
  }

  // Exercise the actual help text through the same pipeline as a submitted
  // oracle. Remembrance builds a temple; faith subsequently changes religion.
  const examples = [...i18n.t('chat.examples').matchAll(/[“「]([^”」]+)[”」]/gu)].map(match => match[1]);
  assert.equal(examples.length, 4, `${locale}: four advertised examples`);
  const game = new Game(null, { systems: false, i18n });
  const home = game.world.getVillage('home');
  Object.assign(home, { wood: 100, stone: 100, iron: 30, cloth: 30, silver: 20, gold: 10, religion: 'none' });
  game.world.state.faith.points = 100; // This fixture verifies six localized commands, not starting affordability.
  const rain = await game.sendDivineMessage(examples[0], 'home');
  assert.equal(rain.event?.action, 'create_rain', examples[0]);
  assert.equal(rain.event?.target, 'home', examples[0]);
  const defense = await game.sendDivineMessage(examples[1], 'home');
  assert.equal(defense.event?.action, 'prepare_defense', examples[1]);
  assert.equal(defense.event?.target, 'home', examples[1]);
  const forest = await game.sendDivineMessage(examples[2], 'home');
  assert.equal(forest.event?.action, 'create_forest', examples[2]);
  assert.equal(forest.event?.target, 'home');
  assert.ok(forest.event.position.x > home.anchor.x && forest.event.position.y < home.anchor.y,
    'The documented direction controls placement rather than naming another settlement');

  const remember = await game.sendDivineMessage(examples[3], 'home');
  assert.equal(remember.code, 'unclear');
  assert.equal(home.templeCount, 0, 'Priest interpretation does not directly mutate the world');
  game.world.state.time = 10;
  await game.worldDecisions.update();
  assert.equal(home.templeCount, 1, examples[3]);
  assert.deepEqual(game.worldDecisions.events.filter(event => event.messageId === 4).map(event => event.action),
    ['oracle_message', 'priest_interpretation', 'build_temple']);

  const factionsBeforePeace = structuredClone(game.world.state.factions);
  const peace = await game.sendDivineMessage(i18n.t('prompt.peace'), 'home');
  assert.equal(peace.code, 'unclear');
  game.world.state.time = 20;
  await game.worldDecisions.update();
  assert.equal(game.worldDecisions.events.filter(event => event.messageId === 5).at(-1).action, 'interpretation_not_applied');
  assert.deepEqual(game.world.state.factions, factionsBeforePeace, 'Peace cannot forcibly control outside factions');

  const faith = await game.sendDivineMessage(i18n.t('prompt.faith'), 'home');
  assert.equal(faith.code, 'unclear');
  assert.equal(home.religion, 'none');
  game.world.state.time = 30;
  await game.worldDecisions.update();
  assert.equal(home.religion, 'sky_god', `${locale}: faith prompt reaches the world decision`);
  assert.deepEqual(game.worldDecisions.events.filter(event => event.messageId === 6).map(event => event.action),
    ['oracle_message', 'priest_interpretation', 'change_religion']);
}

console.log('localizedPrompts: passed');
