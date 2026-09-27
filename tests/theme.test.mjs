import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { Theme, resolveTheme, THEME_STORAGE_KEY, THEME_COLORS } from '../src/ui/Theme.js';
import { I18n } from '../src/i18n/I18n.js';

assert.equal(resolveTheme('dark', 'light'), 'dark');
assert.equal(resolveTheme('light', 'dark'), 'light');
assert.equal(resolveTheme('corrupt', 'light'), 'light');
assert.equal(resolveTheme(undefined, 'dark'), 'dark');
assert.equal(resolveTheme(undefined, undefined), 'dark');
assert.equal(resolveTheme('auto', 'unknown'), 'dark');

class Media {
  constructor(matches, legacy = false) {
    this.matches = matches;
    this.listeners = new Set();
    if (legacy) { this.addEventListener = undefined; this.removeEventListener = undefined; }
  }
  addEventListener(_name, listener) { this.listeners.add(listener); }
  removeEventListener(_name, listener) { this.listeners.delete(listener); }
  addListener(listener) { this.listeners.add(listener); }
  removeListener(listener) { this.listeners.delete(listener); }
  emit() { for (const listener of this.listeners) listener({ matches: this.matches }); }
}
function environment({ saved, system = 'dark', legacy = false, blocked = false } = {}) {
  const writes = [];
  const storage = {
    getItem(key) { assert.equal(key, THEME_STORAGE_KEY); if (blocked) throw Error('storage denied'); return saved; },
    setItem(key, value) { if (blocked) throw Error('storage denied'); writes.push([key, value]); },
  };
  const media = { dark: new Media(system === 'dark', legacy), light: new Media(system === 'light', legacy) };
  const root = { dataset: {} };
  const select = { value: '', listeners: new Map(),
    addEventListener(name, fn) { this.listeners.set(name, fn); },
    removeEventListener(name, fn) { if (this.listeners.get(name) === fn) this.listeners.delete(name); },
  };
  const colorMeta = { setAttribute(_key, value) { this.color = value; } };
  const matchMedia = query => media[query.includes('dark') ? 'dark' : 'light'];
  const theme = new Theme({ root, select, colorMeta, storage, matchMedia });
  const changeSystem = value => {
    media.dark.matches = value === 'dark'; media.light.matches = value === 'light';
    media.dark.emit(); media.light.emit();
  };
  return { theme, root, select, media, colorMeta, storage, matchMedia, writes, changeSystem };
}

const automatic = environment({ system: 'light' });
assert.equal(automatic.root.dataset.theme, 'light');
assert.equal(automatic.select.value, 'light');
assert.equal(automatic.colorMeta.color, THEME_COLORS.light);
assert.deepEqual(automatic.writes, [], 'reading the system preference never stores a user choice');
automatic.changeSystem('dark');
assert.equal(automatic.theme.theme, 'dark', 'system changes are followed before explicit selection');
assert.deepEqual(automatic.writes, []);
automatic.select.value = 'light';
automatic.select.listeners.get('change')();
assert.deepEqual(automatic.writes, [[THEME_STORAGE_KEY, 'light']]);
automatic.changeSystem('dark');
assert.equal(automatic.theme.theme, 'light', 'a manual choice wins even if the OS later changes');
assert.equal(automatic.theme.setTheme('system'), false);
assert.equal(automatic.theme.theme, 'light');
assert.equal(automatic.writes.length, 1, 'invalid UI values cannot overwrite the stored choice');
automatic.theme.dispose();
assert.equal(automatic.select.listeners.size, 0);
assert.equal(automatic.media.dark.listeners.size + automatic.media.light.listeners.size, 0);

const sameChoice = environment();
sameChoice.theme.setTheme('dark');
sameChoice.changeSystem('light');
assert.equal(sameChoice.theme.theme, 'dark', 'choosing the displayed theme still makes it an explicit preference');
sameChoice.theme.dispose();
const persisted = environment({ saved: 'light', system: 'dark' });
persisted.changeSystem('dark');
assert.equal(persisted.theme.theme, 'light', 'a reloaded stored preference precedes the current OS');
assert.deepEqual(persisted.writes, []);
persisted.theme.dispose();
const denied = environment({ blocked: true, system: 'light', legacy: true });
denied.theme.setTheme('dark');
denied.changeSystem('light');
assert.equal(denied.root.dataset.theme, 'dark', 'denied persistence must not undo the in-session choice');
denied.theme.dispose();
assert.equal(denied.media.dark.listeners.size + denied.media.light.listeners.size, 0, 'older media listeners are also removed');
const noBrowser = new Theme({ root: null, select: null, colorMeta: null, storage: null,
  matchMedia: () => { throw Error('unsupported'); } });
assert.equal(noBrowser.theme, 'dark');
assert.equal(noBrowser.setTheme('light'), true);
noBrowser.dispose();

// The pre-paint bootstrap must agree with the full controller even when browser
// storage is denied or a saved preference has been corrupted.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bootstrap = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
for (const saved of [undefined, 'light', 'dark', 'invalid']) {
  for (const system of ['light', 'dark', undefined]) {
    const env = environment({ saved, system: system ?? 'unknown' });
    const bootRoot = { dataset: {} };
    const bootMeta = {};
    runInNewContext(bootstrap, { localStorage: env.storage, matchMedia: env.matchMedia,
      document: { documentElement: bootRoot, querySelector: () => bootMeta } });
    assert.equal(bootRoot.dataset.theme, env.theme.theme);
    assert.equal(bootMeta.content, THEME_COLORS[env.theme.theme]);
    env.theme.dispose();
  }
}
const blockedRoot = { dataset: {} };
runInNewContext(bootstrap, { get localStorage() { throw Error('denied'); },
  document: { documentElement: blockedRoot, querySelector: () => ({}) } });
assert.equal(blockedRoot.dataset.theme, 'dark');

for (const locale of ['ko', 'en', 'ja']) {
  const i18n = new I18n({ locale, storage: null });
  for (const key of ['controls.theme', 'controls.themeHint', 'theme.light', 'theme.dark']) {
    assert.ok(i18n.has(key)); assert.notEqual(i18n.t(key), key);
  }
}

// Measure actual CSS palette values, including subdued copy and disabled labels.
// This guards the requested readability contract, independent of theme logic.
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
assert.doesNotMatch(css, /(?:linear|radial|conic)-gradient\(/i);
assert.doesNotMatch(css, /box-shadow\s*:/i);
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map(pair => parseInt(pair, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
const palettes = { dark: css.match(/:root \{([\s\S]*?)\}/)[1],
  light: css.match(/:root\[data-theme="light"\] \{([\s\S]*?)\}/)[1] };
const minimums = {};
for (const [name, block] of Object.entries(palettes)) {
  const colors = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(match => [match[1], match[2]]));
  const pairs = ['page', 'panel', 'surface', 'input', 'notice', 'danger-surface'].flatMap(background =>
    ['text', 'muted', 'heading', 'gold'].map(foreground => [foreground, background]));
  pairs.push(['button-text', 'button'], ['button-text', 'button-hover'], ['on-primary', 'primary'],
    ['on-primary', 'primary-hover'], ['disabled-text', 'disabled'], ['danger', 'notice'],
    ['danger', 'danger-surface'], ['success', 'surface'], ['button-text', 'notice'], ['button-text', 'danger-surface']);
  minimums[name] = Math.min(...pairs.map(([foreground, background]) => {
    const ratio = contrast(colors[foreground], colors[background]);
    assert.ok(ratio >= 4.5, `${name}: ${foreground} on ${background} is only ${ratio.toFixed(2)}:1`);
    return ratio;
  }));
}
console.log(`theme: passed; minimum text contrast light ${minimums.light.toFixed(2)}:1, dark ${minimums.dark.toFixed(2)}:1`);
