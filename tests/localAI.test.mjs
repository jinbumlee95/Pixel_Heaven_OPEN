import assert from 'node:assert/strict';
import { LocalAI } from '../src/llm/LocalAI.js';
import { createInitialWorld } from '../src/game/World.js';
import { createWorldContext } from '../src/game/WorldNeeds.js';

const context = { defaultTarget: 'south' };
const absent = new LocalAI({ api: null });
assert.equal(await absent.detect(), 'unavailable');
assert.equal((await absent.interpret('rain', context)).target, 'south');
assert.equal(await absent.enable(), false);
const broken = new LocalAI({ api: { availability() { throw Error('private'); } } });
assert.equal(await broken.detect(), 'unavailable');
const stuck = new LocalAI({ api: { availability: () => new Promise(() => {}) }, timeoutMs: 5 });
assert.equal(await stuck.detect(), 'unavailable');

let output = JSON.stringify({intent:'increase_food',value:'',amount:77,direction:'',target:'home'});
let prompts = 0;
let destroyed = 0;
let created = 0;
let pending;
const options = [];
const ai = new LocalAI({ timeoutMs: 15, api: {
  availability: async o => { options.push(o); return o.expectedInputs[0].languages.length === 1 ? 'downloadable' : 'unavailable'; },
  create: async o => {
    created++;
    assert.deepEqual(o.expectedInputs, options[0].expectedInputs);
    return { destroy() {}, clone: async () => {
      let disposed = false;
      return {
      destroy() { assert.equal(disposed, false, 'clone is destroyed at most once'); disposed = true; destroyed++; },
      prompt: async (_prompt, o) => {
        prompts++;
        assert.equal(o.responseConstraint.type, 'object');
        if (_prompt.startsWith('Classify')) assert.equal(o.omitResponseConstraintInput,true);
        if (output === 'hang') return new Promise(resolve => { pending = resolve; });
        return _prompt.startsWith('Verify') && output.startsWith('{') && !output.includes('erase_map') ? '{"matches":true}' : output;
      },
    }; } };
  },
} });
await ai.detect();
assert.equal(created, 0, 'detection must not download');
await ai.enable();
assert.equal((await ai.interpret('food', context)).parameters.amount, 77);
assert.equal(destroyed, 2);
const beforeKorean = prompts;
assert.equal((await ai.interpret('비를 내려라', context)).status, 'unclear');
assert.equal(prompts, beforeKorean, 'unsupported language applies no action');
for (const invalid of ['not json', '{"status":"understood","action":"erase_map"}']) {
  output = invalid;
  assert.equal((await ai.interpret('rain', context)).status, 'unclear');
}
output = '{"action":"none"}';
assert.deepEqual(await ai.decide(createWorldContext(createInitialWorld().state)), { action: 'none' });
output = 'hang';
assert.equal((await ai.interpret('rain', context)).status, 'unclear', 'timeout fails closed');
pending('{"action":"erase_map"}');
ai.disable();
const beforeDemo = prompts;
assert.equal((await ai.interpret('food', context)).parameters.amount, 50);
assert.equal(prompts, beforeDemo);
await ai.enable();
output = 'hang';
const inflight = ai.interpret('rain', context);
await new Promise(resolve => setTimeout(resolve, 0));
ai.disable();
pending(JSON.stringify({ status: 'understood', action: 'curse_village', target: 'south', parameters: {} }));
assert.equal((await inflight).status, 'unclear', 'mode change discards local result');
ai.stop();
absent.stop(); broken.stop(); stuck.stop();
// Downloads are bounded; cancellation also destroys a late-created session.
let createdLate;
let lateDestroyed = false;
const download = new LocalAI({ activationTimeoutMs: 5, api: {
  availability: async () => 'downloadable',
  create: () => new Promise(resolve => { createdLate = resolve; }),
} });
await download.detect();
assert.equal(await download.enable(), false);
createdLate({ destroy() { lateDestroyed = true; } });
await Promise.resolve();
assert.equal(lateDestroyed, true);
assert.equal(download.session, null);
const cancelled = download.enable();
download.disable();
assert.equal(await cancelled, false);
createdLate({ destroy() {} });
download.stop();
console.log('localAI: passed');

// Browsers may report 'ko' available, but create() aborts on non-Prompt-API languages.
const permissive = new LocalAI({ api: {
  availability: async () => 'downloadable',
  create: async o => {
    for (const io of [...o.expectedInputs, ...o.expectedOutputs]) {
      assert.ok(io.languages.every(l => ['en', 'es', 'ja', 'de', 'fr'].includes(l)), `unsupported language sent: ${io.languages}`);
    }
    return { destroy() {} };
  },
} });
await permissive.detect();
assert.equal(await permissive.enable(), true);
assert.deepEqual(permissive.options.expectedInputs[0].languages, ['en', 'ko', 'ja'], 'Korean input stays accepted');
permissive.stop();

// AI mode: dungeon typos reach the model (classify and verify) as 'dungeon'.
const seen = [];
const typoAI = new LocalAI({ api: {
  availability: async () => 'available',
  create: async () => ({ destroy() {}, clone: async () => ({ destroy() {}, prompt: async p => {
    const message = p.match(/Message: (".*")/)[1];
    seen.push(message);
    const knows = message.includes('dungeon');
    if (p.startsWith('Verify')) return JSON.stringify({ matches: knows });
    return JSON.stringify({ intent: knows ? 'hero_dispatch' : 'none', value: '', amount: 0, direction: '', target: 'home' });
  } }) }),
} });
await typoAI.detect(); await typoAI.enable();
assert.equal((await typoAI.interpret('send hero deongun', context)).action, 'hero_dispatch');
assert.ok(seen.length === 2 && seen.every(m => m === '"send hero dungeon"'), JSON.stringify(seen));
typoAI.stop();
