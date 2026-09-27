import { defaultContent } from '../content/builtin.js';
import { GAME_DAY_SECONDS } from './GameTime.js';

// Presentation math only: never changes simulation time, positions or weather.
export function daylight(time) {
  const phase = ((time % GAME_DAY_SECONDS) + GAME_DAY_SECONDS) % GAME_DAY_SECONDS;
  const darkness = 0.28 * (1 - Math.cos(phase / GAME_DAY_SECONDS * Math.PI * 2)) / 2;
  return { label: phase < 20 || phase >= 110 ? 'Day' : phase < 45 ? 'Dusk' : phase < 85 ? 'Night' : 'Dawn',
    darkness, day: Math.floor(Math.max(0, time) / GAME_DAY_SECONDS) + 1 };
}

export function spriteGeometry(object, loaded, definition = defaultContent.get(object.type), tileSize = 32) {
  const { visual } = definition;
  const requestedInset = loaded ? 0 : definition.kind === 'entity' ? 8 : 2;
  const inset = Math.min(requestedInset, Math.floor((Math.min(visual.width, visual.height) - 1) / 2));
  return { width: visual.width - inset * 2, height: visual.height - inset * 2,
    dx: object.footprint.w * tileSize / 2 - visual.width * visual.anchorX + inset,
    dy: object.footprint.h * tileSize - visual.height * visual.anchorY + inset };
}

export function spriteDepth(object, position = object.position, definition = defaultContent.get(object.type)) {
  return definition.visual.ground ? -1 : position.y + object.footprint.h;
}

// A sprite may extend beyond every occupied cell. Query enough neighboring
// cells to find those sprites, including the bounded two-cell movement easing.
// This is computed once per content catalog, never by scanning world objects.
export function cullingMargin(definitions, tileSize = 32) {
  const margin = { left: 0, top: 0, right: 0, bottom: 0 };
  for (const definition of definitions) {
    if (!['building', 'terrain', 'entity'].includes(definition.kind)) continue;
    const object = { type: definition.id, footprint: definition.footprint };
    const geometry = spriteGeometry(object, true, definition, tileSize);
    const boxes = [geometry];
    if (definition.animation) boxes.push(paddedCharacterGeometry(definition.animation.width, definition.animation.height, geometry));
    const movement = definition.kind === 'entity' ? 2 * tileSize : 0;
    for (const box of boxes) {
      // Rightward overhang means searching to the left of the viewport.
      margin.left = Math.max(margin.left, Math.ceil((box.dx + box.width - object.footprint.w * tileSize + movement) / tileSize));
      margin.right = Math.max(margin.right, Math.ceil((-box.dx + movement) / tileSize));
      margin.top = Math.max(margin.top, Math.ceil((box.dy + box.height - object.footprint.h * tileSize + movement) / tileSize));
      margin.bottom = Math.max(margin.bottom, Math.ceil((-box.dy + movement) / tileSize));
    }
  }
  return margin;
}

export function renderQueryBounds(bounds, margin, mapWidth, mapHeight) {
  return { left: Math.max(0, bounds.left - margin.left), top: Math.max(0, bounds.top - margin.top),
    right: Math.min(mapWidth, bounds.right + margin.right), bottom: Math.min(mapHeight, bounds.bottom + margin.bottom) };
}

// A render-owned track follows the engine's ordered cells at constant speed.
// Two pending cells cover a frame boundary without cutting a blocked corner.
// First sight, teleports and reduced motion do not replay unseen movement.
export function advanceMovement(previous, target, elapsedMs, { cellMs = 450, reducedMotion = false } = {}) {
  const point = value => ({ x: value.x, y: value.y });
  const same = (a, b) => a.x === b.x && a.y === b.y;
  const reset = () => ({ position: point(target), target: point(target), queue: [], moving: false,
    facing: previous ? facingDirection(previous.position, target, previous.facing) : 'south', walkElapsedMs: 0, idleMs: 0 });
  if (!previous || reducedMotion || Math.abs(previous.position.x - target.x)
    + Math.abs(previous.position.y - target.y) > 2.001) return reset();
  const motion = { ...previous, position: point(previous.position), target: point(target), queue: [...previous.queue] };
  if (!same(previous.target, target)) {
    if (motion.queue.length >= 2) return reset();
    motion.queue.push({ position: point(target), cellMs: Number.isFinite(cellMs) && cellMs > 0 ? cellMs : 450 });
    if (previous.idleMs > 200) motion.walkElapsedMs = 0;
  }
  const elapsed = Math.max(0, Math.min(Number(elapsedMs) || 0, 250));
  let remaining = elapsed, travelled = 0;
  while (motion.queue.length && remaining > 0) {
    const next = motion.queue[0];
    const dx = next.position.x - motion.position.x, dy = next.position.y - motion.position.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-8) { motion.position = point(next.position); motion.queue.shift(); continue; }
    const duration = distance * next.cellMs;
    const spent = Math.min(remaining, duration);
    motion.facing = facingDirection(motion.position, next.position, motion.facing);
    motion.position = spent >= duration - 1e-8 ? point(next.position)
      : { x: motion.position.x + dx * spent / duration, y: motion.position.y + dy * spent / duration };
    motion.walkElapsedMs += spent;
    remaining = Math.max(0, remaining - spent);
    travelled += spent;
    if (spent >= duration - 1e-8) motion.queue.shift();
  }
  motion.moving = travelled > 0 || motion.queue.length > 0;
  motion.idleMs = motion.moving ? 0 : previous.idleMs + elapsed;
  return motion;
}

export function facingDirection(from, to, previous = 'south') {
  if (!from || from.x === to.x && from.y === to.y) return previous;
  const dx = to.x - from.x; const dy = to.y - from.y;
  return Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'east' : 'west' : dy > 0 ? 'south' : 'north';
}

// Padded frames preserve the center of the original 32x48 sprite, whose feet
// align to the bottom of one grid cell. Never stretch the 68px sheet frames.
export function paddedCharacterGeometry(width, height, base = { width: 32, height: 48, dx: 0, dy: -16 }) {
  return { width, height, dx: base.dx + (base.width - width) / 2, dy: base.dy + (base.height - height) / 2 };
}
