// Conservative query boundary shared by chat, direct delivery and providers.
export function isQuestion(message) {
  if (typeof message !== 'string') return false;
  const s = message.normalize('NFKC').trim().toLowerCase();
  if(/^(do not|never)\b/u.test(s))return false;
  if(/^have faith[.!]?$/u.test(s))return false;
  return /[?？]/u.test(s) || /^(what|when|where|why|how|who|will|is|are|was|were|did|does|do|has|have|can|could|would|should)\b/u.test(s)
    || /뭐|언제|얼마|몇\s|왜|어떻게|어때|남았지|충분해|됐어|갔어|(?:있|없)(?:나|니)|(?:할|일|올|될)까(?:요)?[.!]?$/u.test(s)
    || /何|いつ|どこ|なぜ|どう|いくつ|ですか|ますか|あるか|いるか|足りてる|だろう/u.test(s);
}
export function queryTopic(message) {
  if (/기도|계율|의식|prayer|commandment|ritual|祈り|戒律|儀式/iu.test(message)) return 'religion';
  if (/생산|제작|production|craft|生産|製作/iu.test(message)) return 'production';
  if (/영웅|용사|던전|hero|dungeon|勇者|ダンジョン/iu.test(message)) return 'hero';
  if (/비|날씨|습격|방어|rain|weather|raid|defen|雨|天気|襲撃/iu.test(message)) return 'events';
  if (/숲|forest|tree|森/iu.test(message)) return 'buildings';
  return 'resources';
}
