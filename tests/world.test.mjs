import assert from 'node:assert/strict';
import { World, createInitialWorld, cellKey, isInSettlement } from '../src/game/World.js';
import { BUILDING_TYPES, PAWNS_PER_VILLAGE } from '../src/state/worldState.js';

const world = new World();
const village = world.getVillage('home');
const { x, y } = village.anchor;
const house = world.placeBuilding('house', village.id, { x: x + 2, y: y + 2 });
assert.ok(house);
assert.equal(world.placeBuilding('temple', village.id, { x, y }), null);
assert.equal(world.state.occupied.size, 6, 'a house occupies its full 3x2 foundation');
const position = world.findEmptyArea(village, BUILDING_TYPES.temple);
const temple = world.placeBuilding('temple', village.id, position);
assert.ok(temple);
assert.equal(world.state.occupied.size, 30);
for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 6; dx++) {
  assert.equal(world.state.occupied.get(cellKey(position.x + dx, position.y + dy)), temple);
  assert.equal(world.placeBuilding('house', village.id, { x: position.x + dx, y: position.y + dy }), null);
}
assert.equal(world.placeBuilding('house', 'missing'), null);
assert.equal(world.placeBuilding('toString', village.id), null);
assert.equal(world.placeBuilding('temple', village.id, { x: x + 19, y }), null);
assert.equal(world.placeBuilding('house', village.id, { x: x + 0.5, y }), null);
assert.equal(world.placeBuilding('house', village.id, { x: NaN, y }), null);

const edge = new World();
const boundary = edge.getVillage('home');
boundary.anchor = { x: 0, y: 0 };
boundary.settlementRadius = 2;
assert.equal(edge.placeBuilding('house', 'home', { x: -1, y: 0 }), null);
let free;
while ((free = edge.findEmptyArea(boundary, { w: 1, h: 1 }))) edge.placeTerrain('farmland', 'home', free);
assert.equal(edge.state.occupied.size, 6);
assert.equal(edge.findEmptyArea(boundary, BUILDING_TYPES.house), null);
assert.equal(edge.findEmptyArea(boundary, BUILDING_TYPES.temple), null);
assert.equal(isInSettlement(boundary, 2000, 0), false);

const initial = createInitialWorld();
assert.equal(initial.state.villages.length, 1);
assert.equal(initial.state.villages[0].id, 'home');
assert.equal(initial.state.playerSettlementId, 'home');
assert.equal(initial.state.entities.size, 1 + PAWNS_PER_VILLAGE);
assert.ok(initial.state.occupied.size < 80, 'the initial world remains sparse');
assert.equal(initial.getVillage('home').population, 8, 'the settlement starts as a small group');
assert.equal(initial.getVillage('home').houseCount, 1);
assert.equal(initial.getVillage('home').farmCount, 1);
assert.equal(initial.state.buildings.size, 2, 'one house and the sanctuary altar');
assert.equal(initial.state.terrain.size, 6, 'Worldtree, one field and four ordinary forest cells');
const sanctuary = initial.state.sanctuary;
const tree = initial.state.terrain.get(sanctuary.treeId);
const altar = initial.state.buildings.get(sanctuary.altarId);
assert.equal(tree.type, 'world_tree');
assert.deepEqual(tree.footprint, { w: 6, h: 4 });
assert.equal(altar.type, 'altar');
assert.deepEqual(altar.footprint, { w: 2, h: 1 });
assert.equal([...initial.state.buildings.values()].some(object => object.type === 'town_hall'), false);
for (const object of [...initial.state.buildings.values(), ...initial.state.terrain.values(), ...initial.state.entities.values()]) {
  for (let dy = 0; dy < object.footprint.h; dy++) for (let dx = 0; dx < object.footprint.w; dx++) {
    assert.equal(initial.state.occupied.get(cellKey(object.position.x + dx, object.position.y + dy)), object);
  }
}
const beforeReserved = structuredClone(initial.state);
for (const cell of sanctuary.reservedCells) {
  assert.equal(initial.state.occupied.has(cellKey(cell.x, cell.y)), false, 'the reception approach is physically clear');
  assert.equal(initial.isAreaEmpty(initial.getVillage('home'), cell, { w: 1, h: 1 }), false);
  assert.equal(initial.placeTerrain('farmland', 'home', cell), null, 'construction cannot occupy the ritual approach');
  assert.equal(initial.isAreaEmpty(initial.getVillage('home'), cell, { w: 1, h: 1 }, { forMovement: true }), true);
}
assert.deepEqual(initial.state, beforeReserved, 'rejected construction never changes resources or occupation');
const priest = [...initial.state.entities.values()].find(entity => entity.type === 'priest');
assert.ok(initial.moveEntity(priest, sanctuary.reception), 'reserved approach cells remain available for physical movement');
assert.equal(initial.state.occupied.get(cellKey(sanctuary.reception.x, sanctuary.reception.y)), priest);
initial.getVillage('home').population = 30000;
assert.equal(initial.state.entities.size, 1 + PAWNS_PER_VILLAGE, 'visual pawn count never scales with population');
assert.equal(initial.state.resources.food, 30);
assert.equal(initial.state.resources.wood, 15);
console.log('world: passed');
