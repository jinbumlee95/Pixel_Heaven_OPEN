import { TRADE_VALUES } from './Trading.js';
const names={공구:'tools',판재:'planks',약품:'medicine',보존식:'rations',공예품:'crafts',工具:'tools',板材:'planks',薬品:'medicine',保存食:'rations',工芸品:'crafts',철광석:'iron_ore',섬유:'fiber',鉄鉱石:'iron_ore',繊維:'fiber','iron ore':'iron_ore',식량:'food',나무:'wood',목재:'wood',돌:'stone',철:'iron',구리:'copper',석탄:'coal',약초:'herbs',천:'cloth',금:'gold',양:'sheep',食料:'food',木材:'wood',石:'stone',鉄:'iron',銅:'copper',石炭:'coal',薬草:'herbs',布:'cloth',金:'gold',羊:'sheep'};
const known = id => Object.hasOwn(TRADE_VALUES,id)||typeof id==='string'&&/^[a-z][a-z0-9_-]{0,39}:[a-z][a-z0-9_-]{0,40}$/.test(id);
const resource = word => names[word]??(known(word)?word:null);
export function parseTradeCommand(text) {
  const s=text.normalize('NFKC').trim().toLowerCase().replace(/[.!。！]+$/u,'');let m;
  if(/^(거래 현황|상인 보여줘|거래 결과(?: 알려줘)?|trade status|取引状況)$/u.test(s))return {type:'meta',name:'trade'};
  if(/^(이번 상인과 거래하지 마|거래 중지|stop trading|取引停止)$/u.test(s))return {type:'order',name:'tradePolicy',setting:'enabled',value:false};
  if(/^(알아서 거래해|자동 거래|auto trade|自動取引)$/u.test(s))return {type:'order',name:'tradePolicy',setting:'enabled',value:true};
  if (/^(식량 부족분만 알아서 사|buy only missing food|不足分の食料だけ買って)$/u.test(s)) return {type:'order',name:'tradePolicy',setting:'essential',resource:'food'};
  m=s.match(/^(?:거래 예산|trade budget|取引予算)\s*(\d+)$/u);
  if(m)return {type:'order',name:'tradePolicy',setting:'budget',value:Number(m[1])};
  const forbidden=s.match(/^(.+?)(?:은|는)?\s*팔지 마$/u)??s.match(/^never sell (.+)$/u)??s.match(/^(.+)を売らない$/u);
  if(forbidden){const ids=forbidden[1].split(/와|과|,| and |と/u).map(word=>resource(word.trim().replace(/[은는]$/u,'')));
    if(ids.length>1&&ids.every(Boolean))return {type:'order',name:'tradePolicy',setting:'forbidMany',resources:[...new Set(ids)]};}
  m=s.match(/^(\S+?)(?:은|는)?\s*(\d+)개? 남기고 팔아$/u)??s.match(/^sell surplus ([a-z0-9_:-]+) keeping (\d+)$/u)??s.match(/^(\S+)を(\d+)残して売って$/u);
  if(m&&resource(m[1]))return {type:'order',name:'trade',surplus:{resource:resource(m[1]),retain:Number(m[2])}};
  // Conditions are recognized explicitly; unknown trailing prose is rejected.
  const partial=/가능한 만큼|as much as possible|できるだけ/u.test(s);
  let conditional=s.replace(/(?:가능한 만큼|as much as possible|できるだけ)\s*/gu,'').trim();
  conditional=conditional.replace(/사되 은 (\d+)개? 넘게 쓰지 마$/u,'구매 은 $1 이하');
  if(partial||conditional!==s){const parsed=parseTradeCommand(conditional);return parsed?.name==='trade'?{...parsed,...(partial?{partial:true}:{})}:{type:'invalid'};}
  m=s.match(/^(\S+)\s*(?:판매 금지|팔지 마|を売らない)$/u)??s.match(/^never sell ([a-z0-9_:-]+)$/u);
  if(m)return resource(m[1])?{type:'order',name:'tradePolicy',setting:'forbid',resource:resource(m[1]),value:true}:{type:'invalid'};
  m=s.match(/^(\S+)\s+(\d+)(?:개)?\s*(?:비축|남겨|備蓄)$/u)??s.match(/^reserve ([a-z0-9_:-]+) (\d+)$/u);
  if(m)return resource(m[1])?{type:'order',name:'tradePolicy',setting:'reserve',resource:resource(m[1]),value:Number(m[2])}:{type:'invalid'};
  m=s.match(/^(\S+)\s+(\d+)(?:개)?\s*(구매|사|사줘|판매|팔아|購入|売却)(?:\s*(?:은|budget|銀)\s*(\d+)(?:개)?\s*(?:이하|まで)?)?$/u);
  if(!m){const en=s.match(/^(buy|sell) ([a-z0-9_:-]+) (\d+)(?: budget (\d+))?$/u);if(en)m=[en[0],en[2],en[3],en[1],en[4]];}
  if(m)return resource(m[1])?{type:'order',name:'trade',lines:[{resource:resource(m[1]),amount:Number(m[2]),side:/구매|사|購入|buy/u.test(m[3])?'buy':'sell'}],...(m[4]?{budget:Number(m[4])}:{})}:{type:'invalid'};
  m=s.match(/^(\S+) (\d+)(?:개)?(?:로|와) (\S+) (\d+)(?:개)? 교환$/u)??s.match(/^barter ([a-z0-9_:-]+) (\d+) for ([a-z0-9_:-]+) (\d+)$/u)??s.match(/^(\S+) (\d+)と(\S+) (\d+)を交換$/u);
  if(m&&resource(m[1])&&resource(m[3]))return {type:'order',name:'trade',lines:[{side:'sell',resource:resource(m[1]),amount:Number(m[2])},{side:'buy',resource:resource(m[3]),amount:Number(m[4])}],budget:0};
  return null;
}

export const isTradeMessage = text => /거래|상인|구매|팔|사줘|사되|\b(?:buy|sell|trade|merchant|purchase)\b|取引|商人|買|売|購入/iu.test(text);
export function validTradeIntent(o) {
  if(!o||o.type!=='order')return false;
  const bounded=n=>Number.isInteger(n)&&n>=0&&n<=1000;
  if(o.name==='trade')return (o.partial===undefined||typeof o.partial==='boolean')&&(o.budget===undefined||bounded(o.budget))
    &&(o.surplus?known(o.surplus.resource)&&bounded(o.surplus.retain)&&o.lines===undefined:
      Array.isArray(o.lines)&&o.lines.length>0&&o.lines.length<=8&&o.lines.every(l=>l&&known(l.resource)&&['buy','sell'].includes(l.side)&&bounded(l.amount)&&l.amount>0));
  if(o.name!=='tradePolicy')return false;
  if(o.setting==='forbidMany')return Array.isArray(o.resources)&&o.resources.length>0&&o.resources.length<=64&&o.resources.every(id=>known(id));
  if(o.setting==='essential')return o.resource==='food';
  return ['enabled','forbid'].includes(o.setting)?typeof o.value==='boolean'&&(o.setting==='enabled'||known(o.resource)):
    ['budget','reserve'].includes(o.setting)&&bounded(o.value)&&(o.setting==='budget'||known(o.resource));
}
