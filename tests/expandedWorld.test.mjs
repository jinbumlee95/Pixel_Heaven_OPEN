import { stepWorld } from '../src/game/WorldStep.js';
import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { tick } from '../src/game/Simulation.js';
import { decodeWorld } from '../src/state/Persistence.js';
import { setStoryProfile } from '../src/game/Story.js';
import { RESOURCE_TYPES } from '../src/state/economy.js';
import { queueConstruction } from '../src/game/Work.js';
import { executeDivineAction } from '../src/actions/divineActions.js';

async function advance(game,seconds,managed=false) {
  for(let i=0;i<seconds;i++) {
    if(managed){
      const h=game.world.getVillage('home');
      h.labor={farming:Math.min(h.population,Math.ceil(h.population*.6)),woodcutting:1,mining:1,crafting:0,building:1,defense:0,husbandry:0};
      let budget=h.population;for(const role of Object.keys(h.labor)){h.labor[role]=Math.min(budget,h.labor[role]);budget-=h.labor[role];}
      for(const o of [...game.world.state.terrain.values(),...game.world.state.buildings.values()])if(o.damage>10)queueConstruction(game.world,{action:'repair'},{repairId:o.id});
      for(const plan of game.world.state.eventQueue)if(plan.stage==='forecast'){
        const action={raid:'prepare_defense',drought:'create_rain',fire:'prepare_fire',flood:'prepare_flood',cold:'prepare_cold'}[plan.kind];
        if(action&&!plan.mitigation.defense&&!plan.mitigation.rain&&!plan.mitigation.protected)executeDivineAction(game.world,{status:'understood',action,target:'home',parameters:action==='create_rain'?{strength:1}:{}},{planId:plan.id});
      }
    }
    await stepWorld(game,1000);
    const s=game.world.state,h=game.world.getVillage('home');
    for(const id of RESOURCE_TYPES)assert.ok(Number.isFinite(h[id])&&h[id]>=0&&h[id]<=1000,`${id}: ${h[id]} at ${s.time}`);
    assert.ok(Object.values(h.labor).reduce((a,b)=>a+b,0)<=h.population);
    assert.ok(s.eventQueue.length<=4);assert.ok(s.entities.size<=10);assert.equal(s.villages.length,1);
  }
}
for(const profile of ['steady','changing','gentle']) {
  const game=new Game(null,{seed:77});setStoryProfile(game.world,profile);
  await advance(game,1500);
  const restored=new Game(null,{restored:decodeWorld(game.snapshot())});
  await advance(game,500);await advance(restored,500);
  assert.deepEqual(restored.world.state,game.world.state,`${profile}: save continuation matches without resampling`);
  await advance(game,8000);
  console.log(JSON.stringify({profile,time:game.world.state.time,population:game.world.getVillage('home').population,food:Math.round(game.world.getVillage('home').food),memories:game.world.state.story.memories.length}));
  game.stop();restored.stop();
}
const managed=new Game(null,{seed:77});
await advance(managed,10000,true);
assert.ok(managed.world.getVillage('home').population>=8,'labor and forecast preparation sustain the settlement');
console.log(JSON.stringify({managed:true,time:10000,population:managed.world.getVillage('home').population,food:Math.round(managed.world.getVillage('home').food)}));managed.stop();
const civic=new Game(null);civic.world.state.faith.points=100;civic.world.getVillage('home').food=100;civic.world.getVillage('home').crafts=2;
assert.equal((await civic.sendDivineMessage('믿음을 가져라')).event.action,'celebrated');
assert.ok(civic.world.getVillage('home').devotionUntil>0);
assert.equal((await civic.sendDivineMessage('평화롭게 함께 살자')).event.action,'propose_alliance');
assert.equal(civic.world.state.diplomacy.proposals[0].status,'pending');
civic.stop();
console.log('expandedWorld: passed');
