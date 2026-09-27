import assert from 'node:assert/strict';
import { daylight, spriteGeometry, spriteDepth, cullingMargin, renderQueryBounds,
  advanceMovement, facingDirection, paddedCharacterGeometry } from '../src/game/Presentation.js';
import { APPEARANCE, CHARACTER_ANIMATIONS } from '../src/game/Renderer.js';
import { defaultContent } from '../src/content/builtin.js';
import { readFile } from 'node:fs/promises';

assert.equal(daylight(0).darkness, 0);
assert.equal(daylight(60).darkness, 0.28);
assert.equal(daylight(120).day, 2);
assert.equal(daylight(120).darkness, 0);
for (let time = 0; time < 1000; time++) assert.ok(daylight(time).darkness >= 0 && daylight(time).darkness <= 0.28);
const pawn = { type: 'priest', footprint: { w: 1, h: 1 } };
assert.deepEqual(spriteGeometry(pawn, true), { width: 32, height: 48, dx: 0, dy: -16 });
assert.deepEqual(spriteGeometry(pawn, false), { width: 16, height: 32, dx: 8, dy: -8 });
const house = { type: 'house', footprint: { w: 3, h: 2 }, position: { x: 10, y: 20 } };
const temple = { type: 'temple', footprint: { w: 6, h: 4 }, position: { x: 10, y: 20 } };
const tree = { type: 'forest', footprint: { w: 1, h: 1 }, position: { x: 10, y: 20 } };
const worldtree = { type: 'world_tree', footprint: { w: 6, h: 4 }, position: { x: 10, y: 20 } };
assert.deepEqual(spriteGeometry(house, true), { width: 96, height: 96, dx: 0, dy: -32 });
assert.deepEqual(spriteGeometry(temple, true), { width: 192, height: 192, dx: 0, dy: -64 });
assert.deepEqual(spriteGeometry(tree, true), { width: 64, height: 64, dx: -16, dy: -32 });
assert.deepEqual(spriteGeometry(worldtree, true), { width: 320, height: 352, dx: -64, dy: -224 });
assert.equal(spriteDepth(house), 22);
assert.equal(spriteDepth(temple), 24);
assert.equal(spriteDepth(tree), 21, 'trees participate in footpoint depth sorting');
assert.equal(spriteDepth(worldtree), 24, 'the giant crown does not change its ground-level depth');
assert.equal(spriteDepth({ ...tree, type: 'farmland' }), -1, 'flat fields stay below actors');
// Appearance and collision are independent; drawing never rewrites a footprint.
const snapshot = structuredClone(temple);
const custom = { kind: 'building', visual: { width: 128, height: 160, anchorX: 0.25, anchorY: 0.75 } };
assert.deepEqual(spriteGeometry(temple, true, custom), { width: 128, height: 160, dx: 64, dy: 8 });
assert.deepEqual(temple, snapshot);
const tiny = { kind: 'entity', visual: { width: 1, height: 1, anchorX: 0.5, anchorY: 1 } };
assert.deepEqual(spriteGeometry(pawn, false, tiny), { width: 1, height: 1, dx: 15.5, dy: 31 },
  'small data-defined placeholders retain positive dimensions');
const margin = cullingMargin(defaultContent.list());
assert.deepEqual(margin, { left: 3, top: 3, right: 3, bottom: 7 });
assert.deepEqual(renderQueryBounds({ left: 0, top: 0, right: 20, bottom: 15 }, margin, 2000, 2000),
  { left: 0, top: 0, right: 23, bottom: 22 });
assert.deepEqual(renderQueryBounds({ left: 1980, top: 1985, right: 2000, bottom: 2000 }, margin, 2000, 2000),
  { left: 1977, top: 1982, right: 2000, bottom: 2000 });
const tall = { id: 'test_roof', kind: 'building', footprint: { w: 2, h: 2 },
  visual: { width: 96, height: 256, anchorX: 0.5, anchorY: 1 } };
assert.deepEqual(cullingMargin([tall]), { left: 1, top: 0, right: 1, bottom: 6 }, 'large roofs extend the query below the camera');
const previous = { x: 1, y: 1 }; const target = { x: 2, y: 1 };
const motion = advanceMovement(null, previous, 0);
const halfway = advanceMovement(motion, target, 50);
assert.ok(halfway.position.x > 1 && halfway.position.x < 2);
assert.deepEqual(previous, { x: 1, y: 1 }); assert.deepEqual(target, { x: 2, y: 1 });
assert.deepEqual(advanceMovement(motion, target, 50, { reducedMotion: true }).position, target);
assert.deepEqual(advanceMovement(motion, { x: 100, y: 100 }, 50).position, { x: 100, y: 100 });
// Art configuration points at genuine, correctly sized PNGs, not silent fallbacks.
for (const [type, style] of Object.entries(APPEARANCE)) {
  if (!style.path) continue;
  const bytes = await readFile(new URL(`../${style.path}`, import.meta.url));
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [style.width, style.height],
    `${type} displays its delivered native canvas without rescaling`);
}
assert.equal(facingDirection({ x: 1, y: 1 }, { x: 2, y: 1 }), 'east');
assert.equal(facingDirection({ x: 1, y: 1 }, { x: 0, y: 1 }), 'west');
assert.equal(facingDirection({ x: 1, y: 1 }, { x: 1, y: 0 }), 'north');
assert.equal(facingDirection({ x: 1, y: 1 }, { x: 1, y: 2 }), 'south');
assert.equal(facingDirection({ x: 1, y: 1 }, { x: 1, y: 1 }, 'north'), 'north');
assert.deepEqual(paddedCharacterGeometry(68, 68), { width: 68, height: 68, dx: -18, dy: -26 });
const metadata = JSON.parse(await readFile(new URL('../assets/characters/priest.frames.json', import.meta.url), 'utf8'));
const layout = JSON.parse(await readFile(new URL('../assets/characters/' + metadata.sheetLayout, import.meta.url), 'utf8'));
const animation = CHARACTER_ANIMATIONS.priest;
assert.equal(animation.width, metadata.frameWidth);
assert.equal(animation.duration * 1000, metadata.frameDurationMs);
const sheet = await readFile(new URL('../' + animation.path, import.meta.url));
assert.equal(sheet.readUInt32BE(16), layout.spritesheet.sheet_size.width);
assert.equal(sheet.readUInt32BE(20), layout.spritesheet.sheet_size.height);
for (const [direction, row] of Object.entries(animation.walkRows)) {
  const source = layout.spritesheet.rows.find(entry => entry.row === row);
  assert.equal(source.direction, direction);
  assert.equal(source.animation_group_id, metadata.selectedAnimationGroup, 'use selected v3, not old animation rows');
  assert.equal(source.frame_count, animation.frames);
}
console.log('presentation: passed');
