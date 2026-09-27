import { syncResourceTotals } from '../state/worldState.js';
import { canAffordResources, spendResources, stockLimit } from '../state/economy.js';

const fail = code => ({ ok: false, code, messageKey: `diplomacy.failure.${code}`, messageParams: {} });
export function initializeDiplomacy(world) {
  world.state.diplomacy ??= { sequence: 0, proposals: [], lastTick: world.state.time, nextTrade: world.state.time + 60 };
}
export function proposeDiplomacy(world, kind, factionId) {
  const state = world.state, home = world.getVillage('home');
  if (!state.diplomacy || !['alliance', 'truce', 'trade'].includes(kind)) return fail('invalid');
  const faction = state.factions.find(f => f.id === factionId)
    ?? (!factionId ? state.factions.filter(f => kind === 'truce' ? f.stance === 'hostile' : f.stance !== 'hostile' && (kind !== 'alliance' || f.stance !== 'allied'))
      .sort((a,b) => state.story?.personality === 'hopeful' ? b.strength-a.strength : (Number(a.temperament==='aggressive')-Number(b.temperament==='aggressive'))*100+a.strength-b.strength)[0] : null);
  if (!faction) return fail('target');
  if (state.diplomacy.proposals.some(p => ['pending','counteroffer'].includes(p.status) && p.factionId === faction.id)) return fail('pending');
  if ((kind === 'alliance' && faction.stance === 'allied') || (kind === 'truce' && faction.stance !== 'hostile')) return fail('unneeded');
  const cost = kind === 'trade' ? { wood: 5 } : { food: 4, silver: 1 };
  if (!canAffordResources(home,cost)) return fail('supplies');
  spendResources(home,cost);
  const proposal = { id: `proposal-${++state.diplomacy.sequence}`, factionId: faction.id, kind, cost, status: 'pending',
    createdAt: state.time, responseAt: state.time + 20, expiresAt: state.time + 60 };
  state.diplomacy.proposals.push(proposal);state.diplomacy.proposals=state.diplomacy.proposals.slice(-32);
  syncResourceTotals(state);
  return { ok:true, messageKey:'diplomacy.sent', messageParams:{ proposal:proposal.id, faction:{factionId:faction.id,nameKey:faction.nameKey}, kind:{messageKey:`diplomacy.${kind}`} } };
}
export class DiplomacySystem {
  constructor(world,{onEvent=()=>{}}={}) { this.world=world;this.onEvent=onEvent;initializeDiplomacy(world); }
  update() {
    const state=this.world.state, home=this.world.getVillage('home'), diplomacy=state.diplomacy;
    if(diplomacy.lastTick>=state.time)return;diplomacy.lastTick=state.time;
    for(const p of diplomacy.proposals) {
      if(p.status==='counteroffer') {
        if(state.time>=p.expiresAt)respondCounteroffer(this.world,p.id,false,this.onEvent);
        continue;
      }
      if(p.status!=='pending'||state.time<p.responseAt)continue;
      const faction=state.factions.find(f=>f.id===p.factionId);
      const accepted=state.time<=p.expiresAt && home.population>0 && faction && (p.kind==='trade' ? faction.stance!=='hostile' && faction.resources.food>=45
        : p.kind==='alliance' ? faction.stance!=='hostile' && faction.temperament!=='aggressive'
          : faction.stance!=='hostile'||faction.strength<60||faction.resources.food<30);
      if(!accepted&&p.kind==='truce'&&faction&&home.population>0&&state.time<p.expiresAt){
        p.status='counteroffer';p.extraCost={silver:3};
        this.onEvent({source:'factions',action:'counteroffer',actor:p.factionId,time:state.time,...(p.messageId?{messageId:p.messageId}:{}),messageKey:'diplomacy.counteroffer',messageParams:{costs:{resourceBasket:p.extraCost}}});continue;
      }
      if(!accepted&&Object.entries(p.cost).some(([id,n])=>home[id]+n>stockLimit(home,id)))continue;
      if(accepted&&p.kind==='trade'&&home.food+25>stockLimit(home,'food'))continue;
      p.status=accepted?'accepted':'rejected';p.resolvedAt=state.time;
      if(accepted) {
        if(p.kind==='trade'){home.food+=25;faction.resources.food-=25;faction.resources.wood=Math.min(500,faction.resources.wood+5);}
        else {faction.stance=p.kind==='alliance'?'allied':'neutral'; faction.treatyUntil=state.time+600;for(const [id,n]of Object.entries(p.cost))faction.resources[id]=(faction.resources[id]??0)+n;}
      } else for(const [resource,amount]of Object.entries(p.cost))home[resource]+=amount;
      this.onEvent({source:'factions',action:`proposal_${p.status}`,actor:p.factionId,time:state.time,...(p.messageId ? {messageId:p.messageId} : {}),
        messageKey:`diplomacy.${p.status}`,messageParams:{kind:{messageKey:`diplomacy.${p.kind}`},faction:{factionId:p.factionId,nameKey:faction?.nameKey}, reason:{messageKey:accepted?'diplomacy.reason.accepted':'diplomacy.reason.conditions'}}});
    }
    if(state.time>=diplomacy.nextTrade) {
      diplomacy.nextTrade=state.time+60;
      if(home.food<home.population*3 && home.wood>=5) {
        const trader=state.factions.find(f=>f.stance!=='hostile'&&f.resources.food>=45);
        if(trader) {const result=proposeDiplomacy(this.world,'trade',trader.id);if(result.ok)this.onEvent({source:'world',action:'autonomous_trade',actor:'home',time:state.time,...result});}
      }
    }
    syncResourceTotals(state);
  }
}

export function respondCounteroffer(world,id,accept,onEvent=()=>{}) {
  const state=world.state, p=state.diplomacy?.proposals.find(p=>p.id===id), home=world.getVillage('home');
  if(p?.status!=='counteroffer')return fail('invalid');
  const faction=state.factions.find(f=>f.id===p.factionId);
  if(accept&&(state.time>=p.expiresAt||!faction||home.population<=0))return fail('target');
  if(accept&&!spendResources(home,p.extraCost))return fail('supplies');
  if(!accept&&Object.entries(p.cost).some(([id,n])=>home[id]+n>stockLimit(home,id)))return fail('supplies');
  p.status=accept?'accepted':'rejected';p.resolvedAt=state.time;
  if(accept){faction.stance='neutral';faction.treatyUntil=state.time+600;for(const cost of [p.cost,p.extraCost])for(const [id,n]of Object.entries(cost))faction.resources[id]=(faction.resources[id]??0)+n;}
  else for(const [id,n]of Object.entries(p.cost))home[id]+=n;
  syncResourceTotals(state);
  onEvent({source:'factions',action:`proposal_${p.status}`,actor:p.factionId,time:state.time,...(p.messageId?{messageId:p.messageId}:{}),messageKey:`diplomacy.${p.status}`,messageParams:{kind:{messageKey:`diplomacy.${p.kind}`},faction:{factionId:p.factionId,nameKey:faction?.nameKey},reason:{messageKey:accept?'diplomacy.reason.accepted':'diplomacy.reason.conditions'}}});
  return {ok:true};
}

export function applyBattleConsequences(world, plan, combat) {
  if(!world.state.diplomacy||plan.consequencesApplied)return;
  plan.consequencesApplied=true;
  const home=world.getVillage('home'), faction=world.state.factions.find(f=>f.id===plan.sourceFactionId);
  if(faction) {
    const dead=combat.units.filter(u=>u.side==='enemy'&&u.hp<=0).length;
    faction.strength=Math.max(5,faction.strength-dead*3);
    faction.resources.food=Math.max(0,faction.resources.food-6);
  }
  // Wounded representative soldiers consume medical supplies and reduce morale;
  // aggregate population loss remains the publicly announced upper bound.
  const wounded=combat.units.filter(u=>u.side==='home'&&!u.isHero&&u.hp<=0).length;
  home.herbs=Math.max(0,home.herbs-wounded);home.happiness=Math.max(0,home.happiness-wounded*2);
  if(combat.breachPressure>0) {
    const building=[...world.state.buildings.values()].find(b=>b.type==='house');
    if(building)building.damage=Math.min(100,(building.damage??0)+Math.min(40,combat.breachPressure*5));
  }
}
