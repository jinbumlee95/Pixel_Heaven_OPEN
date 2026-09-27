import { faithRule } from '../content/religion.js';
import { spendResources } from '../state/economy.js';
export const DISASTERS=Object.freeze(['fire','flood','cold']);
export const DISASTER_COSTS=Object.freeze({fire:Object.freeze({wood:3,stone:4}),flood:Object.freeze({wood:4,stone:6}),cold:Object.freeze({wood:6,cloth:3,coal:2})});
export function prepareDisaster(world,kind,planId) {
  const plan=world.state.eventQueue.find(p=>DISASTERS.includes(p.kind)&&p.kind===kind&&['forecast','active'].includes(p.stage)&&(!planId||p.id===planId));
  if(!plan||plan.mitigation.protected)return {ok:false,code:'invalid_context',messageKey:'event.divine.failure.invalid_context',messageParams:{}};
  const home=world.getVillage('home');
  const cost=DISASTER_COSTS[kind];
  if(!spendResources(home,cost))return {ok:false,code:'insufficient_resources',messageKey:'event.world.failure.insufficient_resources',messageParams:{}};
  plan.mitigation.protected=true;
  return {ok:true,messageKey:'disaster.prepared',messageParams:{kind:{messageKey:`disaster.${kind}`},costs:{resourceBasket:cost}}};
}
export function hazardExposure(world, kind) {
  return [...world.state.buildings.values(),...world.state.terrain.values()]
    .filter(object=>['house','temple','farmland','forest','pine'].includes(object.type))
    .filter(object => kind !== 'flood' || Math.hypot(object.position.x - world.getVillage('home').anchor.x, object.position.y - world.getVillage('home').anchor.y) <= 12)
    .slice(0,24).map(object=>({id:object.id,position:{...object.position}}));
}
export function updateDisaster(world,plan) {
  const state=world.state, home=world.getVillage('home');
  if(plan.kind==='fire'&&home.weather==='rain'){plan.mitigation.protected=true;plan.extinguished=true;}
  if(plan.kind==='cold')home.weather='cold';
  if(state.time%10!==0||plan.lastDamageAt===state.time)return;
  plan.lastDamageAt=state.time;
  if(plan.kind==='cold'||plan.extinguished)return;
  const damage=plan.mitigation.protected?0:plan.severity*2*faithRule(state,'disasterDamage');
  if (plan.kind === 'fire') {
    plan.burningIds ??= [];
    if (!plan.mitigation.protected) {
      const remaining=(plan.exposure ?? []).filter(item=>!plan.burningIds.includes(item.id));
      const burning=(plan.exposure??[]).filter(item=>plan.burningIds.includes(item.id));
      const next = remaining.find(item => !burning.length || burning.some(source=>Math.hypot(item.position.x-source.position.x,item.position.y-source.position.y)<=8));
      if (next) plan.burningIds.push(next.id);
    }
  }
  // Only the bounded, previously announced exposure list can be damaged.
  for(const item of plan.exposure??[]) {
    const object=state.buildings.get(item.id)??state.terrain.get(item.id);
    if(!object)continue;
    if(plan.kind==='fire'&&!plan.burningIds.includes(item.id))continue;
    if(plan.kind==='flood'&&!['house','farmland'].includes(object.type))continue;
    object.damage=Math.min(100,(object.damage??0)+damage);
  }
}
