import { equipmentOrder } from '../src/game/Equipment.js';
import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { executeHeroOrder, enlistHero } from '../src/game/Hero.js';
import { orderExpedition, bagSize, AWAY_MODES } from '../src/game/Expedition.js';
import { decodeWorld } from '../src/state/Persistence.js';
import { parseChatCommand, executeChatOrder } from '../src/game/ChatCommands.js';

const action=action=>({action,target:'home',parameters:{}});
function setup(){const g=new Game(null);Object.assign(g.world.getVillage('home'),{food:1000,herbs:300,coal:300,silver:300});assert.ok(executeHeroOrder(g.world,action('hero_dispatch')).ok);return g;}
function until(g,predicate){for(let n=0;n<2000&&!predicate();n++)g.hero.update(250);assert.ok(predicate(),`Expected state; got ${g.world.state.hero.mode}`);}
let g=setup();
const faith=g.world.state.faith.points;
const seen=new Set();
for(let cycle=1;cycle<=100;cycle++){
  // Explicit player disposal maintains finite storage during this 100-cycle test.
  for(const item of [...g.world.state.hero.equipment.items])if(item.location==='store')assert.ok(equipmentOrder(g.world,{operation:'salvage',id:item.id}).ok);
  until(g,()=>g.world.state.hero.cycleId===cycle);
  for(let n=0;n<2000&&g.world.state.hero.dungeonsCleared<cycle;n++){
    const h=g.world.state.hero;seen.add(h.mode);
    // Save immediately before every settlement; a second restored execution
    // must produce exactly the same state, including cargo and resources.
    if(h.mode==='fighting'&&h.scene.elapsedMs+250>=h.scene.durationMs){
      const restored=new Game(null,{restored:decodeWorld(g.snapshot())});
      restored.hero.update(250);g.hero.update(250);
      assert.deepEqual(restored.world.state,g.world.state);g.stop();g=restored;
      const paid=g.world.state.hero.totalXp;g.hero.finishEncounter();assert.equal(g.world.state.hero.totalXp,paid);
    }else g.hero.update(250);
  }
  assert.equal(g.world.state.hero.dungeonsCleared,cycle);
  assert.equal(g.world.state.hero.totalXp,cycle*68-Math.floor((cycle+1)/3)*14,'Spring rooms replace combat without granting combat XP');
  assert.ok(bagSize(g.world.state.hero)<=24);
  assert.ok(g.world.state.hero.settledIds.length<=8);
  assert.ok(g.world.state.recent_events.length<=50);
  assert.equal(g.world.state.faith.points,faith,'No recurring faith charge');
  assert.equal(enlistHero(g.world,{}),false);
}
assert.ok(seen.has('fighting'));
assert.ok(executeHeroOrder(g.world,action('hero_recall')).ok);
until(g,()=>g.world.state.hero.mode==='home');
assert.equal(bagSize(g.world.state.hero),0);
assert.equal(g.world.state.hero.shipmentCount,66);
g.stop();

// Every away state has a reachable recall path; waiting is not a soft lock.
for(const mode of AWAY_MODES.filter(m=>m!=='returning')){
  g=setup();const h=g.world.state.hero,home=g.world.getVillage('home');
  if(mode==='supply_wait')home.food=0;
  if(mode==='cargo_wait')home.silver=0;
  if(mode==='field_recovery'){until(g,()=>h.mode==='fighting');h.hp=1;g.hero.beginEncounter();}
  until(g,()=>h.mode===mode);
  const restored=new Game(null,{restored:decodeWorld(g.snapshot())});g.stop();g=restored;
  const before=g.world.state.hero.totalXp;
  assert.equal(executeHeroOrder(g.world,action('hero_recall')).ok,true,mode);
  assert.equal(executeHeroOrder(g.world,action('hero_recall')).ok,false,mode);
  until(g,()=>g.world.state.hero.mode==='home');
  assert.ok(g.world.state.hero.totalXp<=before+68,mode);
  assert.equal(g.world.state.entities.get(g.world.state.hero.entityId).hidden,false);
  g.stop();
}

g=setup();let h=g.world.state.hero,home=g.world.getVillage('home');home.food=0;
until(g,()=>h.mode==='supply_wait');const costBefore=home.silver;
assert.equal(orderExpedition(g.world,{operation:'supply'}).ok,false);
assert.equal(home.silver,costBefore);
home.food=20;assert.equal(orderExpedition(g.world,{operation:'supply'}).ok,true);
assert.equal(home.food,14);assert.equal(home.silver,costBefore-1);
assert.equal(orderExpedition(g.world,{operation:'supply'}).ok,false);
assert.equal(orderExpedition(g.world,{operation:'deeper',missionId:0}).ok,false);
assert.ok(orderExpedition(g.world,{operation:'deeper'}).ok);assert.equal(h.depth,1);assert.equal(h.nextDepth,2);
until(g,()=>h.cycleId===2);assert.equal(h.depth,2);
until(g,()=>h.mode==='fighting');assert.equal(h.encounter.xp,16);
g.stop();

g=setup();h=g.world.state.hero;home=g.world.getVillage('home');home.stone=1000;
until(g,()=>h.mode==='cargo_wait'&&h.waitReason==='storage');
assert.equal(h.bag.stone,2);const shipments=h.shipmentCount;
for(let n=0;n<100;n++)g.hero.update(250);assert.equal(h.shipmentCount,shipments,'Full storage cannot repeatedly charge shipments');
home.stone=990;g.hero.update(250);assert.equal(home.stone,992);assert.equal(h.bag.stone,undefined);
g.stop();

for(const text of ['더 깊이 가','go deeper','もっと深くへ'])assert.equal(parseChatCommand(text).operation,'deeper');
for(const text of ['영웅 보급 보내','resupply hero','勇者に補給'])assert.equal(parseChatCommand(text).operation,'supply');
g=setup();const bad=JSON.parse(g.snapshot());bad.state.hero.bag={gold:25};assert.throws(()=>decodeWorld(JSON.stringify(bad)),/invalid_expedition/);
const paused=structuredClone(g.world.state.hero);g.hero.update(0);assert.deepEqual(g.world.state.hero,paused);
const legacy=JSON.parse(g.snapshot());for(const key of ['expeditionVersion','bag','missionId','cycleId','settledIds'])delete legacy.state.hero[key];
const migrated=new Game(null,{restored:decodeWorld(JSON.stringify(legacy))});assert.deepEqual(migrated.world.state.hero.bag,{});assert.equal(migrated.world.state.hero.missionId,1);
g.stop();migrated.stop();
console.log('expedition: passed (100 saved cycles, every recall state, shipment conservation, supply/depth, bounded history)');
