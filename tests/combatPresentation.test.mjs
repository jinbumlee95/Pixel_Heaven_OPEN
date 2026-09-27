import assert from 'node:assert/strict';
import { Renderer } from '../src/game/Renderer.js';
import { createInitialWorld } from '../src/game/World.js';
import { BattleSystem, prepareBattle } from '../src/game/Combat.js';
import { EventForecast } from '../src/game/EventForecast.js';
import { Factions } from '../src/game/Factions.js';

class Graphics {
  constructor() { this.commands = 0; this.position = { set: (x, y) => { this.x = x; this.y = y; } }; }
  clear() { this.commands = 0; return this; }
  destroy() { this.destroyed = true; }
}
for (const method of ['beginFill', 'endFill', 'lineStyle', 'drawRect', 'drawRoundedRect',
  'drawCircle', 'drawEllipse', 'drawPolygon', 'moveTo', 'lineTo']) {
  Graphics.prototype[method] = function () { this.commands++; return this; };
}
globalThis.PIXI = { Graphics };
const world = createInitialWorld();
new Factions(world, { seed: 42 });
const renderer = new Renderer(null, world);
renderer.camera.resize(640, 480); renderer.focusVillage('home');
renderer.objects = { addChild() {} };
renderer.combatEffects = new Graphics();
renderer.app = { screen: { width: 640, height: 480 } };
const battle = new BattleSystem(world, { onCamera: event => renderer.announceRaid(event) });
const forecasts = new EventForecast(world, { random: () => 0, battle });
const plan = world.state.eventQueue[0];
assert.equal(prepareBattle(world, plan).ok, true);
renderer.focusBattle();
let snapshot = structuredClone(world.state);
renderer.renderCombat(renderer.camera.bounds.left, renderer.camera.bounds.top, 16);
assert.equal(renderer.combatSprites.size, 7, 'four distinct combatants and three works have display objects');
assert.deepEqual(world.state, snapshot, 'drawing and interpolation cannot mutate simulation state');
world.state.time = plan.startAt;
forecasts.update();
assert.ok(renderer.cameraTour.current, 'real forecast arrival starts the camera tour');
for (let frame = 0; frame < 40; frame++) renderer.cameraTour.update(100, renderer.camera);
const homeCamera = { x: renderer.camera.x, y: renderer.camera.y };
renderer.focusVillage('home');
assert.deepEqual({ x: renderer.camera.x, y: renderer.camera.y }, homeCamera, 'automatic tour returns to settlement');
renderer.focusBattle();
for (let time = plan.startAt + 1; time <= plan.startAt + 20; time++) { world.state.time = time; forecasts.update(); }
snapshot = structuredClone(world.state);
renderer.renderCombat(renderer.camera.bounds.left, renderer.camera.bounds.top, 16);
assert.ok(renderer.combatSprites.size <= 24);
assert.deepEqual(world.state, snapshot);
const at = world.state.combat.front;
world.state.combat.effects = [{ type: 'spell', from: at, to: at, createdAt: world.state.time - 2, expiresAt: world.state.time }];
world.state.combat.stage = 'resolved';
renderer.renderCombat(renderer.camera.bounds.left, renderer.camera.bounds.top, 16);
assert.equal(renderer.combatEffects.commands, 0, 'last combat effect expires even after battle resolution');
renderer.camera.center({ x: 0, y: 0 });
renderer.renderCombat(0, 0, 16);
assert.equal(renderer.combatSprites.size, 0, 'encounter objects are culled and released outside the viewport');
renderer.reducedMotion = true;
renderer.announceRaid({ id: 'another-arrival', position: at });
assert.equal(renderer.cameraTour.current, null, 'reduced motion disables automatic camera travel');
console.log('combatPresentation: passed');
