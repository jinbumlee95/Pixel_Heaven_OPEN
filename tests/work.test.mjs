import assert from 'node:assert/strict';
import { createInitialWorld } from '../src/game/World.js';
import { WorkSystem, assignLabor, queueConstruction, cancelConstruction } from '../src/game/Work.js';
import { decodeWorld, encodeWorld } from '../src/state/Persistence.js';
const world = createInitialWorld(), system = new WorkSystem(world), home = world.getVillage('home');
home.wood = 100; home.stone = 100; home.cloth = 10;
assert.equal(assignLabor(world, 'building', 9).ok, false);
const before = home.houseCount;
assert.equal(queueConstruction(world, { action: 'build_house', parameters: { direction: 'east' } }).ok, true);
assert.equal(home.houseCount, before);
assert.equal(home.wood, 80);
assert.equal(queueConstruction(world, { action: 'build_house', parameters: {} }).ok, false);
for (let i = 0; i < 15; i++) { world.state.time++; system.update(); }
const restored = decodeWorld(encodeWorld(world)).world;
const second = new WorkSystem(restored);
for (let i = 0; i < 15; i++) { restored.state.time++; second.update(); }
assert.equal(restored.getVillage('home').houseCount, before + 1);
second.update(); assert.equal(restored.getVillage('home').houseCount, before + 1);
assert.equal(cancelConstruction(world, 'job-1').ok, true);
assert.equal(home.wood, 90, 'only unspent half is refunded');
assert.equal(cancelConstruction(world, 'job-1').ok, false);
assert.equal(home.wood, 90);
const building = [...world.state.buildings.values()].find(b => b.type === 'house'); building.damage = 20;
assert.equal(queueConstruction(world, { action: 'repair' }, { repairId: building.id }).ok, true);
for (let i = 0; i < 20; i++) { world.state.time++; system.update(); }
assert.equal(building.damage, 0);
const site=world.findEmptyArea(world.getVillage('home'),{w:3,h:2},'east');
assert.ok(site.x>=1006||site.y>=1005||site.y+2<=992,'automatic houses do not disappear behind the Worldtree canopy');
console.log('work: passed');
