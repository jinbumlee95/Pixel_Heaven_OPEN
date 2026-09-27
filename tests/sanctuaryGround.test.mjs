import assert from 'node:assert/strict';
import { Renderer, APPEARANCE } from '../src/game/Renderer.js';
import { cellKey, createInitialWorld } from '../src/game/World.js';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE } from '../src/state/worldState.js';

const point = () => ({ set() {} });
class Sprite { constructor(texture) { this.texture = texture; this.position = point(); } destroy() {} }

// Ground can be changed beneath an existing object without replacing its occupant.
const placementWorld = createInitialWorld();
const home = placementWorld.getVillage('home');
const house = [...placementWorld.state.buildings.values()].find(object => object.type === 'house');
const occupiedBefore = new Map(placementWorld.state.occupied);
const revisionBefore = placementWorld.state.groundRevision;
assert.ok(placementWorld.setGround('stone_paving', home.id, house.position));
assert.equal(placementWorld.state.groundTiles.get(cellKey(house.position.x, house.position.y)).type, 'stone_paving');
assert.equal(placementWorld.state.occupied.get(cellKey(house.position.x, house.position.y)), house);
assert.deepEqual(placementWorld.state.occupied, occupiedBefore, 'laying floor cannot replace collision occupants');
assert.equal(placementWorld.state.groundRevision, revisionBefore + 1);
assert.ok(placementWorld.setGround('stone_paving', home.id, house.position));
assert.equal(placementWorld.state.groundRevision, revisionBefore + 1, 'unchanged floor does not invalidate the camera cache');

for (const [type, villageId, position] of [
  ['house', home.id, house.position],
  ['altar', home.id, house.position],
  ['farmland', home.id, house.position],
  ['unknown', home.id, house.position],
  ['stone_paving', 'unknown', house.position],
  ['stone_paving', home.id, null],
  ['stone_paving', home.id, { x: home.anchor.x + home.settlementRadius + 1, y: home.anchor.y }],
  ['stone_paving', home.id, { x: -1, y: home.anchor.y }],
  ['stone_paving', home.id, { x: MAP_WIDTH, y: MAP_HEIGHT }],
  ['stone_paving', home.id, { x: home.anchor.x + 0.5, y: home.anchor.y }],
]) {
  const stateBefore = structuredClone(placementWorld.state);
  assert.equal(placementWorld.setGround(type, villageId, position), null);
  assert.deepEqual(placementWorld.state, stateBefore, 'invalid floor placement leaves the complete world unchanged');
}

const originalPixi = globalThis.PIXI;
globalThis.PIXI = { Sprite };
try {
  const world = createInitialWorld();
  const village = world.getVillage('home');
  const altar = world.state.buildings.get(world.state.sanctuary.altarId);
  const reception = world.state.sanctuary.reception;
  const expectedCourt = new Set();
  for (let y = village.anchor.y + 4; y < village.anchor.y + 8; y++) {
    for (let x = village.anchor.x - 2; x < village.anchor.x + 2; x++) expectedCourt.add(cellKey(x, y));
  }
  assert.deepEqual(new Set(world.state.groundTiles.keys()), expectedCourt, 'the sanctuary has one continuous centered 4×4 court');
  assert.equal(world.state.groundTiles.get(cellKey(reception.x, reception.y)).type, 'stone_paving');
  assert.ok(world.isAreaEmpty(village, reception, { w: 1, h: 1 }, { forMovement: true }), 'paving does not block priest reception');
  assert.equal(world.isAreaEmpty(village, reception, { w: 1, h: 1 }), false, 'reception retains its separate construction reservation');

  const renderer = new Renderer(null, world);
  renderer.camera.resize(640, 480); renderer.focusVillage('home');
  renderer.stage = { position: point() }; renderer.objects = { addChild() {} };
  const draws = [];
  let rebuilds = 0;
  renderer.tiles = { clear() { rebuilds++; draws.length = 0; }, tile(texture, x, y) { draws.push({ texture, x, y }); } };
  renderer.app = { renderer: { render() {} } };
  renderer.renderAtmosphere = () => {};
  for (const type of Object.keys(APPEARANCE)) renderer.textures.set(type, type);

  // Fail if rendering enumerates sparse world ground instead of querying the
  // viewport. Remove instrumentation before comparing the complete world.
  function renderReadOnly() {
    const stateBefore = structuredClone(world.state);
    const ground = world.state.groundTiles;
    const queried = [];
    const forbidden = ['entries', 'keys', 'values', 'forEach', 'set', 'delete', 'clear', Symbol.iterator];
    ground.get = key => { queried.push(key); return Map.prototype.get.call(ground, key); };
    for (const method of forbidden) ground[method] = () => assert.fail('rendering must only query visible ground cells');
    try { renderer.render(16); } finally {
      delete ground.get;
      for (const method of forbidden) delete ground[method];
    }
    assert.deepEqual(world.state, stateBefore, 'rendering does not mutate world state');
    const { left, top, right, bottom } = renderer.camera.bounds;
    for (const key of queried) {
      const [x, y] = key.split(',').map(Number);
      assert.ok(x >= left && x < right && y >= top && y < bottom, 'ground queries stay inside the viewport');
    }
    assert.ok(queried.length === 0 || queried.length === (right - left) * (bottom - top), 'ground work is bounded by visible cell count');
    return queried;
  }
  function renderedStoneCells() {
    const { left, top } = renderer.camera.bounds;
    return new Set(draws.filter(draw => draw.texture === 'stone_paving')
      .map(draw => cellKey(left + draw.x / TILE_SIZE, top + draw.y / TILE_SIZE)));
  }

  renderReadOnly();
  assert.deepEqual(renderedStoneCells(), expectedCourt, 'the actual renderer paints every court cell');
  for (let dy = 0; dy < altar.footprint.h; dy++) for (let dx = 0; dx < altar.footprint.w; dx++) {
    assert.ok(renderedStoneCells().has(cellKey(altar.position.x + dx, altar.position.y + dy)), 'stone continues beneath the entire altar footprint');
  }
  assert.ok(renderedStoneCells().has(cellKey(reception.x, reception.y)), 'the priest stands on the same continuous stone floor');
  const initialRebuilds = rebuilds;
  assert.equal(renderReadOnly().length, 0, 'a stationary unchanged camera reuses its floor batch');
  assert.equal(rebuilds, initialRebuilds);

  // Construction reservations are deliberately not the visual floor mask.
  world.state.sanctuary.reservedCells = [];
  renderer.groundBounds = '';
  renderReadOnly();
  assert.deepEqual(renderedStoneCells(), expectedCourt, 'removing reservations cannot remove the floor');

  const cameraBefore = { x: renderer.camera.x, y: renderer.camera.y };
  assert.ok(world.setGround('ground', 'home', altar.position));
  const rebuildsBeforeRemoval = rebuilds;
  renderReadOnly();
  assert.equal(rebuilds, rebuildsBeforeRemoval + 1, 'ground revision refreshes a stationary camera');
  assert.equal(renderedStoneCells().size, expectedCourt.size - 1);
  assert.equal(renderedStoneCells().has(cellKey(altar.position.x, altar.position.y)), false, 'cleared floor falls back to grass');
  assert.equal(world.state.groundTiles.has(cellKey(altar.position.x, altar.position.y)), false, 'default grass is implicit, not stored');
  assert.equal(world.state.occupied.get(cellKey(altar.position.x, altar.position.y)), altar, 'removing ground leaves the altar in place');
  assert.ok(world.setGround('stone_paving', 'home', altar.position));
  renderReadOnly();
  assert.deepEqual(renderedStoneCells(), expectedCourt);
  assert.deepEqual({ x: renderer.camera.x, y: renderer.camera.y }, cameraBefore);

  renderer.camera.center({ x: 0, y: 0 });
  const offscreenQueries = renderReadOnly();
  assert.equal(renderedStoneCells().size, 0, 'offscreen sanctuary flooring is not drawn');
  assert.equal(draws.length, renderer.visibleCellCount, 'offscreen rendering only emits visible base grass');
  assert.equal(offscreenQueries.length, renderer.visibleCellCount);
} finally { globalThis.PIXI = originalPixi; }
console.log('sanctuaryGround: passed');
