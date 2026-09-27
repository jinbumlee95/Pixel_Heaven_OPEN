import assert from 'node:assert/strict';
import { Renderer, APPEARANCE, CHARACTER_ANIMATIONS } from '../src/game/Renderer.js';
import { World, createInitialWorld } from '../src/game/World.js';

const point = () => ({ set(x, y) { this.x = x; this.y = y; } });
class Sprite { constructor(texture) { this.texture = texture; this.position = point(); } destroy() { this.destroyed = true; } }
class Graphics {
  clear() { return this; } beginFill() { return this; } drawRect() { return this; }
  endFill() { return this; } lineStyle() { return this; } drawCircle() { return this; }
}
globalThis.PIXI = { Sprite };
const world = createInitialWorld();
const renderer = new Renderer(null, world);
renderer.camera.resize(640, 480);
renderer.focusVillage('home');
renderer.stage = { position: point() };
renderer.objects = { addChild() {} };
let tiles = 0; let frames = 0; let lookups = 0;
renderer.tiles = { clear() { tiles = 0; }, tile() { tiles++; } };
renderer.atmosphere = new Graphics(); renderer.pulseLayer = new Graphics();
renderer.raindrops = Array.from({ length: 64 }, () => new Sprite());
renderer.app = { screen: { width: 640, height: 480 }, renderer: { render() { frames++; } } };
for (const type of Object.keys(APPEARANCE)) renderer.textures.set(type, type);
const state = structuredClone(world.state);
const get = world.state.occupied.get.bind(world.state.occupied);
world.state.occupied.get = key => { lookups++; return get(key); };
renderer.render(16);
assert.equal(tiles, renderer.visibleCellCount + world.state.groundTiles.size);
assert.ok(tiles <= 21 * 16 * 2, 'each visible cell has at most base grass and one ground override');
assert.ok(lookups <= 27 * 26, 'only the viewport plus bounded crown/art/movement margins is queried');
const house = [...world.state.buildings.values()].find(o => o.type === 'house' && renderer.sprites.has(o.id));
assert.ok(house);
assert.equal(renderer.sprites.get(house.id).width, 92, 'missing art retains readable building proportions');
renderer.loadedArt.add('house'); renderer.render(16);
assert.equal(renderer.sprites.get(house.id).width, 96);
const altar = world.state.buildings.get(world.state.sanctuary.altarId);
const worldtree = world.state.terrain.get(world.state.sanctuary.treeId);
assert.ok(renderer.sprites.has(altar.id));
assert.ok(renderer.sprites.has(worldtree.id));
renderer.loadedArt.add('world_tree'); renderer.loadedArt.add('altar'); renderer.render(16);
assert.equal(renderer.sprites.get(worldtree.id).width, 320);
assert.equal(renderer.sprites.get(worldtree.id).height, 352);
assert.equal(renderer.sprites.get(altar.id).width, 64);
assert.equal(renderer.sprites.get(altar.id).tint, 0xffffff);
delete world.state.occupied.get;
assert.deepEqual(world.state, state, 'visual animation never writes world state');
const priest = [...world.state.entities.values()].find(entity => entity.type === 'priest');
const directions = Object.fromEntries(['south', 'east', 'north', 'west'].map(direction => [direction,
  { idle: `${direction}-idle`, walk: Array.from({ length: 6 }, (_, i) => `${direction}-${i}`) }]));
renderer.animations.set('priest', { config: CHARACTER_ANIMATIONS.priest, directions });
renderer.render(16);
const priestSprite = renderer.sprites.get(priest.id);
assert.equal(priestSprite.width, 68);
assert.equal(priestSprite.height, 68);
assert.equal(priestSprite.texture, 'south-idle');
// Feed the rendering boundary a movement without relying on a timer or RNG.
assert.ok(world.moveEntity(priest, { x: priest.position.x + 1, y: priest.position.y }));
renderer.render(16);
assert.equal(priestSprite.texture, 'east-0');
renderer.render(125);
assert.equal(priestSprite.texture, 'east-1');
assert.ok(priestSprite.visualPosition.x < priest.position.x, 'The character traverses intermediate positions between logical updates');
renderer.render(250); renderer.render(100); renderer.render(16);
assert.equal(priestSprite.texture, 'east-idle', 'Walking stops exactly at arrival, independently of the animation clip duration');
assert.deepEqual(priestSprite.visualPosition, priest.position);
const standingPosition = { ...priestSprite.position };
renderer.render(200);
assert.deepEqual(priestSprite.position, standingPosition, 'Standing characters do not continue bobbing');
renderer.reducedMotion = true;
renderer.render(16);
assert.equal(priestSprite.texture, 'east-idle');
priest.activity = 'oracle'; priest.facing = 'north';
renderer.render(16);
assert.equal(priestSprite.texture, 'north-idle', 'ritual facing overrides the last walking direction at the altar');
delete priest.activity; delete priest.facing;
renderer.reducedMotion = false;
world.getVillage('home').weather = 'rain';
renderer.render(16);
assert.ok(renderer.raindrops.some(drop => drop.visible));
assert.equal(renderer.raindrops.length, 64);
renderer.reducedMotion = true; renderer.render(16);
assert.ok(renderer.raindrops.every(drop => !drop.visible));
for (let i = 0; i < 100; i++) renderer.showEvent({ action: 'increase_food', target: 'home' });
assert.equal(renderer.pulses.length, 12);
renderer.render(1600);
assert.equal(renderer.pulses.length, 0);
renderer.camera.center({ x: 0, y: 0 }); renderer.render(16);
assert.equal(renderer.sprites.size, 0, 'offscreen sprites are released');
assert.ok(frames > 1);

// A temple roof is visible even when its entire occupied footprint starts
// beyond the bottom of the viewport. The old fixed one-cell query missed it.
const edgeWorld = new World();
const roof = edgeWorld.placeBuilding('temple', 'home', { x: 1000, y: 985 });
assert.ok(roof);
const edgeRenderer = new Renderer(null, edgeWorld);
edgeRenderer.camera.resize(320, 128);
edgeRenderer.camera.x = 999; edgeRenderer.camera.y = 980;
edgeRenderer.stage = { position: point() };
edgeRenderer.objects = { addChild() {} };
edgeRenderer.tiles = { clear() {}, tile() {} };
edgeRenderer.atmosphere = new Graphics(); edgeRenderer.pulseLayer = new Graphics();
edgeRenderer.raindrops = [];
edgeRenderer.app = { screen: { width: 320, height: 128 }, renderer: { render() {} } };
edgeRenderer.textures.set('temple', 'temple'); edgeRenderer.loadedArt.add('temple');
let edgeLookups = 0;
const edgeGet = edgeWorld.state.occupied.get.bind(edgeWorld.state.occupied);
edgeWorld.state.occupied.get = key => { edgeLookups++; return edgeGet(key); };
edgeRenderer.render(16);
assert.ok(roof.position.y >= edgeRenderer.camera.bounds.bottom, 'all occupied cells are below the viewport');
const roofSprite = edgeRenderer.sprites.get(roof.id);
assert.ok(roofSprite, 'visible roof must not vanish before its ground footprint enters the camera');
assert.equal(roofSprite.width, 192);
assert.equal(roofSprite.tint, 0xffffff, 'The dedicated temple art retains its delivered palette');
assert.equal(roofSprite.position.y, 96, 'roof overlaps the last 32 pixels of the 128px viewport');
assert.ok(edgeLookups <= 16 * 14, 'large art still queries only a bounded neighborhood');
edgeRenderer.camera.pan(0, -20); edgeRenderer.render(16);
assert.equal(edgeRenderer.sprites.size, 0);

// The Worldtree crown reaches seven cells above its foundation. It remains
// visible when every occupied cell is several rows below the viewport.
const crownWorld = new World();
const crown = crownWorld.placeTerrain('world_tree', 'home', { x: 1000, y: 1000 });
const crownRenderer = new Renderer(null, crownWorld);
crownRenderer.camera.resize(320, 128);
crownRenderer.camera.x = 999; crownRenderer.camera.y = 991;
crownRenderer.stage = edgeRenderer.stage; crownRenderer.objects = edgeRenderer.objects;
crownRenderer.tiles = edgeRenderer.tiles; crownRenderer.atmosphere = edgeRenderer.atmosphere;
crownRenderer.pulseLayer = edgeRenderer.pulseLayer; crownRenderer.raindrops = [];
crownRenderer.app = edgeRenderer.app;
crownRenderer.textures.set('world_tree', 'world_tree'); crownRenderer.loadedArt.add('world_tree');
let crownLookups = 0;
const crownGet = crownWorld.state.occupied.get.bind(crownWorld.state.occupied);
crownWorld.state.occupied.get = key => { crownLookups++; return crownGet(key); };
crownRenderer.render(16);
assert.ok(crown.position.y > crownRenderer.camera.bounds.bottom);
assert.ok(crownRenderer.sprites.has(crown.id), 'a giant crown cannot disappear while still overlapping the camera');
assert.equal(crownRenderer.sprites.get(crown.id).position.y, 64);
assert.equal(crownRenderer.sprites.get(crown.id).width, 320);
assert.ok(crownLookups <= 16 * 14, 'crown rendering never iterates the 2000x2000 map');

// Rendering consults the world's catalog, not the built-in appearance aliases.
const customDefinition = { id: 'custom_tree', kind: 'terrain', footprint: { w: 1, h: 1 },
  visual: { width: 96, height: 96, anchorX: 0.5, anchorY: 1, ground: false, color: 0x446633, path: null } };
const customObject = { id: 'custom_1', type: customDefinition.id, footprint: customDefinition.footprint,
  position: { x: 1000, y: 980 } };
const customWorld = { content: { get: id => id === customDefinition.id ? customDefinition : undefined,
  list: () => [customDefinition] }, state: { occupied: new Map([['1000,980', customObject]]), villages: [] } };
const customRenderer = new Renderer(null, customWorld);
customRenderer.camera.resize(320, 128);
customRenderer.camera.center(customObject.position);
customRenderer.stage = edgeRenderer.stage; customRenderer.objects = edgeRenderer.objects;
customRenderer.tiles = edgeRenderer.tiles; customRenderer.atmosphere = edgeRenderer.atmosphere;
customRenderer.pulseLayer = edgeRenderer.pulseLayer; customRenderer.raindrops = [];
customRenderer.app = edgeRenderer.app; customRenderer.textures.set(customDefinition.id, 'custom_tree');
const customState = structuredClone(customWorld.state);
customRenderer.render(16);
assert.equal(customRenderer.sprites.get(customObject.id).width, 92);
assert.equal(customRenderer.sprites.get(customObject.id).zIndex, 981);
assert.deepEqual(customWorld.state, customState);
delete globalThis.PIXI;
console.log('renderer: passed');
