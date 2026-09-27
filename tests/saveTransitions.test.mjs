import assert from 'node:assert/strict';
import {Game} from '../src/game/Game.js';
import {decodeWorld} from '../src/state/Persistence.js';
import {executeHeroOrder} from '../src/game/Hero.js';
import {tick} from '../src/game/Simulation.js';
const game=new Game(null,{ritual:true});
const pending=game.sendDivineMessage('식량 10을 주어라');
await Promise.resolve();await Promise.resolve();
const save=game.snapshot(),h=game.world.getVillage('home');
assert.equal(h.food,30,'walking oracle has not applied');
game.stop();await pending;
const restored=new Game(null,{restored:decodeWorld(save),ritual:true});
const entry=restored.divineHistory.find(e=>e.outcome==='pending');assert.ok(entry);
const response=restored.sendDivineMessage(entry.message,entry.selectedTarget,{resumeEntry:entry});
for(let n=0;n<120;n++){restored.ritual.update(250);await Promise.resolve();}
assert.equal((await response).ok,true);assert.equal(restored.world.getVillage('home').food,40);
assert.equal(restored.divineHistory.length,1);assert.equal(restored.world.state.faith.points,26);
const loadedAgain=new Game(null,{restored:decodeWorld(restored.snapshot())});assert.equal(loadedAgain.divineHistory[0].outcome,'applied');
restored.stop();loadedAgain.stop();

const hero=new Game(null);assert.equal(executeHeroOrder(hero.world,{action:'hero_dispatch',target:'home',parameters:{}}).ok,true);
for(let n=0;n<35;n++)hero.hero.update(250);
const expedition=new Game(null,{restored:decodeWorld(hero.snapshot())});
for(let n=0;n<250;n++){hero.hero.update(250);expedition.hero.update(250);}
assert.deepEqual(expedition.world.state,hero.world.state,'mid-attack reward and return restore exactly');hero.stop();expedition.stop();

const battle=new Game(null,{random:()=>0});const plan=battle.world.state.eventQueue[0];
plan.startAt=1;plan.endAt=46;battle.world.state.time=1;battle.forecasts.start(plan,battle.world.getVillage('home'));
for(let n=0;n<8;n++){tick(battle.world.state);battle.battle.update();}
const fighting=new Game(null,{restored:decodeWorld(battle.snapshot()),random:()=>0});
for(let n=0;n<40;n++){for(const g of [battle,fighting]){tick(g.world.state);g.battle.update();}}
assert.deepEqual(fighting.world.state,battle.world.state,'combat positions/cooldowns/damage continue once');battle.stop();fighting.stop();
console.log('saveTransitions: passed');
