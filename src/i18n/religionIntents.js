// Intent verbs and target vocabulary are separate from execution and state.
export const faithVocabulary = {
  commandments:{rest:['안식일','안식','일곱째 날','sabbath','rest','安息'],toil:['근면','toil','勤勉'],preserve:['숲 보호','preserve','森林保護'],expand:['개척','expand','開拓'],restraint:['절제','restraint','節制'],abundance:['풍요','abundance','豊穣']},
  rites:{harvest:['수확제','harvest festival','harvest','収穫祭'],funeral:['장례','funeral','葬儀'],departure:['출정식','departure','出陣式']},
  prayers:{food:['식량','양식','food','食料'],cloth:['천','cloth','布'],temple:['성전','temple','神殿'],healing:['치유','healing','治癒']},
  enact:/^(?:(?:계율(?:을)?\s*)?(?:선포(?:해|하라)?|지켜라|쉬어라)|enact|keep|戒律\s*宣言)$/u,
  revoke:/^(?:계율\s*철회|철회|revoke|戒律\s*撤回)$/u,
  rite:/^(?:(?:열어(?:라|줘)?|해줘|치러)|의식|ritual|hold|儀式|開いて)$/u,
  accept:/^(?:기도(?:를)?\s*(?:수락|들어주마|들어줘)|accept\s*prayer|祈り(?:を)?受け入れる)$/u,
  query:/^(?:계율|기도|의식|신앙 현황|종교|경배|commandments|prayers|rituals|religion|worship|戒律|祈り|儀式|崇拝)$/u,
  close:/^(?:종교 닫아|기도 닫아|close religion|祈りを閉じて)$/u,
  praise:/^(?:찬양(?:하라|해|해줘)?|praise(?: the worldtree)?|賛美(?:して)?)$/u,
  offering:/^(?:세계수(?:에)? 헌납(?:해|하라)?|offer to (?:the )?worldtree|世界樹に奉納)$/u,
  genericAccept:/^(?:그 기도를 들어주마|기도 수락|accept prayer|祈りを受け入れる)$/u,
  proclamations:{'이제부터 일곱째 날은 쉬어라':'rest','이제부터 쉬지 말고 일하라':'toil','이제부터 숲을 지켜라':'preserve','이제부터 땅을 넓혀라':'expand','이제부터 절제하라':'restraint','이제부터 풍요를 누려라':'abundance'},
};
export function faithVerbText(text) {
  return text.replace(/^(?:이제부터\s+|please\s+)/u,'').replace(/\b(?:the|a)\b/gu,'')
    .replace(/(?:을|를|은|は|を)/gu,'').replace(/\s+/gu,' ').trim();
}
