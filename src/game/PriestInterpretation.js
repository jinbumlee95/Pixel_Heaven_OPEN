import { hasDivineActionWords, hasUnsupportedCommandWording } from '../llm/divineLLM.js';

// A small, uncertain human interpretation, not a divine action. Unrelated or
// contradictory imagery still receives the existing request for clarification.

export function interpretOracle(message) {
  if (typeof message !== 'string' || !message.trim() || message.length > 500) return null;
  const text = message.normalize('NFKC').toLowerCase();
  if (hasUnsupportedCommandWording(text) || hasDivineActionWords(text)) return null;
  const matches = [
    ['remembrance', /\b(?:remember|memory|memorial|ancestors)\b|기억|추모|선조|記憶|覚えて|思い出|追悼|先祖/u],
    ['faith', /\b(?:faith|believe|worship)\b|믿음|신앙|섬기|信仰|信じ|崇め|祈り/u],
    ['peace', /\b(?:unite|peace|together|reconcile)\b|화해|평화|함께|和解|平和|共に/u],
    ['conflict', /\b(?:revenge|vengeance|enemy)\b|복수|원수|復讐|復しゅう|仇|敵/u],
  ].filter(([, pattern]) => pattern.test(text));
  if (matches.length !== 1) return null;
  const intent = matches[0][0];
  const ko = /[가-힣]/u.test(message);
  const ja = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(message);
  const meanings = {
    remembrance: ['build a temple to preserve our memory', '기억을 보존할 사원을 세우라는 뜻', '記憶を守るために神殿を建てるべきだ'],
    faith: ['embrace the sky god', '하늘 신에 대한 믿음을 받아들이라는 뜻', '天空の神への信仰を受け入れるべきだ'],
    peace: ['seek an alliance with our neighbors', '이웃과 동맹을 맺으라는 뜻', '隣人との同盟を目指すべきだ'],
    conflict: ['confront a hostile neighbor', '적대적인 이웃에 맞서라는 뜻', '敵対する隣人に立ち向かうべきだ'],
  };
  return { intent, messageKey: `priest.interpret.${intent}`, messageParams: {}, message: ko
    ? `저는 ${meanings[intent][1]}으로 해석합니다. 마을이 실행할 수 있을지 판단할 것입니다.`
    : ja ? `${meanings[intent][2]}と解釈します。実行できるかは村が判断します。`
    : `I believe we should ${meanings[intent][0]}. The village will decide whether it can act.` };
}
