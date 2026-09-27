import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContentRegistry } from '../src/content/ContentRegistry.js';
import { builtinPack, defaultContent } from '../src/content/builtin.js';
import { World, createInitialWorld, cellKey } from '../src/game/World.js';
import { executeWorldAction } from '../src/actions/worldActions.js';
import { matchesDirection } from '../src/state/directions.js';

// A real JSON pack crosses the same interface as built-in content. Extra art
// does not silently acquire housing, worship or simulation behavior.
const pack = JSON.parse(await readFile(new URL('../examples/packs/garden.json', import.meta.url), 'utf8'));
const content = createContentRegistry([builtinPack, pack]);
const world = new World(undefined, { content });
const village = world.getVillage('home');
const { x, y } = village.anchor;
const shrine = world.placeBuilding('garden:shrine', 'home', { x, y });
assert.ok(shrine);
assert.equal(world.content, content);
assert.equal(world.state.occupied.size, 6);
assert.equal(village.houseCount, undefined);
assert.equal(village.templeCount, 0);
assert.equal(world.placeBuilding('house', 'home', { x: x + 2, y: y + 1 }), null);
const grove = world.placeTerrain('garden:grove', 'home', { x: x - 4, y });
assert.ok(grove);
for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
  assert.equal(world.state.occupied.get(cellKey(x - 4 + dx, y + dy)), grove);
}
const before = structuredClone(world.state);
assert.equal(world.placeTerrain('garden:shrine', 'home', { x: x + 10, y }), null);
assert.equal(world.placeBuilding('garden:grove', 'home'), null);
assert.equal(world.spawnEntity('unknown', 'home'), null);
assert.equal(world.spawnEntity('house', 'home'), null);
assert.deepEqual(world.state, before);
assert.equal(defaultContent.get('garden:shrine'), undefined, 'custom catalogs are isolated');
const moddedInitial = createInitialWorld({ content });
assert.equal(moddedInitial.content, content);
assert.equal(moddedInitial.state.villages.length, 1);
assert.equal(moddedInitial.state.terrain.get(moddedInitial.state.sanctuary.treeId).type, 'world_tree');
assert.equal([...moddedInitial.state.buildings.values()].some(object => object.type === 'garden:shrine'), false,
  'registering a decorative definition does not silently change the playable starting layout');

// A free one-cell anchor is not enough for a 3x2 house. Find a full rectangle
// in the requested direction, and charge only after placement succeeds.
const action = name => ({ action: name, actor: 'home', target: 'home', reason: 'housing_shortage',
  parameters: { direction: 'northeast' } });
const construction = new World();
const home = construction.getVillage('home');
home.wood = 40;
construction.placeTerrain('farmland', 'home', { x: home.anchor.x + 2, y: home.anchor.y - 1 });
const result = executeWorldAction(construction, action('build_house'));
assert.ok(result.ok);
const house = construction.state.occupied.get(cellKey(result.event.position.x, result.event.position.y));
assert.deepEqual(house.footprint, { w: 3, h: 2 });
assert.ok(matchesDirection(home.anchor, house.position, house.footprint, 'northeast'));
assert.equal(construction.state.occupied.size, 7);
assert.equal(home.wood, 20);

// All five cells are free, but no house or temple foundation fits radius 1.
const tooSmall = new World();
Object.assign(tooSmall.getVillage('home'), { settlementRadius: 1, wood: 100, stone: 100, cloth: 100, silver: 100, gold: 100 });
const empty = structuredClone(tooSmall.state);
for (const name of ['build_house', 'build_temple']) {
  assert.equal(executeWorldAction(tooSmall, action(name)).code, 'no_space');
  assert.deepEqual(tooSmall.state, empty, 'failed placement never spends wood or changes counts/events');
}
console.log('contentWorld: passed');
