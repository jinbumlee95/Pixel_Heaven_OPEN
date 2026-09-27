import assert from 'node:assert/strict';
import { Sound } from '../src/ui/Sound.js';

let contexts = 0; let notes = 0; let stopped = 0;
const parameter = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
class FakeAudio {
  constructor() { contexts++; this.currentTime = 0; this.state = 'suspended'; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
  createOscillator() { notes++; return { frequency: parameter(), connect() {}, disconnect() {}, start() {}, stop() { stopped++; } }; }
  createGain() { return { gain: parameter(), connect() {}, disconnect() {} }; }
}
const sound = new Sound({ AudioContext: FakeAudio });
sound.play({ action: 'raid' });
assert.equal(contexts, 0, 'never create audio before an explicit enable');
assert.equal(await sound.enable(), true);
sound.play({ action: 'raid' }); sound.play({ action: 'create_rain' });
assert.equal(notes, 1, 'simultaneous world events cannot flood audio');
sound.context.currentTime = 1;
sound.play({ action: 'need' });
assert.equal(notes, 1, 'routine need updates stay silent');
sound.play({ action: 'build_temple' });
assert.equal(notes, 2);
sound.mute();
sound.context.currentTime = 2;
sound.play({ action: 'raid' });
assert.equal(notes, 2);
assert.ok(stopped >= 2);
sound.stop();
assert.equal(sound.context.state, 'closed');
assert.equal(await sound.enable(), false, 'stopped audio cannot reopen');
assert.equal(await new Sound({ AudioContext: null }).enable(), false);
console.log('sound: passed');
