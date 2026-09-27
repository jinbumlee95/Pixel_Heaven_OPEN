import assert from 'node:assert/strict';
import { World, cellKey } from '../src/game/World.js';
import { DIRECTIONS, matchesDirection } from '../src/state/directions.js';
import { BUILDING_TYPES } from '../src/state/worldState.js';

for (const direction of DIRECTIONS) {
  const world = new World();
  const village = world.getVillage('home');
  for (const footprint of [{ w: 1, h: 1 }, BUILDING_TYPES.house, BUILDING_TYPES.temple]) {
    const position = world.findEmptyArea(village, footprint, direction);
    assert.ok(position);
    assert.ok(matchesDirection(village.anchor, position, footprint, direction));
    assert.ok(world.isAreaEmpty(village, position, footprint));
    if (footprint === BUILDING_TYPES.temple) assert.ok(world.placeBuilding('temple', village.id, position));
  }
}
const world = new World();
const village = world.getVillage('home');
village.settlementRadius = 3;
const { x, y } = village.anchor;
for (let dx = 1; dx <= 3; dx++) for (let dy = -3; dy < 0; dy++) {
  world.placeTerrain('farmland', 'home', { x: x + dx, y: y + dy });
}
const fallback = world.findEmptyArea(village, { w: 1, h: 1 }, 'northeast');
assert.ok(fallback);
assert.equal(matchesDirection(village.anchor, fallback, { w: 1, h: 1 }, 'northeast'), false);
assert.ok(world.isAreaEmpty(village, fallback, { w: 1, h: 1 }));
// A free preferred anchor is not sufficient if the rest of a footprint collides.
const block = new World();
const north = block.getVillage('home');
block.placeBuilding('house', 'home', { x: north.anchor.x + 2, y: north.anchor.y - 2 });
const area = block.findEmptyArea(north, BUILDING_TYPES.temple, 'northeast');
assert.ok(block.isAreaEmpty(north, area, BUILDING_TYPES.temple));
assert.equal(block.state.occupied.size, 6); // Searching has no mutations.
let free;
while ((free = world.findEmptyArea(village, { w: 1, h: 1 }))) world.placeTerrain('farmland', 'home', free);
assert.equal(world.findEmptyArea(village, { w: 1, h: 1 }, 'northeast'), null);
assert.equal(world.findEmptyArea(village, { w: 1, h: 1 }, 'up'), null);
assert.equal(world.findEmptyArea(village, null, 'home'), null);
const edge = new World();
edge.getVillage('home').anchor = { x: 0, y: 0 };
const edgePosition = edge.findEmptyArea(edge.getVillage('home'), { w: 3, h: 3 }, 'northwest');
assert.ok(edgePosition.x >= 0 && edgePosition.y >= 0);
assert.equal(edge.state.occupied.has(cellKey(edgePosition.x, edgePosition.y)), false);
console.log('directions: passed');
