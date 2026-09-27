import { MAP_WIDTH, MAP_HEIGHT } from '../state/worldState.js';

export const LANDSCAPE_VERSION = 1;
export const LANDSCAPE_RADIUS = 48;
const key = (x, y) => `${x},${y}`;
const hash = (x, y) => {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
export function waterBlocked(state, x, y) {
  const type = state.groundTiles?.get(key(x, y))?.type;
  return typeof type === 'string' && type.startsWith('river_');
}

// One bounded home landscape, stored as sparse terrain/ground entries. No
// global grid allocation, per-tick generation or renderer-only collision map.
export function initializeLandscape(world) {
  if (world.state.landscape?.version === LANDSCAPE_VERSION) return false;
  const home = world.getVillage('home');
  if (!home) return false;
  const { x: cx, y: cy } = home.anchor;
  const protectedCells = new Set();
  const protect = (position, footprint = { w: 1, h: 1 }, margin = 2) => {
    for (let y = position.y - margin; y < position.y + footprint.h + margin; y++)
      for (let x = position.x - margin; x < position.x + footprint.w + margin; x++) protectedCells.add(key(x, y));
  };
  for (const collection of [world.state.buildings, world.state.terrain, world.state.entities])
    for (const object of collection.values()) protect(object.position, object.footprint, object.type === 'forest' ? 0 : 2);
  for (const tile of world.state.groundTiles.values()) protect(tile.position);
  for (const job of world.state.work?.jobs ?? []) if (job.status === 'working') protect(job.position, job.footprint);
  for (const cell of world.state.sanctuary?.reservedCells ?? []) protect(cell);
  for (const plan of world.state.eventQueue ?? []) for (const work of plan.battlePreparation?.works ?? []) protect(work.position);
  for (const object of [...(world.state.combat?.units ?? []), ...(world.state.combat?.works ?? [])]) protect(object.position);
  const inMap = (x, y) => x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT;
  const riverCenter = dy => -15 + Math.sin(dy / 9) * 3 + Math.sin(dy / 21) * 2;
  const waterCorner = (x, y) => {
    const dx = x - cx, dy = y - cy;
    const width = 2.3 * Math.min(1, Math.max(0, (LANDSCAPE_RADIUS - Math.abs(dy)) / 5));
    if (Math.abs(dx - riverCenter(dy)) > width || width === 0) return false;
    // A protected cell protects all its corners, keeping shores continuous.
    return ![[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([ox, oy]) => protectedCells.has(key(x + ox, y + oy)));
  };
  for (let dy = -LANDSCAPE_RADIUS; dy <= LANDSCAPE_RADIUS; dy++) {
    for (let dx = -22; dx <= -6; dx++) {
      const x = cx + dx, y = cy + dy;
      if (!inMap(x, y)) continue;
      // File names encode NW/NE/SW/SE upper-land bits, not sheet positions.
      const mask = [[0, 0], [1, 0], [0, 1], [1, 1]].reduce((value, [ox, oy], i) =>
        value | (waterCorner(x + ox, y + oy) ? 0 : 1 << i), 0);
      if (mask !== 15 && !world.state.groundTiles.has(key(x, y)))
        world.state.groundTiles.set(key(x, y), { type: `${[0, -18, 18].includes(dy) ? 'ford' : 'river'}_${mask}`, villageId: home.id, position: { x, y } });
    }
  }
  const clear = (x, y, w, h) => {
    for (let oy = -1; oy <= h; oy++) for (let ox = -1; ox <= w; ox++) {
      const px = x + ox, py = y + oy;
      if (!inMap(px, py) || protectedCells.has(key(px, py)) || world.state.occupied.has(key(px, py)) || waterBlocked(world.state, px, py)) return false;
    }
    return true;
  };
  const add = (type, x, y) => {
    const footprint = world.content.get(type).footprint;
    if (!clear(x, y, footprint.w, footprint.h)) return;
    const object = { id: `terrain_${world.nextId++}`, type, villageId: home.id, position: { x, y }, footprint };
    world.state.terrain.set(object.id, object); world.occupy(object);
  };
  // Rock ridges outside the central building clearing. Gaps preserve approach
  // corridors; their 3×2 footprint remains distinct from the 160px silhouette.
  for (const [dx, dy] of [[12,-3],[10,-8],[17,-8],[22,-10],[25,-15],[21,-21],[15,-24],[9,-27],[-4,-30],[-28,-24],[-31,-16],[29,9],[32,17],[25,26]])
    add('mountain', cx + dx, cy + dy);
  // Deterministic clumps with 2-cell spacing, not uniformly sprinkled trees.
  for (let dy = -38; dy <= 38; dy += 2) for (let dx = -38; dx <= 38; dx += 2) {
    if (Math.hypot(dx, dy) < 10 || Math.abs(dy) < 2 || Math.abs(dx) < 2) continue;
    const cluster = Math.sin(dx / 6) * Math.cos(dy / 7) + Math.sin((dx + dy) / 9);
    if (cluster < 0.1 || hash(dx + 271, dy + 811) > 0.64) continue;
    add(hash(dx, dy) > 0.45 ? 'pine' : 'forest', cx + dx, cy + dy);
  }
  world.state.landscape = { version: LANDSCAPE_VERSION };
  world.state.groundRevision = (world.state.groundRevision ?? 0) + 1;
  return true;
}
