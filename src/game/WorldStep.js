import { tick, TICK_INTERVAL_MS } from './Simulation.js';
import { updateWander } from './Wander.js';

// Browser and headless runs cross this same interface. Rendering is not simulation.
// Split time at both motion and tick boundaries so frame partitioning cannot reorder work.
export function stepWorld(game,elapsedMs) {
  if(!Number.isFinite(elapsedMs)||elapsedMs<0||elapsedMs>60000)throw new RangeError('Invalid world step');
  const pending=[];game.accumulator??=0;
  for(let remaining=elapsedMs;remaining>0;) {
    const slice=Math.min(250,remaining,TICK_INTERVAL_MS-game.accumulator);
    if(game.ritualEnabled)game.ritual.update(slice);
    game.hero.update(slice);
    updateWander(game.world,slice,game.motionRandom);
    game.accumulator+=slice;remaining-=slice;
    if(game.accumulator>=TICK_INTERVAL_MS) {
      tick(game.world.state);
      for(const id of ['work','factions','diplomacy','life','forecasts','emergence'])game[id]?.update();
      const request=game.worldDecisions.update();if(request)pending.push(request);
      game.accumulator-=TICK_INTERVAL_MS;
    }
  }
  return Promise.allSettled(pending);
}
