import assert from 'node:assert/strict';
import { createContentRegistry } from '../src/content/ContentRegistry.js';
import { builtinPack, defaultContent } from '../src/content/builtin.js';

assert.equal(defaultContent.list().length, 58);
assert.equal(defaultContent.list('building').length, 11);
assert.equal(defaultContent.get('not_present'), undefined);
assert.deepEqual(defaultContent.get('house').footprint, { w: 3, h: 2 });
assert.deepEqual(defaultContent.get('temple').footprint, { w: 6, h: 4 });
assert.deepEqual(defaultContent.get('world_tree').footprint, { w: 6, h: 4 });
assert.equal(defaultContent.get('world_tree').kind, 'terrain');
assert.equal(defaultContent.get('world_tree').visual.width, 320);
assert.equal(defaultContent.get('world_tree').visual.height, 352);
assert.deepEqual(defaultContent.get('altar').footprint, { w: 2, h: 1 });
assert.equal(defaultContent.get('altar').kind, 'building');
assert.equal(defaultContent.get('priest').visual.height, 48);
assert.equal(defaultContent.get('priest').animation.width, 68);
assert.equal(defaultContent.get('farmland').visual.ground, true);
assert.notEqual(defaultContent.get('temple').visual.path, defaultContent.get('town_hall').visual.path,
  'Temple and town hall have separate delivered silhouettes, not recolored shared art');
assert.deepEqual(defaultContent.get('hero').footprint, { w: 1, h: 1 });
assert.equal(defaultContent.get('hero').animation.width, 68);
assert.throws(() => defaultContent.get('house').footprint.w = 1, TypeError);
assert.throws(() => defaultContent.get('priest').animation.walkRows.south = 0, TypeError);
assert.throws(() => defaultContent.list().push({}), TypeError);
assert.throws(() => defaultContent.packs[0].id = 'changed', TypeError);
assert.throws(() => builtinPack.definitions[0].visual.color = 0, TypeError);
assert.throws(() => defaultContent.list('unknown'), /unknown content kind/);

const examplePack = {
  schemaVersion: 1, id: 'orchard',
  definitions: [{ id: 'orchard:apple_tree', kind: 'terrain', labelKey: 'orchard.apple_tree',
    footprint: { w: 1, h: 1 },
    visual: { path: null, color: 0x75a040, width: 64, height: 64, anchorX: 0.5, anchorY: 1 } }],
  patches: [{ id: 'house', visual: { color: 0xabcdef }, labelKey: 'orchard.cottage' }],
};
const custom = createContentRegistry([builtinPack, examplePack]);
assert.equal(custom.get('orchard:apple_tree').kind, 'terrain');
assert.equal(custom.get('house').visual.color, 0xabcdef);
assert.equal(custom.get('house').visual.width, 96);
assert.equal(custom.get('house').labelKey, 'orchard.cottage');
assert.notEqual(defaultContent.get('house').visual.color, 0xabcdef, 'pack patch cannot mutate the base catalog');
examplePack.definitions[0].footprint.w = 8;
examplePack.patches[0].visual.color = 0;
assert.equal(custom.get('orchard:apple_tree').footprint.w, 1, 'catalog owns a detached copy');
assert.equal(custom.get('house').visual.color, 0xabcdef);
assert.equal(createContentRegistry([builtinPack, examplePack,
  { schemaVersion: 1, id: 'later', patches: [{ id: 'house', visual: { color: 1 } }] }]).get('house').visual.color, 1);

const pack = (change = {}) => ({ schemaVersion: 1, id: 'test', ...change });
const addition = (change = {}) => ({ id: 'test:tree', kind: 'terrain', labelKey: 'test.tree',
  footprint: { w: 1, h: 1 },
  visual: { path: null, color: 0, width: 32, height: 32, anchorX: 0.5, anchorY: 1 }, ...change });
const rejects = candidate => assert.throws(() => createContentRegistry([builtinPack, candidate]), TypeError);
rejects(pack({ schemaVersion: 2 }));
rejects(pack({ definitions: [addition({ id: 'house' })] }));
rejects(pack({ definitions: [addition({ id: 'other:tree' })] }));
rejects(pack({ definitions: [addition(), addition()] }));
rejects(pack({ definitions: [addition({ kind: 'script' })] }));
rejects(pack({ definitions: [addition({ footprint: { w: 9, h: 1 } })] }));
rejects(pack({ definitions: [addition({ footprint: { w: 1.5, h: 1 } })] }));
rejects(pack({ definitions: [addition({ kind: 'entity', footprint: { w: 2, h: 1 } })] }));
rejects(pack({ definitions: [addition({ onTick: 'arbitraryCode()' })] }));
rejects(pack({ definitions: [addition({ attack: { script: 'mutateWorld()' } })] }));
rejects(pack({ definitions: [addition({ visual: { ...addition().visual, width: 513 } })] }));
rejects(pack({ definitions: [addition({ visual: { ...addition().visual, height: NaN } })] }));
rejects(pack({ definitions: [addition({ visual: { ...addition().visual, anchorX: -1 } })] }));
rejects(pack({ definitions: [addition({ visual: { ...addition().visual, tint: 0x1000000 } })] }));
rejects(pack({ patches: [{ id: 'temple', visual: { tint: -1 } }] }));
assert.equal(createContentRegistry([builtinPack, pack({ patches: [{ id: 'temple', visual: { tint: 0xabcdef } }] })])
  .get('temple').visual.tint, 0xabcdef);
for (const path of ['https://example.com/image.png', '../outside.png', '/assets/image.png',
  'assets/../image.png', 'assets/%2e%2e/image.png', 'assets\\image.png', 'javascript:alert(1)', 'assets/icon.svg']) {
  rejects(pack({ definitions: [addition({ visual: { ...addition().visual, path } })] }));
}
rejects(pack({ patches: [{ id: 'house', footprint: { w: 1, h: 1 } }] }));
rejects(pack({ patches: [{ id: 'house', kind: 'entity' }] }));
rejects(pack({ patches: [{ id: 'house', animation: {} }] }));
rejects(pack({ patches: [{ id: 'priest', visual: { width: 64 } }] }));
rejects(pack({ patches: [{ id: 'priest', visual: { height: 96 } }] }));
rejects(pack({ patches: [{ id: 'priest', visual: { anchorX: 0 } }] }));
rejects(pack({ patches: [{ id: 'priest', visual: { anchorY: 0 } }] }));
rejects(pack({ patches: [{ id: 'ground', visual: { height: 64 } }] }));
rejects(pack({ patches: [{ id: 'rain_particle', visual: { width: 16 } }] }));
const unchangedGeometry = createContentRegistry([builtinPack, pack({ patches: [
  { id: 'priest', visual: { width: 32, height: 48, anchorX: 0.5, anchorY: 1, path: null } },
  { id: 'ground', visual: { width: 32 } }, { id: 'rain_particle', visual: { height: 8 } },
] })]);
assert.equal(unchangedGeometry.get('priest').visual.path, null, 'static fallback path may change');
assert.deepEqual(unchangedGeometry.get('priest').animation, defaultContent.get('priest').animation,
  'a static fallback patch never replaces the animated sheet');
rejects(pack({ patches: [{ id: 'missing', visual: { color: 1 } }] }));
rejects(pack({ patches: [{ id: 'house' }] }));
rejects(pack({ definitions: [addition({ animation: { ...defaultContent.get('priest').animation, frames: 1000 } })] }));
rejects(pack({ definitions: [addition({ animation: { ...defaultContent.get('priest').animation, walkRows: { south: 0 } } })] }));
assert.throws(() => createContentRegistry([builtinPack, pack(), pack()]), /duplicate pack/);
assert.throws(() => createContentRegistry([pack(), builtinPack]), /core pack must be first/);
assert.throws(() => createContentRegistry(Array.from({ length: 17 }, (_, i) => pack({ id: `p${i}` }))), /at most 16/);
rejects(pack({ definitions: Array.from({ length: 502 }, (_, i) => addition({ id: `test:tree${i}` })) }));
assert.deepEqual(createContentRegistry().list(), []);

// Rejected packs never partially alter a previously published catalog.
rejects(pack({ patches: [{ id: 'house', visual: { color: 1 } }, { id: 'missing', visual: { color: 2 } }] }));
assert.equal(defaultContent.get('house').visual.color, 0xc29264);
let getterCalled = false;
const getter = pack();
Object.defineProperty(getter, 'definitions', { enumerable: true, get() { getterCalled = true; return []; } });
rejects(getter);
assert.equal(getterCalled, false, 'never execute pack getters');
const inputGetter = [];
Object.defineProperty(inputGetter, '0', { enumerable: true, get() { getterCalled = true; return builtinPack; } });
assert.throws(() => createContentRegistry(inputGetter), TypeError);
assert.equal(getterCalled, false, 'the pack list itself must also contain plain data');
rejects(pack({ definitions: () => [] }));
rejects(pack({ definitions: new Date() }));
rejects(JSON.parse('{"schemaVersion":1,"id":"test","__proto__":{"polluted":true}}'));
const cyclic = pack(); cyclic.patches = [cyclic]; rejects(cyclic);
assert.equal({}.polluted, undefined);

console.log('contentRegistry: passed');
