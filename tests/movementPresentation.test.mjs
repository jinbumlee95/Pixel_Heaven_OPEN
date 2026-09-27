import assert from 'node:assert/strict';
import { advanceMovement } from '../src/game/Presentation.js';

const initial = { x: 10, y: 10 }, east = { x: 11, y: 10 }, south = { x: 11, y: 11 };
const start = advanceMovement(null, initial, 0);
const snapshot = structuredClone(start);
const first = advanceMovement(start, east, 100, { cellMs: 450 });
const second = advanceMovement(first, east, 100, { cellMs: 450 });
assert.ok(Math.abs((first.position.x - 10) - (second.position.x - first.position.x)) < 1e-10,
  'Equal frame time travels equal distance instead of jumping early and easing to a stop');
assert.deepEqual(start, snapshot, 'Presentation motion never mutates a previous track');
assert.deepEqual(east, { x: 11, y: 10 });
assert.equal(first.facing, 'east');
assert.equal(first.moving, true);

function sample(fps, duration) {
  let state = start, elapsed = 0;
  while (elapsed < duration - 1e-8) {
    const step = Math.min(1000 / fps, duration - elapsed);
    state = advanceMovement(state, east, step, { cellMs: 450 }); elapsed += step;
  }
  return state;
}
for (const fps of [30, 60, 144]) {
  assert.ok(Math.abs(sample(fps, 225).position.x - 10.5) < 1e-8, `${fps}Hz midpoint`);
  assert.deepEqual(sample(fps, 450).position, east, `${fps}Hz arrives exactly, with no exponential tail`);
  const idle = advanceMovement(sample(fps, 450), east, 16);
  assert.equal(idle.moving, false);
  assert.equal(idle.queue.length, 0);
}

// A perpendicular target arrives before the old leg has visually completed.
// Finish east first, then south; never draw diagonally across the corner.
const corner = advanceMovement(first, south, 100, { cellMs: 450 });
assert.equal(corner.position.y, 10);
assert.ok(corner.position.x < 11);
const atCorner = advanceMovement(corner, south, 250);
assert.deepEqual(atCorner.position, east);
const turning = advanceMovement(atCorner, south, 100);
assert.equal(turning.position.x, 11);
assert.ok(turning.position.y > 10 && turning.position.y < 11);
assert.equal(turning.facing, 'south');
assert.equal(turning.walkElapsedMs, 550, 'A continuous walking cycle survives cell changes');

let rested = sample(60, 450);
rested = advanceMovement(rested, east, 250);
rested = advanceMovement(rested, east, 250);
const freshTrip = advanceMovement(rested, south, 50);
assert.equal(freshTrip.walkElapsedMs, 50, 'A new trip starts a new walking cycle after a real rest');
assert.deepEqual(advanceMovement(first, south, 16, { reducedMotion: true }).position, south);
assert.equal(advanceMovement(first, south, 16, { reducedMotion: true }).moving, false);
assert.deepEqual(advanceMovement(first, { x: 500, y: 500 }, 16).position, { x: 500, y: 500 });
assert.equal(advanceMovement(null, east, 16).moving, false, 'First sight or viewport re-entry does not replay unseen steps');
const stalled = advanceMovement(start, east, 60000);
assert.ok(stalled.position.x < 11, 'A suspended frame cannot exhaust a movement backlog');
assert.ok(stalled.queue.length <= 2);
console.log('movementPresentation: passed (30/60/144Hz, corners, rests, reduced motion)');
