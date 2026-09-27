import { cellKey, isInSettlement } from './World.js';

export const WANDER_RULES = Object.freeze({
  stepMs: 450, restMinMs: 4000, restMaxMs: 9000,
  minLegCells: 3, maxLegCells: 12, maxStrollCells: 6,
  routeBudget: 512, maxElapsedMs: 250,
});
// Retained for older callers; this is a minimum rest, not a movement interval.
export const WANDER_INTERVAL_MS = WANDER_RULES.restMinMs;
const STEPS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const VISITS = Object.freeze({ house: 'visit_house', farmland: 'visit_field', altar: 'visit_altar' });
const copyPosition = ({ x, y }) => ({ x, y });
const sample = random => Math.max(0, Math.min(1 - Number.EPSILON, random()));

function rest(entity, random, carryMs = 0) {
  entity.wanderPlan = { phase: 'resting', intent: 'rest', destination: null, route: [], routeIndex: 0,
    remainingMs: WANDER_RULES.restMinMs
      + Math.floor(sample(random) * (WANDER_RULES.restMaxMs - WANDER_RULES.restMinMs + 1)) + carryMs };
}

// The oracle can interrupt immediately without retaining a stale route. The
// small, serializable plan belongs to presentation movement, never resource math.
export function pauseWander(entity) {
  entity.wanderElapsed = 0;
  entity.wanderPlan = { phase: 'paused', intent: 'oracle', destination: null, route: [], routeIndex: 0, remainingMs: 0 };
}

function reserved(world, position) {
  return world.state.sanctuary?.reservedCells?.some(cell => cell.x === position.x && cell.y === position.y);
}

// One local search supplies both meaningful visit destinations and their paths.
// It never scans collections of buildings or the 2000×2000 map. Both occupied
// and free cells count toward the budget, and paths cannot cut footprint corners.
function chooseRoute(world, entity, random) {
  const village = world.getVillage(entity.villageId);
  if (!village) return null;
  const start = copyPosition(entity.position);
  const nodes = [{ ...start, parent: -1, depth: 0 }];
  const visited = new Set([cellKey(start.x, start.y)]);
  const choices = { visit_house: [], visit_field: [], visit_altar: [], stroll: [] };
  search: for (let cursor = 0; cursor < nodes.length; cursor++) {
    const node = nodes[cursor];
    if (node.depth >= WANDER_RULES.minLegCells && !reserved(world, node)) {
      const nearby = new Set();
      for (const [dx, dy] of STEPS) {
        const object = world.state.occupied.get(cellKey(node.x + dx, node.y + dy));
        if (object?.villageId === village.id && VISITS[object.type]) nearby.add(VISITS[object.type]);
      }
      for (const intent of nearby) choices[intent].push(cursor);
      if (node.depth <= WANDER_RULES.maxStrollCells) choices.stroll.push(cursor);
    }
    if (node.depth >= WANDER_RULES.maxLegCells) continue;
    for (const [dx, dy] of STEPS) {
      const next = { x: node.x + dx, y: node.y + dy };
      const key = cellKey(next.x, next.y);
      if (visited.has(key)) continue;
      if (visited.size >= WANDER_RULES.routeBudget) break search;
      visited.add(key);
      if (!isInSettlement(village, next.x, next.y)
        || (entity.type !== 'priest' && reserved(world, next))
        || !world.isAreaEmpty(village, next, entity.footprint, { forMovement: true })) continue;
      nodes.push({ ...next, parent: cursor, depth: node.depth + 1 });
    }
  }
  const intents = Object.keys(choices).filter(intent => choices[intent].length);
  if (!intents.length) return null;
  // The Priest visits the sanctuary more often, using the same generic planner.
  if (entity.type === 'priest' && choices.visit_altar.length) intents.push('visit_altar');
  const intent = intents[Math.floor(sample(random) * intents.length)];
  const candidates = choices[intent];
  let index = candidates[Math.floor(sample(random) * candidates.length)];
  const destination = copyPosition(nodes[index]);
  const route = [];
  for (; nodes[index].parent >= 0; index = nodes[index].parent) route.push(copyPosition(nodes[index]));
  return { intent, destination, route: route.reverse(), routeIndex: 0 };
}

// Shared by the named Priest and the fixed decorative village pawns. A visit is
// only visual: it neither creates a worker nor produces resources. Time and RNG
// are consumed only by this movement clock, independently of simulation ticks.
export function updateWander(world, elapsedMs, random = Math.random) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('Invalid elapsed time');
  if (elapsedMs === 0) return;
  const elapsed = Math.min(elapsedMs, WANDER_RULES.maxElapsedMs);
  const due = [];
  for (const entity of world.state.entities.values()) {
    if (entity.type === 'hero' || entity.hidden) continue;
    if (entity.activity === 'oracle') {
      if (entity.wanderPlan?.phase !== 'paused') pauseWander(entity);
      continue;
    }
    entity.wanderElapsed = 0;
    if (!entity.wanderPlan || entity.wanderPlan.phase === 'paused') rest(entity, random);
    const plan = entity.wanderPlan;
    plan.remainingMs -= elapsed;
    if (plan.remainingMs <= 0) due.push(entity);
  }
  // Process crossed deadlines in time order, even when a slower frame crosses
  // two pawns' deadlines together. RNG and collision decisions stay consistent.
  due.sort((a, b) => a.wanderPlan.remainingMs - b.wanderPlan.remainingMs
    || a.id.localeCompare(b.id));
  for (const entity of due) {
    let plan = entity.wanderPlan;
    if (plan.phase === 'resting') {
      const visit = chooseRoute(world, entity, random);
      if (!visit) { rest(entity, random, plan.remainingMs); continue; }
      entity.wanderPlan = plan = { phase: 'walking', ...visit, remainingMs: plan.remainingMs };
    }
    if (plan.routeIndex >= plan.route.length) { rest(entity, random, plan.remainingMs); continue; }
    const next = plan.route[plan.routeIndex];
    const previous = entity.position;
    if (!next || Math.abs(previous.x - next.x) + Math.abs(previous.y - next.y) !== 1
      || !world.moveEntity(entity, next)) {
      // A new building or passing pawn can invalidate a route. Wait before
      // planning again instead of jittering/retrying against it every frame.
      rest(entity, random, plan.remainingMs);
      continue;
    }
    entity.moveDurationMs = WANDER_RULES.stepMs;
    entity.facing = next.x === previous.x ? (next.y > previous.y ? 'south' : 'north')
      : (next.x > previous.x ? 'east' : 'west');
    plan.routeIndex++;
    plan.remainingMs += WANDER_RULES.stepMs;
  }
}
