export const ORACLE_SUBJECTS=['rain','food','hero','forest','faith','trade','unknown'];
export function oracleSubject(message) {
  for(const [id,re] of [['rain',/rain|비|雨/iu],['food',/food|식량|食料/iu],['hero',/hero|영웅|용사|勇者/iu],['forest',/forest|숲|森/iu],['faith',/faith|prayer|신앙|기도|祈/iu],['trade',/trade|buy|sell|거래|상인|交易/iu]])if(re.test(message))return id;
  return 'unknown';
}
export const failureCatalogs=Object.fromEntries(['ko','en','ja'].map((lang,i)=>[lang,{
 'oracle.failed':[
 '신탁 해석에 실패해 아무 명령도 실행하지 않았습니다. 인지한 대상: {subject}. 할 행동을 짧게 지정해서 다시 말해주세요.',
 'Interpretation failed; no command was executed. Recognized subject: {subject}. Please retry with one clear action.',
 '解釈に失敗し、指示は実行していません。認識した対象: {subject}。行動を一つ指定して再送してください。'][i],
 ...Object.fromEntries(ORACLE_SUBJECTS.map((key,j)=>['oracle.subject.'+key,[['비','식량','용사','숲','신앙','거래','미확인'],['rain','food','hero','forest','faith','trade','unknown'],['雨','食料','勇者','森','信仰','交易','不明']][i][j]]))
}]));
