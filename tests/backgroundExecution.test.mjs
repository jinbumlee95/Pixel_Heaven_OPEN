import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';

let divineReply;
let worldReply;
let worldCalls = 0;
const game = new Game(null, {
  interpret: () => new Promise(resolve => { divineReply = resolve; }),
  decideWorld: () => { worldCalls++; return new Promise(resolve => { worldReply = resolve; }); },
});
// The playable settlement starts small and stable; create explicit need here.
Object.assign(game.world.getVillage('home'), { population: 100, food: 20, farmCount: 0 });
let frames = 0;
globalThis.requestAnimationFrame = () => 1;
game.renderer.render = () => { frames++; };
game.renderer.destroy = () => {};
game.counters = { update() {} };
game.eventsView = { updateNeeds() {}, add() {} };
game.running = true;
game.previousTime = 0;
const message = game.sendDivineMessage('rain');
for (let frame = 1; frame <= 80; frame++) game.frame(frame * 250);
assert.equal(frames, 80);
assert.equal(game.world.state.time, 20);
assert.equal(worldCalls, 1);
assert.equal(game.divineHistory[0].outcome, 'pending');
assert.ok(game.worldDecisions.pending);
const beforeStop = structuredClone(game.world.state);
const decision = game.worldDecisions.pending;
game.stop();
divineReply({ status: 'understood', action: 'increase_food', target: 'home', parameters: {} });
worldReply({ actor: 'home', action: 'farm', target: 'home', reason: 'food_shortage', parameters: {} });
assert.equal((await message).code, 'delivery_failed');
await decision;
assert.deepEqual(game.world.state, beforeStop, 'late results cannot mutate a stopped world');
assert.equal((await game.sendDivineMessage('rain')).code, 'stopped');
delete globalThis.requestAnimationFrame;
console.log('backgroundExecution: passed');
