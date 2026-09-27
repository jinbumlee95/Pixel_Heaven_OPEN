import assert from 'node:assert/strict';
import { World, cellKey, isInSettlement } from '../src/game/World.js';
import { OracleRitual, ORACLE_RITUAL } from '../src/game/OracleRitual.js';
import { updateWander, WANDER_INTERVAL_MS, WANDER_RULES } from '../src/game/Wander.js';
import { advanceMovement } from '../src/game/Presentation.js';

function fixture({ start = { x: 100, y: 100 }, target = { x: 107, y: 100 },
  altar = { x: 107, y: 98 }, radius = 12 } = {}) {
  const world = new World();
  const village = world.state.villages[0];
  village.anchor = { x: 100, y: 100 };
  village.settlementRadius = radius;
  const priest = world.spawnEntity('priest', village.id, 'The High Priest');
  if (priest.position.x !== start.x || priest.position.y !== start.y) assert.ok(world.moveEntity(priest, start));
  let count = 0;
  const occupy = (at, footprint, kind = 'building') => {
    const object = { id: `ritual_fixture_${++count}`, type: kind === 'terrain' ? 'world_tree' : 'altar',
      villageId: village.id, position: { ...at }, footprint: { ...footprint } };
    assert.ok(world.isAreaEmpty(village, at, footprint), 'Fixture must not overlap existing objects');
    (kind === 'terrain' ? world.state.terrain : world.state.buildings).set(object.id, object);
    world.occupy(object);
    return object;
  };
  const tree = occupy({ x: 97, y: 93 }, { w: 3, h: 2 }, 'terrain');
  const altarObject = occupy(altar, { w: 2, h: 2 });
  world.state.sanctuary = { treeId: tree.id, altarId: altarObject.id, reception: { ...target },
    reservedCells: [{ ...target }] };
  const stages = [];
  const ritual = new OracleRitual(world, priest, { onStage: state => stages.push(state) });
  return { world, village, priest, ritual, stages, occupy };
}

function drive(ritual, stage, limit = 300) {
  for (let index = 0; index < limit && ritual.current.stage !== stage; index++) ritual.update(100);
  assert.equal(ritual.current.stage, stage, `Ritual must reach ${stage} in a bounded number of frames`);
}

const first = fixture();
const obstacle = first.occupy({ x: 101, y: 99 }, { w: 4, h: 2 });
const gameplay = structuredClone({ villages: first.world.state.villages,
  resources: first.world.state.resources, events: first.world.state.recent_events });
const start = { ...first.priest.position };
const steps = [];
const move = first.world.moveEntity.bind(first.world);
first.world.moveEntity = (entity, next) => {
  const from = { ...entity.position };
  const moved = move(entity, next);
  if (moved) steps.push({ from, next: { ...next } });
  return moved;
};
let completed = 0;
const firstResult = first.ritual.receive({ id: 1, message: '北の村に雨を降らせて' }).then(result => { completed++; return result; });
assert.equal(first.ritual.current.stage, 'approaching');
assert.equal(first.priest.activity, 'oracle');
assert.deepEqual(first.priest.position, start, 'Receiving an oracle must not teleport the Priest');
await Promise.resolve();
assert.equal(completed, 0, 'The effect cannot run immediately');
first.ritual.update(0);
assert.deepEqual(first.priest.position, start, 'Paused frame does not advance the procession');
const detached = first.ritual.current;
detached.target.x = 999;
detached.position.x = 999;
assert.equal(first.ritual.current.target.x, 107, 'Presentation receives detached snapshots');
assert.deepEqual(first.priest.position, start);

drive(first.ritual, 'receiving');
assert.deepEqual(first.priest.position, first.world.state.sanctuary.reception);
assert.equal(first.priest.facing, 'north');
assert.ok(steps.length > 7, 'The footprint requires a real detour');
for (const step of steps) {
  assert.equal(Math.abs(step.next.x - step.from.x) + Math.abs(step.next.y - step.from.y), 1,
    'Every movement is one cardinal grid cell');
  assert.ok(isInSettlement(first.village, step.next.x, step.next.y));
  assert.ok(!(step.next.x >= obstacle.position.x && step.next.x < obstacle.position.x + obstacle.footprint.w
    && step.next.y >= obstacle.position.y && step.next.y < obstacle.position.y + obstacle.footprint.h));
}
assert.equal(first.world.state.occupied.get(cellKey(107, 100)), first.priest);
for (let elapsed = 0; elapsed < ORACLE_RITUAL.receivingMs - 100; elapsed += 100) first.ritual.update(100);
await Promise.resolve();
assert.equal(completed, 0, 'Arrival is followed by a visible receiving delay');
first.ritual.update(100);
const firstReply = await firstResult;
assert.equal(firstReply.stage, 'interpreting');
assert.equal(firstReply.messageId, 1);
assert.equal(completed, 1);
assert.equal(first.priest.activity, 'oracle', 'Priest waits at the altar while asynchronous interpretation runs');
const altarPosition = { ...first.priest.position };
updateWander(first.world, WANDER_INTERVAL_MS * 5, () => 0);
assert.deepEqual(first.priest.position, altarPosition, 'Wander cannot interrupt interpretation');
assert.equal(first.ritual.finish(999), false, 'A stale request cannot release a newer ritual');
assert.equal(first.ritual.finish(1), true);
assert.equal(first.ritual.finish(1), false);
assert.equal(first.ritual.current.stage, 'idle');
assert.equal(first.priest.activity, undefined);
assert.deepEqual(first.priest.position, altarPosition, 'Completion leaves the Priest at the altar');
assert.equal(first.priest.facing, 'north');
assert.deepEqual({ villages: first.world.state.villages, resources: first.world.state.resources,
  events: first.world.state.recent_events }, gameplay, 'Ritual does not apply oracle effects or change resource math');
first.ritual.update(10000);
assert.equal(completed, 1, 'Completion is emitted exactly once');
assert.deepEqual([...new Set(first.stages.map(state => state.stage))], ['approaching', 'receiving', 'interpreting', 'idle']);

// Arrival from another direction still faces the altar, not the last walk step.
const opposite = fixture({ start: { x: 110, y: 100 } });
const oppositeResult = opposite.ritual.receive({ id: 2, message: 'remember' });
drive(opposite.ritual, 'interpreting');
await oppositeResult;
assert.equal(opposite.priest.facing, 'north');
opposite.ritual.finish(2);
const side = fixture({ target: { x: 105, y: 100 }, altar: { x: 106, y: 100 } });
const sideResult = side.ritual.receive({ id: 3, message: 'rain' });
drive(side.ritual, 'interpreting');
await sideResult;
assert.equal(side.priest.facing, 'east');
side.ritual.finish(3);

// Starting at reception skips walking but never skips receiving time.
const lastLeg = fixture({ start: { x: 106, y: 100 } });
const lastLegResult = lastLeg.ritual.receive({ id: 44, message: 'rain' });
lastLeg.ritual.update(16);
assert.deepEqual(lastLeg.priest.position, { x: 107, y: 100 });
assert.equal(lastLeg.ritual.current.stage, 'approaching', 'Final logical cell is reserved while the visible Priest is still walking');
assert.equal(lastLeg.priest.facing, 'east', 'Do not face the altar during the last walking leg');
lastLeg.ritual.update(250);
lastLeg.ritual.update(ORACLE_RITUAL.stepMs - 251);
assert.equal(lastLeg.ritual.current.stage, 'approaching');
lastLeg.ritual.update(1);
assert.equal(lastLeg.ritual.current.stage, 'receiving', 'Reception starts only after the whole final movement interval');
assert.equal(lastLeg.priest.facing, 'north');
drive(lastLeg.ritual, 'interpreting');
await lastLegResult;
lastLeg.ritual.finish(44);

const already = fixture({ start: { x: 107, y: 100 } });
const alreadyResult = already.ritual.receive({ id: 4, message: 'rain' });
already.ritual.update(100);
assert.equal(already.ritual.current.stage, 'receiving');
already.ritual.update(60000);
assert.equal(already.ritual.current.stage, 'receiving', 'A suspended tab cannot instantly complete a ritual');
assert.ok(already.ritual.current.progress < 0.2);
drive(already.ritual, 'interpreting');
await alreadyResult;
already.ritual.finish(4);

// Interrupt actual wandering between its logical reservation and visual arrival.
// The oracle must finish that leg before replacing it with a procession step,
// including when wander already reserved the reception cell itself.
for (const alreadyAtTarget of [false, true]) {
  const interrupted = fixture({ start: { x: alreadyAtTarget ? 106 : 105, y: 100 } });
  let visual = advanceMovement(null, interrupted.priest.position, 0);
  const firstCell = { x: alreadyAtTarget ? 107 : 106, y: 100 };
  interrupted.priest.wanderPlan = { phase: 'walking', intent: 'stroll', remainingMs: 1,
    route: [firstCell, { x: firstCell.x + 1, y: 100 }, { x: firstCell.x + 2, y: 100 }],
    routeIndex: 0, destination: { x: firstCell.x + 2, y: 100 } };
  updateWander(interrupted.world, 1, () => 0);
  visual = advanceMovement(visual, interrupted.priest.position, 16,
    { cellMs: interrupted.priest.moveDurationMs });
  assert.notDeepEqual(visual.position, interrupted.priest.position, 'fixture is inside a real wander leg');
  const pending = interrupted.ritual.receive({ id: alreadyAtTarget ? 72 : 71, message: 'rain' });
  assert.equal(interrupted.priest.wanderPlan.phase, 'paused');
  assert.equal(interrupted.priest.wanderPlan.route.length, 0, 'oracle discards the remaining wander route');
  assert.equal(interrupted.ritual.active.transitMs, WANDER_RULES.stepMs);
  for (let elapsed = 0; elapsed < WANDER_RULES.stepMs - 1;) {
    const step = Math.min(50, WANDER_RULES.stepMs - 1 - elapsed);
    interrupted.ritual.update(step);
    updateWander(interrupted.world, step, () => 0);
    visual = advanceMovement(visual, interrupted.priest.position, step,
      { cellMs: interrupted.priest.moveDurationMs });
    elapsed += step;
    assert.deepEqual(interrupted.priest.position, firstCell, 'no new oracle leg while wander is settling');
    assert.equal(interrupted.ritual.current.stage, 'approaching', 'logical altar arrival alone cannot start receiving');
  }
  for (let frames = 0; frames < 50 && interrupted.ritual.current.stage !== 'receiving'; frames++) {
    interrupted.ritual.update(50);
    visual = advanceMovement(visual, interrupted.priest.position, 50,
      { cellMs: interrupted.priest.moveDurationMs });
  }
  assert.equal(interrupted.ritual.current.stage, 'receiving');
  assert.deepEqual(visual.position, interrupted.world.state.sanctuary.reception,
    'the displayed Priest has reached the altar before reception begins');
  assert.equal(visual.queue.length, 0, 'no unfinished visual corner remains at reception');
  drive(interrupted.ritual, 'interpreting');
  await pending;
  interrupted.ritual.finish(alreadyAtTarget ? 72 : 71);
}

// A temporarily occupied path is retried, with a fixed upper bound.
const blocked = fixture();
for (const [x, y] of [[100, 99], [101, 100], [100, 101], [99, 100]]) {
  blocked.occupy({ x, y }, { w: 1, h: 1 });
}
const blockedResult = blocked.ritual.receive({ id: 5, message: 'rain' }).then(() => null, error => error);
let searches = 0;
const findBlocked = blocked.ritual.findPath.bind(blocked.ritual);
blocked.ritual.findPath = (...args) => { searches++; return findBlocked(...args); };
drive(blocked.ritual, 'blocked');
const blockedError = await blockedResult;
assert.equal(blockedError.code, 'ritual_blocked');
assert.equal(blockedError.messageKey, 'oracle.ritual.failure.blocked');
assert.equal(searches, ORACLE_RITUAL.maxRouteAttempts);
assert.equal(blocked.priest.activity, undefined);
assert.deepEqual(blocked.priest.position, { x: 100, y: 100 });
blocked.ritual.update(30000);
assert.equal(searches, ORACLE_RITUAL.maxRouteAttempts, 'Failed paths are not searched forever');

// Even an oversized future settlement cannot trigger a scan of the world map.
const oversized = fixture({ target: { x: 700, y: 700 }, altar: { x: 700, y: 698 }, radius: 1000 });
let inspected = 0;
const areaEmpty = oversized.world.isAreaEmpty.bind(oversized.world);
oversized.world.isAreaEmpty = (...args) => {
  inspected++;
  assert.equal(args[3]?.forMovement, true, 'Reception reservations allow paths but continue to forbid construction');
  return areaEmpty(...args);
};
const oversizedResult = oversized.ritual.receive({ id: 50, message: 'rain' }).then(() => null, error => error);
drive(oversized.ritual, 'blocked');
assert.equal((await oversizedResult).code, 'ritual_blocked');
assert.ok(inspected <= ORACLE_RITUAL.maxVisitedCells * ORACLE_RITUAL.maxRouteAttempts);

// Re-plan if a building occupies the next path cell after the procession starts.
const dynamic = fixture();
const dynamicResult = dynamic.ritual.receive({ id: 6, message: 'rain' });
dynamic.ritual.update(100);
dynamic.occupy({ x: dynamic.priest.position.x + 1, y: 100 }, { w: 1, h: 1 });
drive(dynamic.ritual, 'interpreting');
await dynamicResult;
assert.deepEqual(dynamic.priest.position, dynamic.world.state.sanctuary.reception);
dynamic.ritual.finish(6);

const missing = fixture();
missing.world.state.sanctuary = null;
await assert.rejects(missing.ritual.receive({ id: 7, message: 'rain' }), { code: 'ritual_missing_sanctuary' });
assert.equal(missing.priest.activity, undefined);
const outOfBounds = fixture();
outOfBounds.world.state.sanctuary.reception = { x: 1999, y: 1999 };
await assert.rejects(outOfBounds.ritual.receive({ id: 8, message: 'rain' }), { code: 'ritual_missing_sanctuary' });

const cancelled = fixture();
const cancelledResult = cancelled.ritual.receive({ id: 9, message: 'rain' }).then(() => null, error => error);
await assert.rejects(cancelled.ritual.receive({ id: 10, message: 'rain' }), { code: 'ritual_busy' });
cancelled.ritual.update(200);
const cancelledPosition = { ...cancelled.priest.position };
cancelled.ritual.stop();
cancelled.ritual.stop();
assert.equal((await cancelledResult).code, 'ritual_stopped');
assert.equal(cancelled.ritual.current.stage, 'idle');
assert.equal(cancelled.priest.activity, undefined);
cancelled.ritual.update(10000);
assert.deepEqual(cancelled.priest.position, cancelledPosition);
await assert.rejects(cancelled.ritual.receive({ id: 11, message: 'rain' }), { code: 'ritual_stopped' });
assert.throws(() => cancelled.ritual.update(Infinity), RangeError);
assert.throws(() => cancelled.ritual.update(-1), RangeError);

const abortable = fixture();
const abortResult = abortable.ritual.receive({ id: 20, message: 'rain' }).then(() => null, error => error);
assert.equal(abortable.ritual.cancel(19), false, 'An unrelated abort cannot cancel an active message');
assert.equal(abortable.ritual.cancel(20, 'ritual_timeout'), true);
assert.equal(abortable.ritual.cancel(20, 'ritual_timeout'), false);
assert.equal((await abortResult).code, 'ritual_timeout');
assert.equal(abortable.priest.activity, undefined);
const retryAfterAbort = abortable.ritual.receive({ id: 21, message: 'rain' });
assert.equal(abortable.ritual.finish(20), false, 'A late finally cannot finish the next oracle');
drive(abortable.ritual, 'interpreting');
await retryAfterAbort;
assert.equal(abortable.ritual.finish(21), true);

const timeout = fixture();
const timeoutResult = timeout.ritual.receive({ id: 12, message: 'rain' }).then(() => null, error => error);
// Deliberately slow valid frames cannot exceed the reception deadline either.
timeout.ritual.findPath = () => Array.from({ length: 1000 }, (_, index) => ({ x: index % 2 ? 100 : 101, y: 100 }));
for (let i = 0; i < 130 && timeout.ritual.current.stage !== 'blocked'; i++) timeout.ritual.update(250);
assert.equal((await timeoutResult).code, 'ritual_timeout');
assert.equal(timeout.priest.activity, undefined);
assert.ok(ORACLE_RITUAL.timeoutMs <= 30000);

console.log('oracleRitual: passed');
