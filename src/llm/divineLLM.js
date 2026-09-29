import { isQuestion } from './DialogueAct.js';
// Stateless mock interpreter. Only plain context enters this async interface;
// neither the mock nor a future provider receives mutable world state.
const HOME_ENGLISH = new Set(['our', 'my', 'this', 'the', 'home', 'current', 'worldtree']);
const HOME_KOREAN = new Set(['우리', '내', '나의', '이', '현재', '세계수']);
const HOME_JAPANESE = new Set(['私たちの', '私達の', '私の', 'この', '我々の', '世界樹の', '世界樹']);
// Common dungeon typos/romanizations: deongun, dungun, dungeoun, deonjeon.
const DUNGEON_TYPOS = /\bd(?:u|eo|o)n[gj](?:eo|e|u|o)u?n\b/giu;
export const normalizeDungeonTypos = text => typeof text === 'string' ? text.replace(DUNGEON_TYPOS, 'dungeon') : text;
const ACTION_PATTERNS = [
  ['prepare_fire', /\bfirebreaks?\b|방화선|防火帯/u],
  ['prepare_flood', /\b(?:drainage|prepare for (?:a )?flood)\b|배수로|排水路/u],
  ['prepare_cold', /\b(?:winter shelter|prepare for (?:winter|cold))\b|한파 대비|寒波に備え/u],
  ['propose_alliance', /\bpropose an alliance\b|동맹을 제안|同盟を提案/u],
  ['propose_truce', /\bpropose a truce\b|휴전을 제안|停戦を提案/u],
  ['hold_festival', /\bhold a festival\b|축제를 열|祭りを開/u],
  ['build_house', /\b(?:build|construct)\b.*\b(?:house|home|housing)\b|집.*(?:지어|짓|건설)|주택|家.*(?:建て|建設)/u],
  ['farm', /\b(?:plant|build|cultivate|create)\b.*\b(?:field|farm)\b|밭.*(?:만들|가꾸|일구|지어)|농지|畑.*(?:作|耕)|農地/u],
  ['build_temple', /\b(?:build|construct)\b.*\b(?:temple|shrine)\b|(?:사원|성전).*?(?:지어|짓|건설)|神殿.*(?:建て|建設)/u],
  ['hero_dispatch', /\b(?:dungeon|expedition|explore|dispatch)\b|던전|탐험|원정|파견|ダンジョン|探索|遠征|派遣/u],
  ['hero_recall', /\b(?:recall|return|come back|bring (?:our |the )?hero home|call (?:our |the )?hero back)\b|복귀|귀환|돌아오|돌아와|帰還|呼び戻|戻って/u],
  ['prepare_defense', /\b(?:defen[ds]\w*|protect|guard|prepare for battle|rally|muster|cover|barricades?|obstacles?|traps?)\b|지켜|지키|방어|수비|전투\s*준비|소집|엄폐|장애물|바리케이드|덫|덪|함정|守って|守れ|防衛|防御|戦闘\s*準備|戦いに備え|召集|遮蔽物|遮蔽|バリケード|障害物|罠/u],
  ['create_rain', /\brain\b|(?<![가-힣])비(?:를|가|좀|\s|$)|비내|비오|雨/u],
  ['create_forest', /\b(?:forest|trees?)\b|숲|나무|森|植林|木を植え/u],
  ['bless_village', /\bbless(?:ing)?\b|축복|祝福|加護/u],
  ['curse_village', /\bcurse\b|저주|呪い|呪う|呪って|呪え|呪詛/u],
  ['increase_food', /\b(?:food|feed)\b|식량|음식|食料|食糧|食べ物/u],
];
// Priest interpretations are also actions. A request mixing one of these with
// a direct divine effect must not silently execute only the divine half.
const PRIEST_KEYWORDS = /\b(?:remember|memory|memorial|ancestors|faith|believe|worship|unite|peace|together|reconcile|revenge|vengeance|enemy)\b|기억|추모|선조|믿음|신앙|섬기|화해|평화|함께|복수|원수|記憶|覚えて|思い出|追悼|先祖|信仰|信じ|崇め|祈り|和解|平和|共に|復讐|復しゅう|仇|敵/u;
const UNSAFE_ENGLISH = /\b(?:not|never|no|cannot|\w+n['’‘]t|stop|cancel|remove|destroy|decrease|both|all|if|unless|whether|either|or)\b/u;
const UNSAFE_KOREAN = [
  /말아|말고|마라|않|없애|파괴|줄여|모든|두\s*마을/u,
  /지\s*마(?:라|세요|십시오|요)?(?=$|[^\p{L}\p{N}_])/u,
  /(?<![가-힣])(?:안|못)(?=$|[^\p{L}\p{N}_]|설치|준비|소집|해|하|만들|내려|내리|보내|심|축복|저주|방어|수비|복귀|귀환|파견|탐험|돌아오|돌아와)/u,
  /(?<![가-힣])(?:취소|중지|중단)(?=$|[^\p{L}\p{N}_]|해|하|했|할|합|되|된|돼|를|는|가|만)/u,
  /(?<![가-힣])(?:만약|경우|조건|또는|혹은|아니면)(?=$|[^\p{L}\p{N}_]|에|의|은|는|이|을|도|만)/u,
  /(?:으면|다면|라면|하면|되면|오면|가면|나면|거나|이나)(?=$|[^\p{L}\p{N}_])/u,
];
// This is deliberately a small Japanese command vocabulary, not a language
// model. Reject wording whose intent the keyword mock cannot safely resolve.
const UNSAFE_JAPANESE = /ない|なく|なかった|ません|ず(?:に|[、。]|$)|ぬ(?:よう|こと|まま|で|と|[、。！？!\s]|$)|禁止|やめ|止め|中止|取り消|取消|不要|避け|(?:る|す|う|く|ぐ|つ|む|ぶ|ぬ)な(?:よ)?(?:[。、！!]|$)|減ら|破壊|壊|焼き払|両方|すべて|全て|全部|両村|(?:二|2)つの村|もし|場合|かどうか|または|あるいは|もしくは|それとも|そして|それから|その後|加えて|さらに|ついでに|東西|南北|四方|全方向/u;
const JAPANESE_DIRECTIONS = [
  ['northeast', '北東|東北'], ['northwest', '北西|西北'],
  ['southeast', '南東|東南'], ['southwest', '南西|西南'],
  ['north', '北'], ['south', '南'], ['east', '東'], ['west', '西'],
].map(([direction, words]) => [direction, new RegExp(
  `(?<![\\p{Script=Han}\\p{Script=Katakana}])(?:${words})(?:側|方向|方)?(?=[にへのかとや、。！？!\\s]|$)`, 'gu')]);
const DIRECTION_PATTERNS = [
  ['northeast', /\bnorth[ -]?east\b|북동(?:쪽)?/gu],
  ['northwest', /\bnorth[ -]?west\b|북서(?:쪽)?/gu],
  ['southeast', /\bsouth[ -]?east\b|남동(?:쪽)?/gu],
  ['southwest', /\bsouth[ -]?west\b|남서(?:쪽)?/gu],
  ['north', /\bnorth(?:ern)?\b|북쪽|북부|북/gu],
  ['south', /\bsouth(?:ern)?\b|남쪽|남부|남/gu],
  ['east', /\beast(?:ern)?\b|동쪽|동부|동/gu],
  ['west', /\bwest(?:ern)?\b|서쪽|서부/gu],
];

// Fixed mock confidence is a schema-compatible signal, not a calibrated score.
const unclear = () => ({ status: 'unclear', confidence: 0.2 });

export function hasUnsupportedCommandWording(text) {
  return UNSAFE_ENGLISH.test(text) || UNSAFE_KOREAN.some(pattern => pattern.test(text)) || UNSAFE_JAPANESE.test(text);
}

export function hasDivineActionWords(text) {
  return ACTION_PATTERNS.some(([, pattern]) => pattern.test(text));
}

// Resolve only the player's settlement. This boundary is also used before a
// real provider and before the Priest's symbolic interpretation, so a named
// foreign destination can never be silently redirected to the player.
export function inspectDivineDestination(message, { defaultTarget = 'home', foreignNames = [] } = {}) {
  let text = typeof message === 'string' ? message.normalize('NFKC').toLowerCase() : '';
  text = text.replace(/((?:영웅|용사)(?:을|를|은|는|이|가)?)\s+마을로/gu, '$1 우리 마을로');
  text = text.replace(/\b(defend|protect|guard)\s+village\b/gu, '$1 our village');
  let diplomacyFaction;
  if (/\bpropose (?:an alliance|a truce)\b|동맹을 제안|휴전을 제안|同盟を提案|停戦を提案/u.test(text)) {
    const ids = text.match(/faction-\d{2}/gu) ?? [];
    if (ids.length === 1) { diplomacyFaction = ids[0]; text = text.replace(ids[0], ' '); }
  }
  let unsupported = false;
  let target = defaultTarget;
  const reject = name => { unsupported = true; target = `external:${name || 'unknown'}`; return ' '; };
  for (const name of foreignNames) {
    if (typeof name !== 'string' || !name.trim()) continue;
    const normalized = name.normalize('NFKC').toLowerCase();
    if (text.includes(normalized)) reject(normalized);
  }
  // Consume home phrases first, keeping placement words outside them intact.
  text = text.replace(/\bworld\s+tree\s+(?:settlement|village)\b/gu, ' ');
  text = text.replace(/\b(?:settlement|village|faction|tribe|clan|kingdom|empire)\s+(?:of|named|called)\s+([\p{L}\p{N}_-]+)/gu,
    (match, name) => HOME_ENGLISH.has(name) ? ' ' : reject(name));
  text = text.replace(/([\p{L}\p{N}_-]+)\s+(settlements?|villages?|factions?|tribes?|clans?|kingdoms?|empires?|company)\b/gu,
    (match, name, kind) => ['settlement', 'village'].includes(kind) && HOME_ENGLISH.has(name) ? ' ' : reject(name));
  text = text.replace(/([\p{L}\p{N}_-]+)\s*(정착지|마을|부족|진영|세력|왕국|제국|상단)/gu,
    (match, name, kind) => ['정착지', '마을'].includes(kind) && HOME_KOREAN.has(name) ? ' ' : reject(name));
  text = text.replace(/(?:私たちの|私達の|私の|この|我々の|世界樹の|世界樹)(?:集落|村)/gu, ' ');
  text = text.replace(/([\p{L}\p{N}_-]+?)(集落|村|部族|勢力|王国|帝国)/gu,
    (match, name, kind) => ['集落', '村'].includes(kind) && HOME_JAPANESE.has(name) ? ' ' : reject(name));
  // A bare faction/tribe request is foreign even without an identifiable name.
  if (/\b(?:another|other|foreign|enemy|neighbor(?:ing)?)\s+(?:settlement|village|faction|tribe)\b|다른\s*(?:정착지|마을|세력)|이웃\s*(?:정착지|마을)|別の(?:集落|村)|他の(?:集落|村)/u.test(text)) reject('other');
  return { target, text, unsupported, ...(diplomacyFaction ? { diplomacyFaction } : {}) };
}

export async function interpretDivineMessage(message, context = {}) {
  if(isQuestion(message))return {status:"unclear",confidence:0};
  if (typeof message !== 'string' || !message.trim() || message.length > 500) return null;
  const destination = inspectDivineDestination(message, context);
  if (destination.unsupported) return null;
  let text = normalizeDungeonTypos(destination.text);
  // Negation, conditions and alternatives cannot become an immediate command.
  if (hasUnsupportedCommandWording(text)) return unclear();
  let actions = ACTION_PATTERNS.filter(([, pattern]) => pattern.test(text));
  // "Recall the hero from the dungeon" names the location, not two orders.
  if (actions.some(([id]) => id === 'hero_recall') && /\bhero\b|영웅|용사|勇者|英雄/u.test(text)
    && !/\b(?:send|dispatch|explore)\b|파견|보내|탐험하|派遣|送り|探索し/u.test(text)) {
    actions = actions.filter(([id]) => id !== 'hero_dispatch');
  }
  const intentText = actions[0]?.[0] === 'prepare_defense' ? text.replace(/\bfrom (?:the )?enem(?:y|ies)\b/gu, '') : text;
  if (actions.length !== 1 || PRIEST_KEYWORDS.test(intentText)) return unclear();
  const action = actions[0][0];
  if (action.startsWith('hero_') && !/\bhero\b|영웅|용사|勇者|英雄/u.test(text)) return unclear();
  const parameters = action === 'increase_food' ? { amount: 50 }
    : ['create_forest', 'prepare_defense', 'hero_dispatch', 'hero_recall', 'build_house', 'farm', 'build_temple', 'hold_festival', 'propose_alliance', 'propose_truce','prepare_fire','prepare_flood','prepare_cold'].includes(action) ? {} : { strength: 1 };
  if (action.startsWith('propose_') && destination.diplomacyFaction) parameters.factionId = destination.diplomacyFaction;
  if (action === 'increase_food') {
    const numbers = text.match(/[+-]?\d+(?:[.,]\d+)*/gu) ?? [];
    if (numbers.length > 1 || (numbers.length && (!/^\d+$/.test(numbers[0]) || +numbers[0] < 1 || +numbers[0] > 1000))) return unclear();
    if (numbers.length) parameters.amount = Number(numbers[0]);
  }
  if (action === 'prepare_defense') {
    const preparations = [
      ['cover', /\bcover\b|엄폐|遮蔽物|遮蔽/u],
      ['barricade', /\b(?:barricades?|obstacles?)\b|장애물|바리케이드|バリケード|障害物/u],
      ['trap', /\btraps?\b|덫|덪|함정|罠/u],
    ].filter(([, pattern]) => pattern.test(text));
    if (preparations.length > 1) return unclear();
    if (preparations.length) parameters.preparation = preparations[0][0];
  }
  if (['create_forest', 'build_house', 'farm', 'build_temple'].includes(action)) {
    const directions = new Set();
    for (const [direction, pattern] of [...DIRECTION_PATTERNS, ...JAPANESE_DIRECTIONS]) {
      // Consume compound directions first so 'north east' is not two hints.
      text = text.replace(pattern, () => { directions.add(direction); return ' '; });
    }
    if (directions.size > 1) return unclear();
    if (directions.size === 1) parameters.direction = [...directions][0];
  }
  return { status: 'understood', action, target: destination.target, parameters };
}
