import { stockLimit } from '../state/economy.js';
import { syncResourceTotals } from '../state/worldState.js';
import { RESOURCE_DEFINITIONS } from '../content/resources.js';

export const TRADE_VALUES = Object.freeze({ ...Object.fromEntries(Object.values(RESOURCE_DEFINITIONS).filter(r => r.id !== 'silver').map(r => [r.id, r.baseValue])), sheep: 3 });
export const tradeValues = definitions => ({...Object.fromEntries(Object.values(definitions??RESOURCE_DEFINITIONS).filter(r=>r.id!=='silver').map(r=>[r.id,r.baseValue])),sheep:3});
const round = n => Math.round(n*100)/100;
const fail = code => ({ok:false,code,messageKey:`trade.${code}`,messageParams:{}});
export const tradePrice = (id, side, visit, definitions) => {
  const specialty=visit?.specialty===id?0.9:1;
  const scarcity=visit?.initialStock?.[id]>0?Math.max(0.9,Math.min(1.1,1+(visit.initialStock[id]-(visit.stock[id]??0))/visit.initialStock[id]*0.1)):1;
  return round(tradeValues(definitions)[id]*(side==='sell'?0.6:1)*specialty*scarcity*(visit?.relationFactor??1));
};
export function initializeVisit(world, visit) {
  const source=world.state.factions.find(f=>f.id===visit.source);
  if(visit.equipmentStock===undefined){if(source)source.equipmentStock??=3;visit.equipmentStock=Math.min(1,source?.equipmentStock??0);if(source)source.equipmentStock-=visit.equipmentStock;}
  if(visit.tradeVersion===1){
    visit.initialStock??={...visit.stock}; visit.specialty??='cloth'; visit.relationFactor??=1; return;
  }
  // Old in-flight cargo already belongs to this visit. Never reserve it twice.
  const funds=Math.min(12,source?.resources.silver??0);
  if(source)source.resources.silver-=funds;
  Object.assign(visit,{specialty:['iron','herbs','cloth'][world.state.factions.indexOf(source)%3]??'cloth',initialStock:{...visit.stock},relationFactor:source?.stance==='allied'?0.95:source?.stance==='hostile'?1.05:1,tradeVersion:1,cash:round(funds+(visit.earned??0)),revision:0,ledger:[],commands:[],
    policy:{enabled:true,budget:Math.min(5,Math.floor((world.getVillage('home').silver??0)*25)/100),
      spent:0,reserves:{food:Math.ceil(world.getVillage('home').population*0.1*120*3),herbs:2},forbidden:['gold'],directed:[]},
    autoCount:0,nextTradeAt:visit.arriveAt+20});
}
// Quotes contain no authority: commit re-derives the same bounded offer from
// current stock/revision, rejecting forged prices, stale stock and expired visits.
export function quoteTrade(world, order) {
  if(!order||typeof order!=='object')return fail('invalid');
  const v=world.state.life?.caravan,h=world.getVillage('home');
  if(!v||v.stage!=='visiting'||world.state.time>=v.departAt)return fail('unavailable');
  initializeVisit(world,v);
  if(order.visitId!==v.id)return fail('expired');
  if(typeof order.commandId!=='string'||!order.commandId||order.commandId.length>100)return fail('invalid');
  if(v.commands.includes(order.commandId))return fail('duplicate');
  if(v.commands.length>=64)return fail('limit');
  if(!v.policy.enabled)return fail('stopped');
  let lines=order.lines;
  if(order.surplus){const {resource,retain}=order.surplus;
    if(!Object.hasOwn(tradeValues(world.content.resources),resource)||!Number.isInteger(retain)||retain<0||retain>1000)return fail('invalid');
    lines=[{side:'sell',resource,amount:Math.floor((h[resource]??0)-Math.max(retain,v.policy.reserves[resource]??0))}];
    if(lines[0].amount<1)return fail('stock');
  }
  if(!Array.isArray(lines)||!lines.length||lines.length>8||!Number.isFinite(order.budget??1000)||(order.budget??1000)<0||(order.budget??1000)>1000)return fail('invalid');
  const used=new Set();
  for(const l of lines){
    if(!l||!Object.hasOwn(tradeValues(world.content.resources),l.resource)||!['buy','sell'].includes(l.side)||!Number.isInteger(l.amount)||l.amount<1||l.amount>1000||used.has(l.resource))return fail('invalid');
    used.add(l.resource);
  }
  function evaluate(candidate){let debit=0;
    for(const l of candidate){
      const n=l.resource==='sheep'?world.state.life.sheep:(h[l.resource]??0);
      if(l.side==='buy'){
        if((v.stock[l.resource]??0)<l.amount)return fail('stock');
        if(n+l.amount>(l.resource==='sheep'?6:stockLimit(h,l.resource)))return fail('capacity');
      }else{
        if(l.resource==='sheep')return fail('invalid');
        if(v.policy.forbidden.includes(l.resource)||n-l.amount<(v.policy.reserves[l.resource]??0))return fail('reserve');
        if(n<l.amount)return fail('stock');
      }
      debit+=tradePrice(l.resource,l.side,v,world.content.resources)*l.amount*(l.side==='buy'?1:-1);
    }
    debit=round(debit);
    if(debit>Math.min(h.silver,order.budget??1000)||v.cash+debit<0)return fail('money');
    return {ok:true,debit};
  }
  let result=evaluate(lines);
  if(!result.ok&&order.partial===true){
    const maximum=Math.max(...lines.map(l=>l.amount));
    for(let n=maximum-1;n>=1;n--){
      const candidate=lines.map(l=>({...l,amount:Math.floor(l.amount*n/maximum)}));
      if(candidate.some(l=>!l.amount))continue;
      const trial=evaluate(candidate);if(trial.ok){lines=candidate;result=trial;break;}
    }
  }
  if(!result.ok)return result;
  return {ok:true,quote:{visitId:v.id,revision:v.revision,expiresAt:Math.min(v.departAt,world.state.time+60),commandId:order.commandId,
    lines:lines.map(l=>({...l,price:tradePrice(l.resource,l.side,v,world.content.resources)})),debit:result.debit}};
}
export function tradeBasket(world, order, {automatic=false}={}) {
  const result=quoteTrade(world,order);if(!result.ok)return result;
  const quote=result.quote,v=world.state.life.caravan,h=world.getVillage('home');
  if(order.quote){const q=order.quote;
    if(q.visitId!==quote.visitId||q.commandId!==quote.commandId||q.revision!==quote.revision||!Number.isFinite(q.expiresAt)||world.state.time>=q.expiresAt||q.expiresAt>quote.expiresAt
      ||q.debit!==quote.debit||JSON.stringify(q.lines)!==JSON.stringify(quote.lines))return fail('stale');
  }
  const lines=quote.lines,debit=quote.debit;
  for(const l of lines){
    const delta=l.side==='buy'?l.amount:-l.amount;
    v.stock[l.resource]=(v.stock[l.resource]??0)-delta;
    if(l.resource==='sheep')world.state.life.sheep+=delta;else h[l.resource]=(h[l.resource]??0)+delta;
    if(!automatic&&!v.policy.directed.includes(l.resource))v.policy.directed.push(l.resource);
  }
  if(order.surplus)v.policy.reserves[order.surplus.resource]=Math.max(order.surplus.retain,v.policy.reserves[order.surplus.resource]??0);
  h.silver=round(h.silver-debit);v.cash=round(v.cash+debit);v.earned=round((v.earned??0)+debit);v.revision++;
  v.commands.push(order.commandId);
  v.ledger.push({time:world.state.time,automatic,lines:structuredClone(lines),silver:-debit});v.ledger=v.ledger.slice(-12);
  if(automatic)v.policy.spent=round(v.policy.spent+Math.max(0,debit));
  if(automatic&&!v.playerDecision)v.playerDecision='autonomous';
  syncResourceTotals(world.state);
  return {ok:true,messageKey:'trade.done',messageParams:{silver:-debit,items:lines.map(l=>({resource:l.resource,amount:l.amount,side:l.side}))}};
}
export function setTradePolicy(world, order) {
  if(!order||typeof order!=='object')return fail('invalid');
  const v=world.state.life?.caravan;
  if(!v||v.stage!=='visiting'||world.state.time>=v.departAt||v.id!==order.visitId)return fail('expired');
  initializeVisit(world,v);
  if(order.setting==='forbidMany'&&Array.isArray(order.resources)&&order.resources.length>0&&order.resources.length<=64&&order.resources.every(id=>Object.hasOwn(tradeValues(world.content.resources),id))) {v.policy.forbidden=[...new Set([...v.policy.forbidden,...order.resources])];}
  else if(order.setting==='essential'&&order.resource==='food'){v.policy.enabled=true;v.policy.only='food';v.policy.directed=v.policy.directed.filter(id=>id!=='food');}
  else if(order.setting==='enabled'&&typeof order.value==='boolean')v.policy.enabled=order.value;
  else if(order.setting==='budget'&&Number.isFinite(order.value)&&order.value>=0&&order.value<=1000)v.policy.budget=order.value;
  else if(order.setting==='reserve'&&Object.hasOwn(tradeValues(world.content.resources),order.resource)&&Number.isInteger(order.value)&&order.value>=0&&order.value<=1000)v.policy.reserves[order.resource]=order.value;
  else if(order.setting==='forbid'&&Object.hasOwn(tradeValues(world.content.resources),order.resource)&&typeof order.value==='boolean'){
    v.policy.forbidden=v.policy.forbidden.filter(id=>id!==order.resource);if(order.value)v.policy.forbidden.push(order.resource);
  }else return fail('invalid');
  v.revision++;return {ok:true,messageKey:'trade.policySaved',messageParams:{}};
}
export function updateTrade(world) {
  const v=world.state.life?.caravan;if(v?.stage!=='visiting')return;
  initializeVisit(world,v);
  if(!v.policy.enabled||v.autoCount>=3||world.state.time<v.nextTradeAt||world.state.time<(v.manualHoldUntil??0))return;
  v.nextTradeAt=world.state.time+30;v.autoCount++;
  const h=world.getVillage('home'),p=v.policy;
  // Only buy essential shortages and sell unreserved surplus. Never resell a
  // purchased good or touch explicitly directed goods during this visit.
  const target=['food','herbs'].find(id=>(!p.only||p.only===id)&&!p.directed.includes(id)&&(h[id]??0)<(p.reserves[id]??0)&&(v.stock[id]??0)>0);
  if(!target)return;
  const remaining=Math.max(0,p.budget-p.spent);
  const amount=Math.min(v.stock[target],Math.ceil(p.reserves[target]-h[target]),Math.floor((remaining+1e-8)/tradePrice(target,'buy',v,world.content.resources)));
  if(!amount)return;
  const lines=[{side:'buy',resource:target,amount}];
  const cost=round(amount*tradePrice(target,'buy',v,world.content.resources));
  if(cost>h.silver){
    const resource=['wood','stone','copper'].find(id=>!p.forbidden.includes(id)&&!p.directed.includes(id)&&h[id]>(p.reserves[id]??20));
    if(!resource)return;
    const sale=Math.ceil((cost-h.silver)/tradePrice(resource,'sell',v,world.content.resources));
    if(h[resource]-sale<(p.reserves[resource]??20))return;
    lines.push({side:'sell',resource,amount:sale});
  }
  tradeBasket(world,{visitId:v.id,commandId:`auto:${v.autoCount}`,lines,budget:remaining},{automatic:true});
}

// Save files cannot introduce negative cash, unlimited budgets or malformed
// policy arrays into the automatic transaction path.
export function validTradeVisit(v, definitions) {
  const values=tradeValues(definitions);
  if(v.tradeVersion===undefined)return true;
  const num=(n,max=100000)=>Number.isFinite(n)&&n>=0&&n<=max;
  const resources=xs=>Array.isArray(xs)&&xs.length<=64&&new Set(xs).size===xs.length&&xs.every(id=>Object.hasOwn(values,id));
  const p=v.policy;
  return (v.specialty===undefined||Object.hasOwn(values,v.specialty))&&(v.relationFactor===undefined||num(v.relationFactor,1.05)&&v.relationFactor>=0.95)
    &&(v.initialStock===undefined||Object.entries(v.initialStock).every(([id,n])=>Object.hasOwn(values,id)&&num(n)))
    &&(p?.only===undefined||p.only==='food')&&v.tradeVersion===1&&num(v.cash)&&Number.isInteger(v.revision)&&v.revision>=0&&p&&typeof p.enabled==='boolean'
    &&num(p.budget,1000)&&num(p.spent)&&resources(p.forbidden)&&resources(p.directed)
    &&p.reserves&&Object.entries(p.reserves).every(([id,n])=>Object.hasOwn(values,id)&&Number.isInteger(n)&&num(n,10000000))
    &&Array.isArray(v.commands)&&v.commands.length<=64&&v.commands.every(id=>typeof id==='string'&&id.length<=100)
    &&Array.isArray(v.ledger)&&v.ledger.length<=12&&v.ledger.every(e=>num(e.time)&&typeof e.automatic==='boolean'&&Number.isFinite(e.silver)&&Array.isArray(e.lines)&&e.lines.length<=8&&e.lines.every(l=>Object.hasOwn(values,l.resource)&&['buy','sell'].includes(l.side)&&Number.isInteger(l.amount)&&num(l.amount,1000)))
    &&Number.isInteger(v.autoCount)&&num(v.autoCount,3)&&num(v.nextTradeAt)
    &&(v.manualHoldUntil===undefined||num(v.manualHoldUntil))
    &&Object.entries(v.stock).every(([id,n])=>Object.hasOwn(values,id)&&num(n));
}
