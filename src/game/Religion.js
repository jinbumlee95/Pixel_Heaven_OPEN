import { COMMANDMENTS, RITES, PRAYERS } from '../content/religion.js';
import { canAffordResources, spendResources } from '../state/economy.js';
import { canSpendFaith, spendFaith, faithCapacity } from './Faith.js';
import { recordEvent } from './EventJournal.js';
const homeOf = state => state.villages.find(v => v.id === 'home');
const fail = code => ({ok:false,code,messageKey:'religion.'+code,messageParams:{}});
export function initializeReligion(state, seed = state.randomState ?? 72913) {
  state.religion ??= {version:1,commandments:[],prayers:[],sequence:0,answered:0,nextPrayerAt:state.time,
    cooldowns:{},riteSequence:0,losses:0,mourned:0,lastPopulation:homeOf(state)?.population??0,departure:null,history:[]};
  const r=state.religion;
  // Persist once: neither querying nor reloading can reroll the next omen.
  r.omenSeed ??= [...String(seed)].reduce((n,c)=>Math.imul(n^c.charCodeAt(0),16777619)>>>0,2166136261);
  r.worship ??= 0; r.treeLevel ??= 0;
  state.faith.capacity=faithCapacity(state);
}
export const commandmentSlots = state => Math.min(3,1+((homeOf(state)?.templeCount??0)>0?1:0)+(state.religion.answered>=3?1:0));
export function recordReligion(state,key,params={},cause={}) {
  const e={source:'priest',action:key,time:state.time,actor:'home',messageKey:'religion.'+key,messageParams:params,...cause};
  state.religion.history.push(e);state.religion.history=state.religion.history.slice(-20);
  // Order results use WorldDecisions; autonomous prayer transitions need the same chronicle.
  recordEvent(state,e);
  return e;
}
export function needValue(state,kind) {
  const h=homeOf(state);
  return kind==='food'?(h?.food??0):kind==='cloth'?(h?.cloth??0):kind==='temple'?(h?.templeCount??0):state.hero?.hp??0;
}
export const prayerValues = state => Object.fromEntries(PRAYERS.map(k=>[k,needValue(state,k)]));
export function creditPrayer(state, messageId, before) {
  if(!Number.isSafeInteger(messageId)||messageId<1)return;
  for(const p of state.religion?.prayers??[]) {
    const after=needValue(state,p.kind);
    if(p.status==='open'&&state.time<p.expiresAt&&p.acceptedAt!==undefined&&after>before[p.kind])
      p.intervention={messageId,time:state.time,before:before[p.kind],after};
  }
}
function need(state,kind) {
  const h=homeOf(state),hero=state.hero;
  if(kind==='food')return h.food<h.population*3;
  if(kind==='cloth')return h.cloth<2;
  if(kind==='temple')return h.population>=10&&(h.templeCount??0)===0;
  return hero&&['home','recovering'].includes(hero.mode)&&hero.hp<hero.maxHp&&h.medicine<1;
}
export function updateReligion(state) {
  const r=state.religion;if(!r)return;
  const h=homeOf(state);
  if(h.population<r.lastPopulation)r.losses+=r.lastPopulation-h.population;
  r.lastPopulation=h.population;
  for(const p of r.prayers)if(p.status==='open') {
    const value=needValue(state,p.kind);
    if(value>=p.target&&value>p.initial) {
      const credited=Boolean(p.intervention);
      p.status='answered';p.resolvedAt=state.time;p.evidence={before:p.initial,after:value,credited};
      if(credited)r.answered++;
      const amount=Math.min(credited?8:1,Math.max(0,faithCapacity(state)+20-state.faith.points));
      state.faith.points+=amount;
      recordReligion(state,credited?'answered':'grateful',{amount,kind:{messageKey:'religion.prayer.'+p.kind}},
        {prayerId:p.id,...(credited?{messageId:p.intervention.messageId}:{})});
    } else if(state.time>=p.expiresAt){p.status='expired';p.resolvedAt=state.time;}
  }
  r.prayers=r.prayers.filter(p=>p.status==='open'||state.time-(p.resolvedAt??0)<1200).slice(-12);
  if(state.time<r.nextPrayerAt)return;
  r.nextPrayerAt=state.time+30;
  // Urgent healing can replace an unaccepted request; accepted promises keep their place.
  if(need(state,'healing')&&!r.prayers.some(p=>p.kind==='healing')&&r.prayers.filter(p=>p.status==='open').length>=2) {
    const displaced=r.prayers.find(p=>p.status==='open'&&p.acceptedAt===undefined);
    if(displaced){displaced.status='expired';displaced.resolvedAt=state.time;}
  }
  const rotation=PRAYERS.slice(r.sequence%PRAYERS.length).concat(PRAYERS.slice(0,r.sequence%PRAYERS.length));
  for(const kind of ['healing',...rotation.filter(k=>k!=='healing')]) {
    if(r.prayers.filter(p=>p.status==='open').length>=2)break;
    if(!need(state,kind)||r.prayers.some(p=>p.kind===kind))continue;
    const target=kind==='food'?h.population*3:kind==='cloth'?2:kind==='temple'?1:state.hero.maxHp;
    r.prayers.push({id:'prayer-'+(++r.sequence),kind,status:'open',createdAt:state.time,expiresAt:state.time+600,initial:needValue(state,kind),target});
    recordReligion(state,'opened',{kind:{messageKey:'religion.prayer.'+kind}});
  }
}
export function ritePreview(state,id) {
  const r=state.religion,h=homeOf(state);
  const prepared=((h.templeCount??0)>0?1:0)+((h.labor?.building??0)===0?1:0)+(r.commandments.includes(id==='harvest'?'abundance':'rest')?1:0);
  // The next omen is fixed by rite sequence, not rerolled by repeated queries.
  let hash=(r.omenSeed??72913)^Math.imul(r.riteSequence+1,1103515245);
  hash=Math.imul(hash^(hash>>>16),0x45d9f3b);hash=Math.imul(hash^(hash>>>16),0x45d9f3b);
  const roll=((hash^(hash>>>16))>>>0)%100;
  const quality=roll<15+prepared*10?2:roll<55+prepared*10?1:0;
  return {quality};
}
export function validReligionOrder(o) {
  return o?.type==='order'&&o.name==='religion'&&(
    ['enact','revoke'].includes(o.operation)&&Object.hasOwn(COMMANDMENTS,o.id)
    ||o.operation==='rite'&&Object.hasOwn(RITES,o.id)
    ||o.operation==='accept'&&(o.id==='next'||PRAYERS.includes(o.id))
    ||['praise','offering'].includes(o.operation));
}
export function religionOrder(world,o) {
  const s=world.state,r=s.religion,h=homeOf(s);
  if(!r||!validReligionOrder(o))return fail('invalid');
  const success=(key,params={})=>({ok:true,event:recordReligion(s,key,params),messageKey:'religion.'+key,messageParams:params});
  if(o.operation==='accept') {
    const candidates=r.prayers.filter(p=>p.status==='open'&&s.time<p.expiresAt&&p.acceptedAt===undefined&&(o.id==='next'||p.kind===o.id));
    if(candidates.length!==1)return fail(candidates.length?'choosePrayer':'noPrayer');
    const p=candidates[0];p.acceptedAt=s.time;p.acceptedMessageId=o.messageId??null;
    return success('accepted',{kind:{messageKey:'religion.prayer.'+p.kind}});
  }
  if(o.operation==='praise') {
    if(!canSpendFaith(s,50))return fail('faith');
    if(r.worship>999999990)return fail('worshipFull');
    spendFaith(s,50);r.worship+=10;
    return success('praised');
  }
  if(o.operation==='offering') {
    if(r.treeLevel>=3)return fail('treeComplete');
    const level=r.treeLevel+1,cost={wood:20*level,stone:10*level,crafts:2*level};
    if(r.worship<20*level||!canAffordResources(h,cost))return fail('offeringMaterials');
    spendResources(h,cost);r.worship-=20*level;r.treeLevel=level;
    h.happiness=Math.min(100,h.happiness+5);s.faith.capacity=faithCapacity(s);
    return success('offered',{level});
  }
  if(o.operation==='enact') {
    if(r.commandments.includes(o.id))return fail('already');
    if(r.commandments.some(id=>COMMANDMENTS[id].group===COMMANDMENTS[o.id].group))return fail('conflict');
    if(r.commandments.length>=commandmentSlots(s))return fail('slotsFull');
    if(!canSpendFaith(s,30))return fail('faith');
    spendFaith(s,30);r.commandments.push(o.id);
    return {ok:true,event:recordReligion(s,'enacted',{name:{messageKey:'religion.rule.'+o.id}}),messageKey:'religion.enacted',messageParams:{name:{messageKey:'religion.rule.'+o.id}}};
  }
  if(o.operation==='revoke') {
    if(!r.commandments.includes(o.id))return fail('missing');
    r.commandments=r.commandments.filter(id=>id!==o.id);h.happiness=Math.max(0,h.happiness-5);
    return {ok:true,event:recordReligion(s,'revoked',{name:{messageKey:'religion.rule.'+o.id}}),messageKey:'religion.revoked',messageParams:{name:{messageKey:'religion.rule.'+o.id}}};
  }
  const rite=RITES[o.id];
  if(s.time<(r.cooldowns[o.id]??0))return fail('cooldown');
  if(o.id==='funeral'&&r.losses<=r.mourned)return fail('noLoss');
  if(o.id==='departure'&&(!['home','recovering'].includes(s.hero?.mode)||r.departure))return fail('away');
  if(!canSpendFaith(s,rite.faith))return fail('faith');
  if(!canAffordResources(h,rite.cost))return fail('materials');
  const {quality}=ritePreview(s,o.id);
  spendResources(h,rite.cost);spendFaith(s,rite.faith);r.riteSequence++;r.cooldowns[o.id]=s.time+rite.cooldown;
  if(o.id==='harvest'){h.happiness=Math.min(100,h.happiness+10+quality*5);h.devotionUntil=Math.max(h.devotionUntil??0,s.time+120+quality*60);}
  if(o.id==='funeral'){h.happiness=Math.min(100,h.happiness+8+quality*4);r.mourned=r.losses;}
  if(o.id==='departure')r.departure={armor:1+quality,missionId:null};
  const params={name:{messageKey:'religion.rite.'+o.id},quality:{messageKey:'religion.quality.'+quality}};
  return {ok:true,event:recordReligion(s,'celebrated',params),messageKey:'religion.celebrated',messageParams:params};
}
export function religionConflict(state,action,order) {
  return state.religion?.commandments.includes('preserve')&&(order?.name==='labor'&&order.role==='woodcutting'&&order.amount>(homeOf(state)?.labor?.woodcutting??0))
    ? fail('forestConflict'):null;
}
export function validReligion(r) {
  const n=v=>Number.isSafeInteger(v)&&v>=0;
  if(r&&((r.worship!==undefined&&(!n(r.worship)||r.worship>1e9))||(r.treeLevel!==undefined&&(!n(r.treeLevel)||r.treeLevel>3))||(r.omenSeed!==undefined&&(!n(r.omenSeed)||r.omenSeed>0xffffffff))))return false;
  if(!r||r.version!==1||!Array.isArray(r.commandments)||r.commandments.length>3||new Set(r.commandments).size!==r.commandments.length||r.commandments.some(id=>!Object.hasOwn(COMMANDMENTS,id))||new Set(r.commandments.map(id=>COMMANDMENTS[id].group)).size!==r.commandments.length)return false;
  if(!['sequence','answered','nextPrayerAt','riteSequence','losses','mourned','lastPopulation'].every(k=>n(r[k]))||r.mourned>r.losses||!r.cooldowns||Object.entries(r.cooldowns).some(([k,v])=>!Object.hasOwn(RITES,k)||!n(v))||!Array.isArray(r.history)||r.history.length>20)return false;
  if(r.departure!==null&&(!r.departure||![1,2,3].includes(r.departure.armor)||r.departure.missionId!==null&&!n(r.departure.missionId)))return false;
  if(Array.isArray(r.prayers)&&r.prayers.some(p=>
    p.acceptedAt!==undefined&&(!n(p.acceptedAt)||p.acceptedAt<p.createdAt||p.acceptedAt>=p.expiresAt)
    ||p.acceptedMessageId!==undefined&&p.acceptedMessageId!==null&&(!n(p.acceptedMessageId)||p.acceptedMessageId===0)
    ||p.intervention!==undefined&&(p.acceptedAt===undefined||!p.intervention||!n(p.intervention.messageId)||p.intervention.messageId===0
      ||!n(p.intervention.time)||p.intervention.time<p.acceptedAt||!Number.isFinite(p.intervention.before)||p.intervention.before<0
      ||!Number.isFinite(p.intervention.after)||p.intervention.after<=p.intervention.before)))return false;
  return Array.isArray(r.prayers)&&r.prayers.length<=12&&new Set(r.prayers.map(p=>p.id)).size===r.prayers.length&&r.prayers.filter(p=>p.status==='open').length<=2&&r.prayers.every(p=>/^prayer-[1-9]\d*$/.test(p.id)&&Number(p.id.slice(7))<=r.sequence&&PRAYERS.includes(p.kind)&&['open','answered','expired'].includes(p.status)&&n(p.createdAt)&&n(p.expiresAt)&&p.expiresAt>p.createdAt&&Number.isFinite(p.initial)&&p.initial>=0&&Number.isFinite(p.target)&&p.target>p.initial&&(p.status==='open'||n(p.resolvedAt)));
}
