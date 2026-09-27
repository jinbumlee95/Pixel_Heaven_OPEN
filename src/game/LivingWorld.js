import { syncResourceTotals } from '../state/worldState.js';
import { spendResources, stockLimit } from '../state/economy.js';
import { initializeVisit, updateTrade } from './Trading.js';

const fail = code => ({ ok:false, code, messageKey:`life.failure.${code}`,messageParams:{} });
export const GOODS = Object.freeze({ food:{quantity:10,price:2}, herbs:{quantity:2,price:1}, cloth:{quantity:2,price:1}, sheep:{quantity:1,price:3} });
export function tradeWithCaravan(world, resource) {
  const life=world.state.life, visit=life?.caravan, good=GOODS[resource], home=world.getVillage('home');
  if(!good||visit?.stage!=='visiting'||world.state.time>=visit.departAt)return fail('unavailable');
  initializeVisit(world,visit);
  if((visit.stock[resource]??0)<good.quantity)return fail('stock');
  if(resource==='sheep'&&life.sheep+good.quantity>6)return fail('capacity');
  if(resource!=='sheep'&&home[resource]+good.quantity>stockLimit(home,resource))return fail('capacity');
  if(!spendResources(home,{silver:good.price}))return fail('money');
  visit.stock[resource]-=good.quantity;visit.earned+=good.price;
  visit.cash+=good.price;visit.revision++;
  if(!visit.policy.directed.includes(resource))visit.policy.directed.push(resource);
  if(resource==='sheep')life.sheep+=good.quantity;else home[resource]+=good.quantity;
  syncResourceTotals(world.state);return {ok:true};
}
export function hunt(world) {
  const home=world.getVillage('home'), life=world.state.life;
  if(!life||life.deer<=0||home.labor.husbandry<1||life.huntUntil>world.state.time)return fail('hunt');
  if(!spendResources(home,{wood:1}))return fail('supplies');
  life.deer--;life.huntUntil=world.state.time+60;home.food=Math.min(stockLimit(home,'food'),home.food+8);syncResourceTotals(world.state);return {ok:true};
}
export function protectHerd(world) {
  const home=world.getVillage('home'), wolf=world.state.life?.wolves;
  if(!wolf||wolf.stage!=='forecast'||wolf.protected)return fail('unavailable');
  if(home.labor.defense<1)return fail('defense');
  if(!spendResources(home,{wood:3,iron:1}))return fail('supplies');wolf.protected=true;syncResourceTotals(world.state);return {ok:true};
}
export class LivingWorld {
  constructor(world,{onEvent=()=>{}}={}) {
    this.world=world;this.onEvent=onEvent;
    // One-time market endowment only for factions without a silver field.
    // Persisted balances, including zero, are never replenished on visits.
    for(const faction of world.state.factions??[]){faction.resources.silver??=12;faction.equipmentStock??=3;}
    world.state.life??={lastTick:world.state.time,sequence:0,sheep:0,deer:3,hunger:0,huntUntil:0,nextFeed:world.state.time+120,
      nextVisit:world.state.time+240,nextWolves:world.state.time+480,caravan:null,wolves:null,representatives:{}};
  }
  record(kind, params={}) {this.onEvent({source:'world',action:`life_${kind}`,time:this.world.state.time,actor:'home',messageKey:`life.${kind}`,messageParams:params});}
  representative(type,show) {
    const state=this.world.state, ids=state.life.representatives;
    const entity=state.entities.get(ids[type]);
    if(show&&!entity) {const added=this.world.spawnEntity(type,'home');if(added)ids[type]=added.id;}
    if(!show&&entity) {if(state.occupied.get(`${entity.position.x},${entity.position.y}`)===entity)state.occupied.delete(`${entity.position.x},${entity.position.y}`);state.entities.delete(entity.id);delete ids[type];}
  }
  update() {
    const state=this.world.state, life=state.life, home=this.world.getVillage('home');
    if(life.lastTick>=state.time)return;life.lastTick=state.time;
    if(home.population<=0)return;
    if(!life.caravan&&state.time>=life.nextVisit) {
      const source=state.factions.find(f=>f.stance!=='hostile'&&f.resources.food>=60);
      if(source){
        // Reserve cargo from its source; return unsold cargo exactly once.
        source.resources.herbs ??= 12;source.resources.cloth ??= 12;source.resources.sheep ??= 6;source.resources.silver ??= 0;
        for(const id of ['tools','planks','medicine','rations','crafts'])source.resources[id]??=12;
        source.resources.iron_ore ??= 24;source.resources.fiber ??= 24;
        source.resources.iron ??= 8;source.resources.copper ??= 8;source.resources.stone ??= 20;source.resources.coal ??= 12;
        const stock=Object.fromEntries(Object.entries({food:40,herbs:6,cloth:6,sheep:3,wood:20,iron:8,copper:8,stone:20,coal:12,iron_ore:12,fiber:12,tools:4,planks:8,medicine:4,rations:6,crafts:4}).map(([id,max])=>[id,Math.min(max,source.resources[id])]));
        for(const id of home.modResources??[]){source.resources[id]??=12;stock[id]=Math.min(6,source.resources[id]);}
        for(const [id,n]of Object.entries(stock))source.resources[id]-=n;
        life.caravan={id:`caravan-${++life.sequence}`,source:source.id,stage:'forecast',arriveAt:state.time+120,departAt:state.time+240,
        stock,earned:0};this.record('caravan_forecast',{time:{gameTime:life.caravan.arriveAt}});}
      else life.nextVisit=state.time+120;
    }
    const visit=life.caravan;
    if(visit?.stage==='forecast'&&state.time>=visit.arriveAt) {
      const guarded=home.labor.defense>0&&(state.combat?.preparationKinds?.length??0)>0;
      const safe=(!['approaching','fighting'].includes(state.combat?.stage)||guarded)&&state.factions.find(f=>f.id===visit.source)?.stance!=='hostile';
      visit.stage=safe?'visiting':'departed';this.record(safe?'caravan_arrived':'caravan_unsafe');
      if(safe)initializeVisit(this.world,visit);
    }
    if(visit&&(state.time>=visit.departAt||visit.stage==='departed')) {
      const source=state.factions.find(f=>f.id===visit.source);
      if(source){source.equipmentStock=(source.equipmentStock??0)+(visit.equipmentStock??0);for(const [id,n]of Object.entries(visit.stock))source.resources[id]=(source.resources[id]??0)+n;source.resources.silver=(source.resources.silver??0)+(visit.tradeVersion===1?visit.cash:visit.earned);}
      life.lastTrade={...structuredClone(visit),closedAt:state.time};
      life.caravan=null;life.nextVisit=state.time+360;this.record('caravan_left');
    }
    const revision=life.caravan?.revision;
    updateTrade(this.world);
    if(life.caravan?.revision!==revision&&life.caravan?.ledger?.length){const last=life.caravan.ledger.at(-1);this.onEvent({source:'world',action:'merchant_trade',actor:'home',time:state.time,messageKey:'trade.done',messageParams:{silver:last.silver}});}
    if(state.time>=life.nextFeed) {
      life.nextFeed=state.time+120;life.deer=Math.min(6,life.deer+1);
      if(life.sheep>0){
        const fed=home.labor.husbandry>0&&spendResources(home,{food:life.sheep*(home.weather==='cold'?1:0.5)});
        if(fed){life.hunger=0;const output=home.productionVersion===1?'fiber':'cloth';home[output]=Math.min(stockLimit(home,output),home[output]+Math.min(life.sheep,home.labor.husbandry*2));}
        else {life.hunger++;this.record('hungry');if(life.hunger>=2){life.sheep=Math.max(0,life.sheep-1);life.hunger=0;this.record('starved');}}
      }
    }
    if(!life.wolves&&life.sheep>0&&state.time>=life.nextWolves) {life.wolves={stage:'forecast',startAt:state.time+120,endAt:state.time+150,protected:false};this.record('wolves_forecast',{time:{gameTime:life.wolves.startAt}});}
    if(life.wolves?.stage==='forecast'&&state.time>=life.wolves.startAt){life.wolves.stage='active';this.record('wolves_arrived');}
    if(life.wolves?.stage==='active'&&state.time>=life.wolves.endAt){const loss=life.wolves.protected?0:Math.min(1,life.sheep);life.sheep-=loss;this.record('wolves_resolved',{loss});life.wolves=null;life.nextWolves=state.time+480;}
    this.representative('merchant',life.caravan?.stage==='visiting');this.representative('pack_donkey',life.caravan?.stage==='visiting');
    this.representative('deer',life.deer>0);this.representative('sheep',life.sheep>0);this.representative('wolf',life.wolves?.stage==='active');
    syncResourceTotals(state);
  }
}
