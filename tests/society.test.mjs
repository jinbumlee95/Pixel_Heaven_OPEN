import assert from 'node:assert/strict';
import { createInitialWorld } from './fixtures/legacyWorld.mjs';
import { executeWorldAction as execute, validateWorldSchema } from '../src/actions/worldActions.js';
import { createWorldContext } from '../src/game/WorldNeeds.js';
import { decideWorldAction } from '../src/llm/worldLLM.js';

const world = createInitialWorld();
const north = world.getVillage('north');
const south = world.getVillage('south');
const action = (name, actor = 'south', target = actor, parameters = {}) => ({
  action: name, actor, target, parameters, reason: 'interpretation_of_divine_message',
});
const noMutation = proposal => {
  const before = structuredClone(world.state);
  assert.equal(execute(world, proposal).ok, false);
  assert.deepEqual(world.state, before);
};
noMutation(action('change_religion', 'south', 'south', { religion: 'sky_god' }));
assert.ok(execute(world, action('build_temple')).ok);
assert.equal(south.templeCount, 1);
assert.equal(south.wood, 30);
const temple = [...world.state.buildings.values()].find(b => b.type === 'temple');
assert.equal([...world.state.occupied.values()].filter(o => o === temple).length, 24);
noMutation(action('build_temple'));
assert.equal((await decideWorldAction(createWorldContext(world.state))).action, 'change_religion');
assert.ok(execute(world, action('change_religion', 'south', 'south', { religion: 'earth_god' })).ok);
assert.equal(south.religion, 'earth_god');
assert.ok(execute(world, action('start_war', 'south', 'north')).ok);
assert.equal(south.relations.north, 'war');
assert.equal(north.relations.south, 'war');
noMutation(action('trade', 'south', 'north', { food: 5 }));
noMutation(action('migrate', 'south', 'north', { people: 1 }));
noMutation(action('start_war', 'south', 'north'));
assert.ok(execute(world, action('form_alliance', 'south', 'north')).ok);
assert.equal(north.relations.south, 'allied');
noMutation(action('start_war', 'south', 'north'));
noMutation(action('form_alliance', 'south', 'north'));
noMutation(action('form_alliance', 'south', 'south'));
noMutation(action('form_alliance', 'south', 'raiders'));
for (const invalid of [action('start_war', 'south', 'north', { damage: 999 }),
  action('build_temple', 'north', 'north', { x: 0 }), action('change_religion', 'south', 'south', { religion: 'unknown' })]) {
  assert.equal(validateWorldSchema(invalid), false);
  noMutation(invalid);
}
const context = createWorldContext(world.state);
context.villages[0].relations.south = 'war';
assert.equal(north.relations.south, 'allied');
const blocked = createInitialWorld();
blocked.findEmptyArea = () => null;
const before = structuredClone(blocked.state);
assert.equal(execute(blocked, action('build_temple')).code, 'no_space');
assert.deepEqual(blocked.state, before);
console.log('society: passed');
