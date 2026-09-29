import assert from 'node:assert/strict';
import { Renderer, ZOOM_LEVELS } from '../src/game/Renderer.js';
import { createInitialWorld } from '../src/game/World.js';
import { parseChatCommand } from '../src/game/ChatCommands.js';
import { firstFreeCell, itemCommands } from '../src/ui/Equipment.js';

// Zoom keeps the map point under the cursor fixed and scales the logical view.
const renderer = new Renderer(null, createInitialWorld());
let stageScale = 1;
renderer.host = { clientWidth: 640, clientHeight: 320 };
renderer.app = { screen: { width: 640, height: 320 }, renderer: { resize() {} }, stage: { scale: { set(v) { stageScale = v; } } },
  view: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 320 }) } };
renderer.resize();
renderer.camera.center({ x: 1000, y: 1000 });
const before = { x: renderer.camera.x + 160 / 32, y: renderer.camera.y + 80 / 32 };
assert.equal(renderer.zoomBy(1, { x: 160, y: 80 }), true);
assert.equal(renderer.zoom, 1.5);
assert.equal(stageScale, 1.5);
assert.equal(renderer.viewWidth, 640 / 1.5);
assert.ok(Math.abs(renderer.camera.x + 160 / (32 * 1.5) - before.x) < 1e-9, 'cursor point stays in place');
assert.ok(Math.abs(renderer.camera.y + 80 / (32 * 1.5) - before.y) < 1e-9);
for (let i = 0; i < 10; i++) renderer.zoomBy(1);
assert.equal(renderer.zoom, ZOOM_LEVELS.at(-1), 'zoom is clamped');
for (let i = 0; i < 10; i++) renderer.zoomBy(-1);
assert.equal(renderer.zoom, ZOOM_LEVELS[0]);
assert.equal(renderer.camera.width, 640 / 0.5 / 32, 'zooming out shows more tiles');
assert.deepEqual(parseChatCommand('zoom in'), { type: 'meta', name: 'zoomIn' });
assert.deepEqual(parseChatCommand('축소'), { type: 'meta', name: 'zoomOut' });

// Equipment panel helpers suggest valid placements and every supported command.
const equipment = { width: 3, height: 3, items: [
  { id: 'eq-1', definition: 'greatsword', grade: 'common', location: 'grid', x: 0, y: 0, rotated: false, locked: false, durability: 100 },
  { id: 'eq-2', definition: 'shortblade', grade: 'rare', location: 'store', locked: false, durability: 80 },
] };
assert.equal(firstFreeCell(equipment, equipment.items[1]), 'C1', 'the 1×3 blade fits beside the 2×4 greatsword column');
assert.deepEqual(itemCommands(equipment, equipment.items[1]), ['place eq-2 C1', 'compare eq-2', 'lock eq-2', 'repair eq-2', 'sell eq-2', 'salvage eq-2']);
equipment.items[0].locked = true;
assert.deepEqual(itemCommands(equipment, equipment.items[0]), ['remove eq-1', 'compare eq-1', 'unlock eq-1'], 'locked gear offers no sell/salvage');
for (const command of [...itemCommands(equipment, equipment.items[1]), 'unlock eq-1', 'remove eq-1', 'auto attack', 'expand grid', 'equipment goals', 'close grid'])
  assert.notEqual(parseChatCommand(command)?.type ?? 'none', 'invalid', command);
console.log('uiControls: zoom and equipment commands passed');
