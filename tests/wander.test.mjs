import assert from 'node:assert/strict';
import { createInitialWorld, World, cellKey, isInSettlement } from '../src/game/World.js';
import { updateWander, WANDER_RULES, pauseWander } from '../src/game/Wander.js';

const advance = (world, duration, random = () => 0, frameMs = 50) => {
  for (let elapsed = 0; elapsed < duration;) {
    const step = Math.min(frameMs, duration - elapsed);
    updateWander(world, step, random);
    elapsed += step;
  }
};
const single = () => {
  const world = new World();
  return { world, pawn: world.spawnEntity('priest', 'home') };
};
const seeded = () => {
  let state = 42;
  return () => ((state = Math.imul(state, 1664525) + 1013904223 >>> 0) / 4294967296);
};

const world = createInitialWorld();
assert.equal(world.state.villages.length, 1);
assert.equal(world.state.entities.size, 4);
const before = [...world.state.entities.values()].map(e => ({ ...e.position }));
const population = world.state.villages.map(v => v.population);
let draws = 0;
const random = () => { draws++; return 0; };
updateWander(world, 1, random);
const initializationDraws = draws;
advance(world, WANDER_RULES.restMinMs - 2, random);
assert.deepEqual([...world.state.entities.values()].map(e => e.position), before);
assert.equal(draws, initializationDraws, 'resting consumes no repeated RNG or movement decisions');
updateWander(world, 1, random);
assert.notDeepEqual([...world.state.entities.values()].map(e => e.position), before);
for (const entity of world.state.entities.values()) {
  assert.equal(entity.wanderPlan.phase, 'walking');
  assert.ok(entity.wanderPlan.route.length >= WANDER_RULES.minLegCells);
  assert.ok(entity.wanderPlan.route.length <= WANDER_RULES.maxLegCells);
  assert.equal(entity.moveDurationMs, 450);
}
const afterFirstStep = [...world.state.entities.values()].map(e => ({ ...e.position }));
advance(world, WANDER_RULES.stepMs - 1, random);
assert.deepEqual([...world.state.entities.values()].map(e => e.position), afterFirstStep);
updateWander(world, 1, random);
assert.notDeepEqual([...world.state.entities.values()].map(e => e.position), afterFirstStep);
for (let i = 0; i < 1200; i++) {
  const previous = [...world.state.entities.values()].map(e => ({ ...e.position }));
  updateWander(world, 100, () => (i % 8) / 8);
  const positions = new Set();
  let index = 0;
  for (const entity of world.state.entities.values()) {
    const { x, y } = entity.position;
    const old = previous[index++];
    assert.ok(Math.abs(old.x - x) + Math.abs(old.y - y) <= 1, 'cardinal steps do not cut corners');
    assert.ok(isInSettlement(world.getVillage(entity.villageId), x, y));
    assert.equal(world.state.occupied.get(cellKey(x, y)), entity);
    positions.add(cellKey(x, y));
    if (entity.type !== 'priest') assert.ok(!world.state.sanctuary.reservedCells.some(cell => cell.x === x && cell.y === y));
  }
  assert.equal(positions.size, world.state.entities.size);
}
assert.equal(world.state.time, 0); // Wander runs independently of resource ticks.
assert.deepEqual(world.state.villages.map(v => v.population), population);
const trapped = new World();
trapped.getVillage('home').settlementRadius = 0;
const priest = trapped.spawnEntity('priest', 'home');
const start = { ...priest.position };
advance(trapped, WANDER_RULES.restMaxMs, () => 0.5);
assert.deepEqual(priest.position, start);
assert.equal(priest.wanderPlan.phase, 'resting');

const visit = single();
visit.world.placeBuilding('house', 'home', { x: 1003, y: 1000 });
visit.world.placeTerrain('forest', 'home', { x: 1001, y: 1000 });
advance(visit.world, WANDER_RULES.restMinMs);
assert.equal(visit.pawn.wanderPlan.intent, 'visit_house', 'a real house supplies a visual visit destination');
assert.ok(!visit.pawn.wanderPlan.route.some(cell => cell.x === 1001 && cell.y === 1000), 'route avoids a forest obstacle');
const target = { ...visit.pawn.wanderPlan.destination };
const remainingSteps = visit.pawn.wanderPlan.route.length - visit.pawn.wanderPlan.routeIndex;
advance(visit.world, (remainingSteps + 1) * WANDER_RULES.stepMs);
assert.deepEqual(visit.pawn.position, target);
assert.equal(visit.pawn.wanderPlan.phase, 'resting', 'arrival starts a real rest after the final visual step');
advance(visit.world, WANDER_RULES.restMinMs - 1);
assert.deepEqual(visit.pawn.position, target, 'the pawn stays at its destination instead of jittering each tick');

const blocked = single();
advance(blocked.world, WANDER_RULES.restMinMs);
const blockedAt = { ...blocked.pawn.position };
const next = blocked.pawn.wanderPlan.route[blocked.pawn.wanderPlan.routeIndex];
assert.ok(blocked.world.placeTerrain('forest', 'home', next));
advance(blocked.world, WANDER_RULES.stepMs);
assert.deepEqual(blocked.pawn.position, blockedAt);
assert.equal(blocked.pawn.wanderPlan.phase, 'resting', 'new obstructions discard the route and wait before retrying');
let attempts = 0;
const move = blocked.world.moveEntity.bind(blocked.world);
blocked.world.moveEntity = (...args) => { attempts++; return move(...args); };
advance(blocked.world, 3000);
assert.equal(attempts, 0, 'a blocked path causes no per-frame movement retries');

const ritualWorld = createInitialWorld();
const busyPriest = [...ritualWorld.state.entities.values()].find(entity => entity.type === 'priest');
busyPriest.activity = 'oracle';
const waiting = { ...busyPriest.position };
const otherPawns = [...ritualWorld.state.entities.values()].filter(entity => entity !== busyPriest);
const pawnPositions = otherPawns.map(entity => ({ ...entity.position }));
advance(ritualWorld, WANDER_RULES.restMinMs + WANDER_RULES.stepMs, () => 0);
assert.deepEqual(busyPriest.position, waiting, 'ritual movement is never overridden by decorative wander');
assert.equal(busyPriest.wanderElapsed, 0, 'a busy Priest accumulates no post-ritual movement burst');
assert.notDeepEqual(otherPawns.map(entity => entity.position), pawnPositions, 'ordinary pawns continue wandering during reception');
assert.equal(busyPriest.wanderPlan.phase, 'paused');
delete busyPriest.activity;
advance(ritualWorld, WANDER_RULES.restMinMs - 1);
assert.deepEqual(busyPriest.position, waiting, 'the Priest rests after reception rather than resuming a stale leg');
updateWander(ritualWorld, 1, () => 0);
assert.notDeepEqual(busyPriest.position, waiting);
pauseWander(busyPriest);
assert.equal(busyPriest.wanderPlan.route.length, 0);
assert.deepEqual(JSON.parse(JSON.stringify(busyPriest.wanderPlan)), busyPriest.wanderPlan);

const resumed = single();
updateWander(resumed.world, 60000, () => 0);
assert.equal(resumed.pawn.wanderPlan.remainingMs, WANDER_RULES.restMinMs - WANDER_RULES.maxElapsedMs);
advance(resumed.world, WANDER_RULES.restMinMs - WANDER_RULES.maxElapsedMs);
const beforeResume = { ...resumed.pawn.position };
updateWander(resumed.world, 60000, () => 0);
assert.ok(Math.abs(resumed.pawn.position.x - beforeResume.x) + Math.abs(resumed.pawn.position.y - beforeResume.y) <= 1,
  'a suspended tab never catches up an entire route in one frame');

const bounded = single();
bounded.world.getVillage('home').settlementRadius = 100000;
let checks = 0;
const isEmpty = bounded.world.isAreaEmpty.bind(bounded.world);
bounded.world.isAreaEmpty = (...args) => { checks++; return isEmpty(...args); };
advance(bounded.world, WANDER_RULES.restMinMs);
assert.ok(checks <= WANDER_RULES.routeBudget + 1, 'even a huge settlement keeps local routing bounded');
assert.ok(bounded.pawn.wanderPlan.route.length <= WANDER_RULES.maxLegCells);

const fast = createInitialWorld(), slow = createInitialWorld();
advance(fast, 60000, seeded(), 20);
advance(slow, 60000, seeded(), 100);
assert.deepEqual([...fast.state.entities.values()], [...slow.state.entities.values()],
  'equal elapsed time preserves decisions, paths and rests across normal frame rates');
assert.throws(() => updateWander(world, Infinity), RangeError);
assert.throws(() => updateWander(world, -1), RangeError);
console.log('wander: passed');
