import assert from 'node:assert/strict';
import { interpretDivineMessage } from '../src/llm/divineLLM.js';
import { validateDivineSchema } from '../src/llm/schemas.js';
import { I18n } from '../src/i18n/I18n.js';
import { interpretOracle } from '../src/game/PriestInterpretation.js';
import { Game } from '../src/game/Game.js';

for (const locale of ['ko', 'en', 'ja']) {
  const i18n = new I18n({ locale, storage: null });
  for (const kind of ['balanced', 'cover', 'barricade', 'trap']) {
    const action = await interpretDivineMessage(i18n.t(`combat.prompt.${kind}`));
    assert.equal(action?.target, 'home', `${locale}:${kind}`);
    assert.equal(action?.action, 'prepare_defense');
    assert.equal(action.parameters.preparation ?? 'balanced', kind);
    assert.ok(validateDivineSchema(action));
  }
}
const ambiguous = ['Prepare cover and traps', '엄폐와 덫을 준비해', '遮蔽と罠を準備して',
  "Don't prepare traps", 'don’t set traps', 'don‘t set traps', 'no traps', 'stop building barricades',
  'cancel cover preparation', 'if raiders retreat, set traps', 'prepare traps unless scouts return',
  'muster or build cover', 'either muster or build cover',
  '덫을 만들지 마라', '덫을 설치하지 마', '덫을 설치하지마!', '덫을 설치하지 마세요',
  '덫은 안 설치해', '덫은 안설치해', '엄폐 설치 취소', '엄폐 설치를 취소해줘',
  '습격이 없으면 덫을 설치해', '습격한다면 엄폐를 준비해', '준비가 끝나면 덫을 설치해',
  '만약 습격이 오면 장애물을 설치해', '습격이 올 경우 덫을 설치해',
  '소집 또는 엄폐를 준비해', '소집하거나 엄폐를 준비해', '소집 아니면 엄폐를 준비해',
  '罠を作らないで', 'if enemy retreats, set traps', '원수가 오면 덫을 설치해',
  'if enemy retreats, remember them', '원수가 오면 기억하라'];
for (const [preparations, interpretations] of [
  [['muster', 'cover', 'barricade', 'trap'], ['enemy', 'peace']],
  [['소집', '엄폐', '장애물', '덫'], ['복수', '평화']],
  [['召集', '遮蔽', 'バリケード', '罠'], ['復讐', '平和']],
]) {
  for (const preparation of preparations) for (const interpretation of interpretations) {
    ambiguous.push(`${preparation} ${interpretation}`);
  }
}
for (const input of ambiguous) {
  assert.equal((await interpretDivineMessage(input))?.status, 'unclear', input);
  assert.equal(interpretOracle(input), null, `${input}: no symbolic fallback action`);
}
for (const [input, preparation] of [
  ['muster swordsmen and archers', 'balanced'], ['defend with swords and bows', 'balanced'],
  ['cover our archers', 'cover'], ['검과 활로 방어를 준비해', 'balanced'],
  ['안전하게 방어를 준비해', 'balanced'], ['안개 속에서 엄폐를 준비해', 'cover'],
  ['우리 정착지 안에 덫을 설치해', 'trap'], ['화면 중앙에 장애물을 설치해', 'barricade'],
]) {
  const result = await interpretDivineMessage(input);
  assert.equal(result?.action, 'prepare_defense', input);
  assert.equal(result.parameters.preparation ?? 'balanced', preparation, input);
}
assert.equal((await interpretDivineMessage('덪을 설치해줘')).parameters.preparation, 'trap');
const action = { status: 'understood', action: 'prepare_defense', target: 'home', parameters: { preparation: 'trap' } };
for (const value of ['delete_world', null, 1, {}, ['trap']]) {
  assert.equal(validateDivineSchema({ ...action, parameters: { preparation: value } }), false);
}
assert.equal(validateDivineSchema({ ...action, parameters: { preparation: 'trap', x: 5 } }), false);
assert.equal(await interpretDivineMessage('Prepare traps for Oak village'), null);
const game = new Game(null);
const gameplayState = () => {
  const state = structuredClone(game.world.state);
  delete state.entities.get(game.priestEntity.id).lastInterpretation;
  return state;
};
const before = gameplayState();
for (const input of ambiguous) {
  assert.equal((await game.sendDivineMessage(input)).code, 'unclear', input);
  assert.equal(game.worldDecisions.interpretations.length, 0, `${input}: no queued Priest action`);
  assert.deepEqual(gameplayState(), before, `${input}: no preparation, spending or world mutation`);
}
game.stop();
console.log('combatInput: passed');
