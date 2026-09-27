import assert from 'node:assert/strict';
import { isCreationOracle } from '../src/ui/Creation.js';
for(const text of ['빛이 있으라','Let there be light!','Be light made','光あれ。'])assert.ok(isCreationOracle(text));
for(const text of ['빛이 있지 마라','do not let there be light','光あれではない','erase map'])assert.equal(isCreationOracle(text),false);
console.log('creation: passed');
