import assert from 'node:assert/strict';
import { interpretDivineMessage as interpret, inspectDivineDestination } from '../src/llm/divineLLM.js';
import { interpretOracle } from '../src/game/PriestInterpretation.js';
import { validateDivineSchema, validateDivineInterpretation } from '../src/llm/schemas.js';
import { Game } from '../src/game/Game.js';
import { catalogues } from '../src/i18n/I18n.js';

// Deliberately bounded mock phrases; this is not general Japanese comprehension.
const commands = [
  ['私たちの集落に雨を降らせて', 'create_rain'],
  ['雨を世界樹の集落に降らせて', 'create_rain'],
  ['この集落に森を作って', 'create_forest'],
  ['私の集落を祝福して', 'bless_village'],
  ['私達の村に加護を与えて', 'bless_village'],
  ['世界樹の集落を呪って', 'curse_village'],
  ['私たちの集落に食料を与えて', 'increase_food'],
  ['この村に食糧を増やして', 'increase_food'],
  ['私たちの集落は戦闘準備', 'prepare_defense'],
  ['防御を準備して', 'prepare_defense'],
  ['戦いに備えて', 'prepare_defense'],
  ['雨を降らせて', 'create_rain'],
  ['村に雨を降らせて', 'create_rain'],
  ['この村に森を作って', 'create_forest'],
  ['我々の集落に食べ物を与えて', 'increase_food'],
];
for (const [message, action] of commands) {
  const parsed = await interpret(message, Object.freeze({ defaultTarget: 'home' }));
  assert.equal(parsed.action, action, message);
  assert.equal(parsed.target, 'home', message);
  assert.ok(validateDivineSchema(parsed), message);
  assert.equal(Object.hasOwn(parsed.parameters, 'x'), false);
}

for (const [japanese, direction] of [['北', 'north'], ['南', 'south'], ['東', 'east'], ['西', 'west'],
  ['北東', 'northeast'], ['北西', 'northwest'], ['南東', 'southeast'], ['南西', 'southwest']]) {
  for (const message of [`私たちの集落の${japanese}に森を作って`, `世界樹の集落の${japanese}側に木を植えて`]) {
    const parsed = await interpret(message, { defaultTarget: 'home' });
    assert.equal(parsed.target, 'home', message);
    assert.equal(parsed.parameters.direction, direction, message);
  }
  const directionOnly = await interpret(`${japanese}に森を作って`, { defaultTarget: 'home' });
  assert.equal(directionOnly.target, 'home', 'placement direction never changes the player settlement');
  assert.equal(directionOnly.parameters.direction, direction);
}
assert.deepEqual((await interpret('世界樹の集落に森を作って')).parameters, {});
assert.equal((await interpret('西洋の森を作って')).parameters.direction, undefined,
  'direction words must not match inside unrelated compounds');

const external = [
  '北の村に雨を降らせて', '南の村に森を作って', '北村防衛',
  '北の村と南の村に雨を降らせて', '北の村と東の村に雨を降らせて',
  '東の村に雨を降らせて', '東北の村に森を作って', '桜村に食料を与えて',
  '京都の村に雨を降らせて', 'ひがしの村に雨を降らせて',
  '隣の部族に記憶を残せ', '両方の村を祝福して',
  'Oak村に雨を降らせて', 'Oak集落を祝福して', '北2村に食料を与えて',
];
for (const message of external) {
  assert.equal(inspectDivineDestination(message).unsupported, true, message);
  assert.equal(await interpret(message), null, message);
}
const uncertain = [
  '月を動かして', '雨と森を作って', '祝福して食料を与えて',
  '北と南に森を作って', '北か南に森を作って', '北東と南西に森を作って',
  '雨を降らせないで', '雨を降らせるな', '雨を降らせぬ', '雨を降らせぬように', '森を作らず', '祝福は禁止',
  '食料を減らして', '森を破壊して', '両方を祝福して',
  'もし食料があれば与えて', '雨または森を作って', '雨を降らせてそして踊って',
];
for (const message of uncertain) {
  const parsed = await interpret(message, { defaultTarget: 'home' });
  assert.deepEqual(parsed, { status: 'unclear', confidence: 0.2 }, message);
  assert.ok(validateDivineInterpretation(parsed), message);
  assert.equal(validateDivineSchema(parsed), false);
}

for (const [message, intent] of [['先祖を記憶して', 'remembrance'], ['先祖を覚えて', 'remembrance'],
  ['信仰を持って', 'faith'], ['神を信じて', 'faith'], ['共に平和に暮らそう', 'peace'],
  ['隣人と和解して', 'peace'], ['復讐を果たして', 'conflict']]) {
  const parsed = interpretOracle(message);
  assert.equal(parsed.intent, intent, message);
  assert.equal(parsed.messageKey, `priest.interpret.${intent}`);
  assert.deepEqual(parsed.messageParams, {});
  assert.match(parsed.message, /と解釈します。実行できるかは村が判断します。$/u);
}
for (const message of ['先祖を記憶しないで', '信仰を禁止', '平和または復讐', '記憶して復讐して',
  '平和にせぬ', '先祖を記憶せぬこと', '月を見て', null, '', 'x'.repeat(501)]) assert.equal(interpretOracle(message), null, String(message));

// Direct effects and Priest interpretations share the single-intent boundary.
// Rejection in the divine parser must also be rejection in its Priest fallback.
const mixed = [];
for (const [direct, priest] of [
  [['rain', 'forest', 'bless', 'curse', 'food', 'prepare for battle'], ['remember', 'faith', 'peace', 'vengeance']],
  [['비를 내려', '숲을 만들어', '축복해', '저주해', '식량을 줘', '방어해'], ['기억하라', '믿음을 가져라', '평화롭게 살자', '복수하라']],
  [['雨を降らせて', '森を作って', '祝福して', '呪って', '食料を与えて', '防衛を準備して'], ['先祖を記憶して', '信仰を持って', '平和に暮らして', '復讐して']],
]) {
  for (const first of direct) for (const second of priest) mixed.push(`${first} ${second}`);
}
for (const message of mixed) {
  assert.equal((await interpret(message)).status, 'unclear', message);
  assert.equal(interpretOracle(message), null, message);
}

const game = new Game(null);
const gameplayState = () => structuredClone({ villages: game.world.state.villages,
  resources: game.world.state.resources, terrain: game.world.state.terrain,
  buildings: game.world.state.buildings, events: game.world.state.recent_events });
const before = gameplayState();
for (const message of external) {
  const rejected = await game.sendDivineMessage(message);
  assert.equal(rejected.code, 'invalid_target', message);
  assert.deepEqual(gameplayState(), before, 'external settlement references never mutate home');
  assert.equal(game.worldDecisions.interpretations.length, 0, 'foreign symbolic requests cannot queue a home Priest action');
}
for (const message of ['雨を降らせぬ', '平和にせぬ', '雨を降らせて先祖を記憶して']) {
  assert.equal((await game.sendDivineMessage(message, 'home')).code, 'unclear', message);
  assert.equal(game.worldDecisions.interpretations.length, 0, 'rejection must not queue an alternative Priest action');
  assert.deepEqual(gameplayState(), before, `${message}: rejected request does not mutate gameplay`);
}
const rain = await game.sendDivineMessage('私たちの集落に雨を降らせて');
assert.equal(rain.ok, true);
assert.equal(game.world.getVillage('home').weather, 'rain');
assert.equal(game.world.state.villages.length, 1);

// Actual generated faction names in all supported languages are forbidden
// before provider inference, even if that provider would incorrectly use home.
let providerCalls = 0;
const guarded = new Game(null, { interpret: async () => {
  providerCalls++;
  return { status: 'understood', action: 'create_rain', target: 'home', parameters: {} };
} });
const unchanged = structuredClone(guarded.world.state);
const faction = guarded.world.state.factions[0];
for (const name of [faction.id, ...Object.values(catalogues).map(catalog => catalog[faction.nameKey])]) {
  for (const message of [`${name}に雨を降らせて`, `${name}に先祖を記憶させて`]) {
    assert.equal((await guarded.sendDivineMessage(message)).code, 'invalid_target', message);
    assert.equal(providerCalls, 0);
    assert.equal(guarded.worldDecisions.interpretations.length, 0);
    assert.deepEqual(guarded.world.state, unchanged, 'external names cannot reach a home fallback effect');
  }
}
game.stop(); guarded.stop();

console.log('japaneseInput: passed');
