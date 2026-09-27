import assert from 'node:assert/strict';
import { createInitialWorld } from './fixtures/legacyWorld.mjs';
import { createWorldContext } from '../src/game/WorldNeeds.js';
import { decideWorldAction } from '../src/llm/worldLLM.js';
import { validateWorldSchema } from '../src/actions/worldActions.js';

const world = createInitialWorld();
const context = createWorldContext(world.state);
const initial = structuredClone(world.state);
const output = await decideWorldAction(context);
assert.equal(output.action, 'farm');
assert.equal(output.actor, 'south');
assert.ok(validateWorldSchema(output));
assert.deepEqual(world.state, initial);
context.villages[0].food = -100;
context.rules.farmWood = 0;
assert.deepEqual(world.state, initial); // Context is completely detached.

const north = world.getVillage('north');
const south = world.getVillage('south');
south.food = 1;
assert.equal((await decideWorldAction(createWorldContext(world.state))).action, 'trade');
south.wood = 0;
assert.equal((await decideWorldAction(createWorldContext(world.state))).action, 'migrate');
north.food = 0;
north.wood = 0;
assert.equal((await decideWorldAction(createWorldContext(world.state))).action, 'start_war');
south.happiness = 50;
assert.equal((await decideWorldAction(createWorldContext(world.state))).action, 'none');
for (const v of world.state.villages) { v.farmCount = 100; v.food = 10000; v.wood = 100; }
south.population = 121;
assert.equal((await decideWorldAction(createWorldContext(world.state))).action, 'build_house');
south.population = 110;
assert.deepEqual(await decideWorldAction(createWorldContext(world.state)), { action: 'none' });
console.log('worldLLM: passed');
