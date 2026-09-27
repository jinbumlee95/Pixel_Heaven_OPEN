import { syncResourceTotals } from '../state/worldState.js';
import { spendFaith } from './Faith.js';
import { spendResources } from '../state/economy.js';

export const ROUTES = ['normal','elite','spring','mystery'];
export function initializeDungeon(hero) {
  hero.dungeon ??= {version:1,light:100,policy:'safe',route:null,eliteWins:0,bossWins:0};
}
export function prepareDungeonRoute(hero) {
  initializeDungeon(hero);
  const alternative=['elite','spring','mystery'][(hero.cycleId-1)%3];
  const preferred={safe:'spring',treasure:'mystery',hunt:'elite'}[hero.dungeon.policy];
  hero.dungeon.route={mission:hero.missionId,cycle:hero.cycleId,options:['normal',alternative],
    choice:alternative===preferred?alternative:'normal',committed:false};
}
export function dungeonRoom(hero) {
  if(!hero.dungeon)return 'normal';
  return hero.room===2?hero.dungeon.route?.choice??'normal':hero.room===3&&hero.depth>=3?'boss':'normal';
}
// Pure preview: the committed encounter snapshots these values before animation.
export function dungeonEncounter(hero,monster,stats,variation) {
  const kind=dungeonRoom(hero),depth=hero.depth,tier=depth-1;
  const dark=hero.dungeon?(100-hero.dungeon.light)/100:0;
  const elite=kind==='elite',boss=kind==='boss';
  const multiplier=boss?2+depth*.65:elite?1.5+depth*.35:1;
  const enemyMaxHp=Math.ceil((monster.hp+tier*4+variation)*multiplier);
  const attack=monster.damage+tier+(boss?depth*2:elite?depth:0)+Math.ceil(dark*depth*2);
  const damage=Math.max(1,attack-stats.armor)*Math.max(0,Math.ceil(enemyMaxHp/(stats.damage*2/stats.cooldown))-1);
  return {kind,enemyMaxHp,damage,light:hero.dungeon?.light??100};
}
export function dungeonOrder(world,order) {
  const h=world.state.hero,d=h?.dungeon;
  const fail=code=>({ok:false,messageKey:'dungeon.'+code,messageParams:{}});
  if(!d)return fail('unavailable');
  if(order.operation==='policy') {
    if(!['safe','treasure','hunt'].includes(order.value))return fail('invalid');
    d.policy=order.value;
  } else if(order.operation==='route') {
    if(!['outbound','exploring','victory'].includes(h.mode)||h.recallRequested||!d.route||d.route.committed||h.room>2||h.mode==='returning'||!d.route.options.includes(order.value))return fail('routeClosed');
    d.route.choice=order.value;
  } else if(order.operation==='light') {
    if(!['outbound','exploring','victory','camp','field_recovery','supply_wait','resupplying','shipping','cargo_wait'].includes(h.mode)||h.recallRequested)return fail('unavailable');
    if(d.light>=100)return fail('full');
    if(order.value==='faith') {if(!spendFaith(world.state,12))return fail('cost');}
    else if(order.value==='coal') {if(!spendResources(world.getVillage('home'),{coal:2}))return fail('cost');}
    else return fail('invalid');
    d.light=Math.min(100,d.light+40);
    syncResourceTotals(world.state);
  } else return fail('invalid');
  return {ok:true,messageKey:'dungeon.ordered',messageParams:{},event:{source:'divine',action:'dungeon_order',actor:'home',time:world.state.time,messageKey:'dungeon.ordered',messageParams:{}}};
}
export function validDungeon(d) {
  const n=v=>Number.isSafeInteger(v)&&v>=0;
  return d===undefined||Boolean(d&&d.version===1&&n(d.light)&&d.light<=100&&['safe','treasure','hunt'].includes(d.policy)&&n(d.eliteWins)&&n(d.bossWins)
    &&(d.route===null||d.route&&n(d.route.mission)&&n(d.route.cycle)&&d.route.cycle>=1&&Array.isArray(d.route.options)&&d.route.options.length===2
      &&d.route.options[0]==='normal'&&ROUTES.slice(1).includes(d.route.options[1])&&d.route.options.includes(d.route.choice)&&typeof d.route.committed==='boolean'));
}
