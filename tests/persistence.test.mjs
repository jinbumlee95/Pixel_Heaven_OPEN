import assert from 'node:assert/strict';
import { createInitialWorld } from '../src/game/World.js';
import { SAVE_VERSION, encodeWorld, decodeWorld, worldRandom, parsePack } from '../src/state/Persistence.js';
import { HeroSystem } from '../src/game/Hero.js';
import { tick } from '../src/game/Simulation.js';
import {Game} from '../src/game/Game.js';
import {readFile} from 'node:fs/promises';
const world = createInitialWorld(); new HeroSystem(world);
const random = worldRandom(world, 17); random();
const text = encodeWorld(world, { history: [] });
const restored = decodeWorld(text).world;
assert.deepEqual(restored.state, world.state);
assert.equal(worldRandom(restored)(), random());
tick(restored.state); tick(world.state);
assert.deepEqual(restored.state, world.state);
for (const [key, entity] of restored.state.occupied) {
  assert.ok(restored.state.buildings.get(entity.id) === entity || restored.state.terrain.get(entity.id) === entity || restored.state.entities.get(entity.id) === entity, key);
}
const malformed = JSON.parse(text); malformed.state.villages[0].food = -1;
assert.throws(() => decodeWorld(JSON.stringify(malformed)));
assert.throws(() => decodeWorld(text.replace(`"version":${SAVE_VERSION}`, '"version":999')));
const old = JSON.parse(text); old.version = 1; delete old.state.groundTiles;
assert.ok(decodeWorld(JSON.stringify(old)).world.state.groundTiles instanceof Map);
assert.equal(decodeWorld(await readFile(new URL('./fixtures/world-v1.json',import.meta.url),'utf8')).world.getVillage('home').population,8);
assert.throws(() => parsePack('{"schemaVersion":1,"id":"evil","execute":"alert(1)"}'));
assert.equal(parsePack('{"schemaVersion":1,"id":"empty","definitions":[]}').id, 'empty');
assert.equal(encodeWorld(world), encodeWorld(world), 'saving is read only');
const complete=new Game(null), valid=JSON.parse(complete.snapshot());
for(const damage of [s=>s.state.hero.mode='invented',s=>s.state.life.sheep=-1,s=>s.state.work.jobs=[{status:'working',required:0}],s=>s.state.eventQueue[0].endAt=-1,s=>s.nextId=1,s=>s.state.factions[0].resources.food=-1,s=>s.state.villages[0].labor.farming=100]){
  const broken=structuredClone(valid);damage(broken);assert.throws(()=>decodeWorld(JSON.stringify(broken)));
}
assert.equal(complete.world.state.time,0,'invalid files never mutate the live world');complete.stop();
console.log('persistence: passed');
