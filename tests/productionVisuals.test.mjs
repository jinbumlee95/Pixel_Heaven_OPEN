import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { COMBAT_VISUALS, DEFENSE_VISUALS, EFFECT_VISUALS, advanceCombatAnimation,
  defenseFrame, DIRECTIONS } from '../src/content/combatVisuals.js';
import { VILLAGER_VARIANT, SUPPLEMENTAL_IMAGES, SUPPLEMENTAL_SHEETS, villagerVariant } from '../src/content/productionVisuals.js';
import { defaultContent } from '../src/content/builtin.js';
import { Renderer } from '../src/game/Renderer.js';

const json = async path => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const dimensions = async path => {
  const bytes = await readFile(new URL(`../${path}`, import.meta.url));
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
};
for (const [role, config] of Object.entries(COMBAT_VISUALS)) for (const [side, paths] of Object.entries(config.sides)) {
  const delivered = await json(config.manifest);
  assert.deepEqual(paths, delivered.paths);
  assert.deepEqual(config.pivot, delivered.pivot);
  assert.deepEqual(config.frameCounts, delivered.frameCounts);
  assert.deepEqual(config.frameDurationsMs, delivered.frameDurationsMs);
  assert.deepEqual(config.idleColumns, delivered.idleColumns);
  assert.deepEqual(config.walkRows, delivered.walkRows);
  for (const [action, path] of Object.entries(paths)) {
    assert.deepEqual(await dimensions(path), [68 * 8, 68 * (action === 'walk' ? 5 : 4)]);
  }
}
for (const [type, config] of Object.entries(DEFENSE_VISUALS)) {
  const delivered = await json(`assets/tiles/combat-v2/${type}.frames.json`);
  assert.equal(config.path, delivered.file);
  assert.deepEqual(config.pivot, delivered.pivot);
  assert.deepEqual(await dimensions(config.path), [config.width * 3, config.height]);
}
for (const [type, config] of Object.entries(EFFECT_VISUALS)) {
  const delivered = await json(`assets/ui/combat/${type}.frames.json`);
  assert.deepEqual([config.frames, config.durationMs], [delivered.frames, delivered.frameDurationMs]);
  assert.deepEqual(config.pivot, delivered.pivot);
  assert.deepEqual(await dimensions(config.path), [config.width * config.frames, config.height * (config.directional ? 4 : 1)]);
}
for (const config of Object.values(SUPPLEMENTAL_SHEETS)) {
  assert.deepEqual(await dimensions(config.path), [config.width * config.frames, config.height * (config.rows ?? 1)]);
}
for (const [key, path] of Object.entries(SUPPLEMENTAL_IMAGES)) {
  const size=key.includes('house')?[96,96]:key.includes('temple')?[192,192]:[32,32];
  assert.deepEqual(await dimensions(path),size,key);
}
for (const [id, config] of [['villager_a', defaultContent.get('villager').animation], ['villager_b', VILLAGER_VARIANT]]) {
  const delivered = await json(`assets/characters/${id}.frames.json`);
  assert.equal(config.path, delivered.paths.walk);
  assert.deepEqual(config.walkRows, delivered.walkRows);
  assert.deepEqual(config.idleColumns, delivered.idleColumns);
  assert.deepEqual(await dimensions(config.path), [68 * 8, 68 * 5]);
}
assert.notEqual(villagerVariant({ type: 'villager', id: 'entity_10' }), villagerVariant({ type: 'villager', id: 'entity_11' }));
assert.equal(villagerVariant({ type: 'villager', id: 'x', visualVariant: 'b' }), 'villager_b');
assert.equal(villagerVariant({ type: 'hero', id: 'x' }), 'hero');

const unit = { id: 'enemy1', role: 'archer', side: 'enemy', hp: 19, maxHp: 19, status: 'ready', nextAttackAt: 2,
  position: { x: 1000, y: 1000 }, targetId: 'home1' };
let track = advanceCombatAnimation(null, unit, 16);
assert.equal(track.action, 'idle');
unit.status = 'attacking'; unit.nextAttackAt = 5;
track = advanceCombatAnimation(track, unit, 16);
assert.equal(track.action, 'attack'); assert.equal(track.elapsedMs, 0);
const immutable = structuredClone(track);
const next = advanceCombatAnimation(track, unit, 100);
assert.deepEqual(track, immutable); assert.equal(next.elapsedMs, 100);
track = next;
for (let i = 0; i < 10; i++) track = advanceCombatAnimation(track, unit, 100);
assert.equal(track.action, 'idle', 'a persistent attacking status must not loop an already committed attack');
unit.hp -= 4; track = advanceCombatAnimation(track, unit, 16);
assert.equal(track.action, 'hit');
for (let i = 0; i < 4; i++) track = advanceCombatAnimation(track, unit, 100);
assert.equal(track.action, 'idle');
unit.hp = 0; track = advanceCombatAnimation(track, unit, 16);
assert.equal(track.action, 'down');
for (let i = 0; i < 20; i++) track = advanceCombatAnimation(track, unit, 100);
assert.equal(track.action, 'down', 'fallen actors hold the final down pose');
assert.equal(defenseFrame({ type: 'cover', hp: 14, maxHp: 14 }), 0);
assert.equal(defenseFrame({ type: 'cover', hp: 10, maxHp: 14 }), 1);
assert.equal(defenseFrame({ type: 'cover', hp: 0, maxHp: 14 }), 2);
assert.equal(defenseFrame({ type: 'trap', triggered: true }), 1);
assert.equal(defenseFrame({ type: 'trap', triggered: true, disarmed: true }), 2);

// Feed real engine-shaped state through the renderer boundary. No PIXI/WebGL
// dependency is needed to assert action frames, side symbols and state purity.
const point = () => ({ set(x, y) { this.x = x; this.y = y; } });
class Sprite { constructor(texture) { this.texture = texture; this.position = point(); } destroy() { this.destroyed = true; } }
class Graphics extends Sprite {
  addChild() {} clear() { return this; } beginFill() { return this; } drawRect() { return this; }
  endFill() { return this; } lineStyle() { return this; } drawCircle() { return this; }
}
globalThis.PIXI = { Sprite, Graphics };
const home = { ...unit, id: 'home1', side: 'home', hp: 19, status: 'ready', position: { x: 999, y: 1000 } };
unit.hp = 19; unit.status = 'attacking';
const combat = { units: [unit, home, { ...home, id: 'hero-hidden', isHero: true, hidden: true }],
  works: [{ id: 'cover', type: 'cover', hp: 10, maxHp: 14, position: { x: 999, y: 999 } }], effects: [] };
const world = { state: { time: 2, combat } };
const renderer = new Renderer(null, world);
renderer.camera.width = 10; renderer.camera.height = 10;
renderer.camera.x = 995; renderer.camera.y = 995;
renderer.objects = { addChild() {} }; renderer.combatEffects = new Graphics();
renderer.app = { screen: { width: 320, height: 320 } };
const sheets = (key, frames) => DIRECTIONS.map(direction => Array.from({ length: frames }, (_, i) => `${key}:${direction}:${i}`));
for (const side of ['home', 'enemy']) {
  const config = COMBAT_VISUALS.archer;
  renderer.animations.set(`${side}:archer`, { config: { duration: 0.12, frames: 6 },
    directions: Object.fromEntries(DIRECTIONS.map(direction => [direction,
      { idle: `${side}:${direction}:idle`, walk: sheets(side, 6)[DIRECTIONS.indexOf(direction)] }])) });
  for (const action of ['attack', 'hit', 'down']) renderer.sheetFrames.set(`${side}:archer:${action}`, {
    config: { frames: config.frameCounts[action], durationMs: config.frameDurationsMs[action] },
    rows: sheets(`${side}:${action}`, config.frameCounts[action]) });
}
renderer.sheetFrames.set('badges', { rows: [['home-badge', 'enemy-badge', 'ally-badge']] });
renderer.sheetFrames.set('work:cover', { config: DEFENSE_VISUALS.cover, rows: [['intact', 'damaged', 'broken']] });
const before = structuredClone(world.state);
renderer.renderCombat(995, 995, 16);
assert.equal(renderer.combatSprites.has('hero-hidden'), false, 'a hero assigned elsewhere is never rendered twice');
const enemy = renderer.combatSprites.get(unit.id);
assert.equal(enemy.artSprite.texture, 'enemy:attack:west:0', 'the attack faces its target');
assert.equal(enemy.artSprite.width, 68); assert.equal(enemy.artSprite.position.x, -18);
assert.equal(enemy.artSprite.position.y, -26);
assert.equal(enemy.badgeSprite.texture, 'enemy-badge');
assert.equal(renderer.combatSprites.get('cover').artSprite.texture, 'damaged');
renderer.renderCombat(995, 995, 100);
assert.equal(enemy.artSprite.texture, 'enemy:attack:west:1');
renderer.reducedMotion = true; renderer.renderCombat(995, 995, 100);
assert.equal(enemy.artSprite.texture, 'enemy:west:idle');
assert.deepEqual(world.state, before, 'rendering neither applies damage nor alters engine actions');
renderer.renderCombat(10, 10, 16);
assert.equal(renderer.combatSprites.size, 0, 'offscreen battle graphics are released');
delete globalThis.PIXI;
console.log('productionVisuals: passed');
