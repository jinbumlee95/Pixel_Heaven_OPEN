import { cellKey, isInSettlement } from './World.js';
import { pauseWander } from './Wander.js';

export const ORACLE_RITUAL = Object.freeze({
  stepMs: 450, receivingMs: 1800, timeoutMs: 30000,
  maxElapsedMs: 250, retryMs: 500, maxRouteAttempts: 4, maxVisitedCells: 4096,
});
const STEPS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const sameCell = (a, b) => a.x === b.x && a.y === b.y;
const position = value => value ? { x: value.x, y: value.y } : null;

function failure(code) {
  const error = new Error(`Oracle ritual: ${code}`);
  error.code = `ritual_${code}`;
  error.messageKey = `oracle.ritual.failure.${code}`;
  error.messageParams = {};
  return error;
}

// The ritual only moves the existing Priest. It never reads oracle meaning or
// applies effects. The caller may interpret the message after receive resolves.
export class OracleRitual {
  constructor(world, priest, { onStage = () => {} } = {}) {
    this.world = world;
    this.priest = priest;
    this.onStage = onStage;
    this.active = null;
    this.stopped = false;
    this.status = { stage: 'idle', messageId: null, progress: 0, target: null };
  }

  get current() {
    return { ...this.status, target: position(this.status.target), position: position(this.priest?.position) };
  }

  publish(stage, progress = 0, extra = {}) {
    this.status = { ...this.status, stage, progress, ...extra };
    this.onStage(this.current);
  }

  sanctuary() {
    const sanctuary = this.world.state.sanctuary;
    const village = this.world.getVillage(this.priest?.villageId);
    const find = id => this.world.state.buildings.get(id) ?? this.world.state.terrain.get(id);
    const altar = find(sanctuary?.altarId);
    const tree = find(sanctuary?.treeId);
    if (!sanctuary || !village || !altar || !tree
      || this.world.state.entities.get(this.priest?.id) !== this.priest
      || !isInSettlement(village, sanctuary.reception?.x, sanctuary.reception?.y)
      || altar.villageId !== village.id || tree.villageId !== village.id) return null;
    return { village, altar, target: position(sanctuary.reception) };
  }

  receive(entry) {
    if (this.stopped) return Promise.reject(failure('stopped'));
    if (this.active) return Promise.reject(failure('busy'));
    if (!Number.isInteger(entry?.id) || entry.id < 1 || typeof entry.message !== 'string'
      || !entry.message.trim() || entry.message.length > 500) return Promise.reject(failure('invalid'));
    const sanctuary = this.sanctuary();
    if (!sanctuary) {
      this.publish('blocked', 0, { messageId: entry.id, target: null, code: 'ritual_missing_sanctuary' });
      return Promise.reject(failure('missing_sanctuary'));
    }
    return new Promise((resolve, reject) => {
      // A movement command reserves its grid cell before the sprite reaches it.
      // Let that last leg finish before issuing an oracle step or receiving at
      // an already-reserved altar cell. The bounded wait also covers an oracle
      // canceled and replaced mid-step, without reading renderer-owned state.
      const initialTransitMs = this.priest.wanderPlan?.phase === 'walking'
        || Number.isFinite(this.priest.moveDurationMs) && this.priest.moveDurationMs > 0
        ? ORACLE_RITUAL.stepMs : 0;
      this.active = { messageId: entry.id, target: sanctuary.target, resolve, reject,
        elapsedMs: 0, transitMs: initialTransitMs, receivingElapsedMs: 0, retryAt: 0,
        attempts: 0, travelled: 0, path: null, settled: false };
      this.priest.activity = 'oracle';
      pauseWander(this.priest);
      this.priest.moveDurationMs = ORACLE_RITUAL.stepMs;
      this.publish('approaching', 0, { messageId: entry.id, target: sanctuary.target, code: null });
    });
  }

  // Cardinal BFS cannot cut through footprint corners. Both candidate cells
  // and each footprint are checked against the Priest's settlement boundary.
  findPath(target, village) {
    const start = position(this.priest.position);
    if (sameCell(start, target)) return [];
    const nodes = [{ ...start, parent: -1 }];
    const visited = new Set([cellKey(start.x, start.y)]);
    for (let cursor = 0; cursor < nodes.length; cursor++) {
      const current = nodes[cursor];
      for (const [dx, dy] of STEPS) {
        const next = { x: current.x + dx, y: current.y + dy };
        const key = cellKey(next.x, next.y);
        if (visited.has(key) || !isInSettlement(village, next.x, next.y)) continue;
        if (visited.size >= ORACLE_RITUAL.maxVisitedCells) return null;
        visited.add(key);
        if (!this.world.isAreaEmpty(village, next, this.priest.footprint, { forMovement: true })) continue;
        const index = nodes.push({ ...next, parent: cursor }) - 1;
        if (sameCell(next, target)) {
          const path = [];
          for (let node = index; nodes[node].parent >= 0; node = nodes[node].parent) path.push(position(nodes[node]));
          return path.reverse();
        }
      }
    }
    return null;
  }

  faceAltar(altar) {
    const dx = altar.position.x + (altar.footprint.w - 1) / 2 - this.priest.position.x;
    const dy = altar.position.y + (altar.footprint.h - 1) / 2 - this.priest.position.y;
    this.priest.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'south' : 'north');
  }

  release() {
    if (this.priest?.activity !== 'oracle') return;
    delete this.priest.activity;
    pauseWander(this.priest);
  }

  fail(code) {
    const request = this.active;
    if (!request) return;
    this.active = null;
    this.release();
    this.publish('blocked', 0, { code: `ritual_${code}` });
    if (!request.settled) request.reject(failure(code));
  }

  update(elapsedMs) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('Invalid elapsed time');
    const request = this.active;
    if (!request || this.stopped || elapsedMs === 0) return;
    const sanctuary = this.sanctuary();
    if (!sanctuary || !sameCell(sanctuary.target, request.target)) { this.fail('missing_sanctuary'); return; }
    if (request.settled) { this.faceAltar(sanctuary.altar); return; }
    const elapsed = Math.min(elapsedMs, ORACLE_RITUAL.maxElapsedMs);
    request.elapsedMs += elapsed;
    if (request.elapsedMs >= ORACLE_RITUAL.timeoutMs) { this.fail('timeout'); return; }

    if (this.status.stage === 'approaching') {
      // Cell occupancy is authoritative immediately; let the visible final leg
      // finish before turning toward the altar and beginning reception.
      request.transitMs = Math.max(0, request.transitMs - elapsed);
      if (request.transitMs > 0) return;
      if (sameCell(this.priest.position, request.target)) {
        this.faceAltar(sanctuary.altar);
        this.publish('receiving');
        return;
      }
      if (!request.path) {
        if (request.elapsedMs < request.retryAt) return;
        request.attempts++;
        request.path = this.findPath(request.target, sanctuary.village);
        if (!request.path) {
          if (request.attempts >= ORACLE_RITUAL.maxRouteAttempts) { this.fail('blocked'); return; }
          request.retryAt = request.elapsedMs + ORACLE_RITUAL.retryMs;
          return;
        }
      }
      // At most one physical step per frame; a tab resume cannot teleport the
      // Priest or skip the visible procession, even with a huge elapsed value.
      const next = request.path[0];
      const previous = position(this.priest.position);
      if (!next || Math.abs(next.x - previous.x) + Math.abs(next.y - previous.y) !== 1
        || !this.world.moveEntity(this.priest, next)) {
        request.path = null;
        if (request.attempts >= ORACLE_RITUAL.maxRouteAttempts) { this.fail('blocked'); return; }
        request.retryAt = request.elapsedMs + ORACLE_RITUAL.retryMs;
        return;
      }
      request.path.shift();
      request.transitMs = ORACLE_RITUAL.stepMs;
      request.travelled++;
      this.priest.facing = next.x !== previous.x ? (next.x > previous.x ? 'east' : 'west')
        : (next.y > previous.y ? 'south' : 'north');
      this.publish('approaching', request.travelled / (request.travelled + request.path.length));
      return;
    }

    if (this.status.stage === 'receiving') {
      if (!sameCell(this.priest.position, request.target)) { this.fail('blocked'); return; }
      request.receivingElapsedMs += elapsed;
      this.faceAltar(sanctuary.altar);
      const progress = Math.min(1, request.receivingElapsedMs / ORACLE_RITUAL.receivingMs);
      if (progress < 1) { this.publish('receiving', progress); return; }
      request.settled = true;
      this.publish('interpreting', 1);
      request.resolve(this.current);
    }
  }

  // Game calls this in its oracle pipeline's finally block, after the AI or
  // mock has finished. Until then the Priest waits and keeps facing the altar.
  finish(messageId) {
    if (!this.active || this.active.messageId !== messageId || !this.active.settled) return false;
    this.active = null;
    this.release();
    this.publish('idle', 0, { messageId: null, target: null, code: null });
    return true;
  }

  cancel(messageId, code = 'ritual_stopped') {
    if (!this.active || this.active.messageId !== messageId) return false;
    const reason = code.replace(/^ritual_/, '');
    this.fail(['stopped', 'timeout', 'blocked'].includes(reason) ? reason : 'stopped');
    return true;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    const request = this.active;
    this.active = null;
    this.release();
    this.publish('idle', 0, { messageId: null, target: null, code: 'ritual_stopped' });
    if (request && !request.settled) request.reject(failure('stopped'));
  }
}
