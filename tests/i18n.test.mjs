import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { I18n, catalogues, SUPPORTED_LOCALES, LOCALE_STORAGE_KEY, normalizeLocale } from '../src/i18n/I18n.js';

const tokens = value => [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(match => match[1]).sort();
for (const locale of SUPPORTED_LOCALES) {
  assert.deepEqual(Object.keys(catalogues[locale]).sort(), Object.keys(catalogues.en).sort(), `${locale}: translation key parity`);
  for (const [key, template] of Object.entries(catalogues.en)) {
    assert.equal(typeof catalogues[locale][key], 'string', `${locale}:${key} is text`);
    assert.ok(catalogues[locale][key].trim(), `${locale}:${key} is not empty`);
    assert.deepEqual(tokens(catalogues[locale][key]), tokens(template), `${locale}:${key} placeholder parity`);
  }
}
assert.equal(normalizeLocale('ko-KR'), 'ko');
assert.equal(normalizeLocale('ja-JP'), 'ja');
assert.equal(normalizeLocale('EN_us'), 'en');
assert.equal(normalizeLocale('fr'), 'en');

const preferences = new Map([[LOCALE_STORAGE_KEY, 'ja-JP']]);
const storage = { getItem: key => preferences.get(key), setItem: (key, value) => preferences.set(key, value) };
const i18n = new I18n({ storage });
assert.equal(i18n.locale, 'ja');
let updates = 0;
const unsubscribe = i18n.subscribe(() => updates++);
i18n.setLocale('ko-KR');
assert.equal(i18n.locale, 'ko');
assert.equal(preferences.get(LOCALE_STORAGE_KEY), 'ko');
assert.equal(updates, 1);
i18n.setLocale('ko');
assert.equal(updates, 1, 'equivalent locales do not re-render');
assert.equal(new I18n({ storage }).locale, 'ko', 'saved language is restored');
assert.equal(new I18n({ locale: 'en', storage }).locale, 'en', 'explicit locale wins over storage');
unsubscribe(); i18n.setLocale('ja');
assert.equal(updates, 1, 'detached views are no longer notified');
const blocked = new I18n({ locale: 'ko', storage: {
  getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); },
} });
assert.doesNotThrow(() => blocked.setLocale('ja'));
assert.equal(blocked.locale, 'ja', 'privacy settings do not disable language switching');

const fallback = new I18n({ locale: 'ja', storage: null, catalogs: {
  en: { known: 'Food {amount}', typed: '{village} / {religion}', 'village.north': 'North village', 'religion.sky_god': 'Sky god' }, ja: {},
} });
assert.equal(fallback.t('known', { amount: 1234.5 }), 'Food 1,234.5');
assert.equal(fallback.formatMessage({ messageKey: 'missing', message: 'Historical text' }), 'Historical text');
assert.equal(fallback.formatMessage({ reply: 'Legacy reply' }), 'Legacy reply');
assert.equal(fallback.formatMessage(null), '');
assert.equal(fallback.t('missing.key'), 'missing.key');
assert.equal(fallback.t('typed', { village: { villageId: 'north' }, religion: { religionId: 'sky_god' } }), 'North village / Sky god');
assert.equal(i18n.villageName('north', 'North village'), '北の村');
assert.equal(i18n.villageName('home', 'Worldtree Settlement'), '世界樹の集落');
assert.equal(i18n.villageName('home', '별빛 정착지'), '별빛 정착지');
assert.equal(i18n.villageName('north', '별빛 항구'), '별빛 항구', 'custom names are never translated');
assert.equal(i18n.villageName('modded-village', 'Oak Reach'), 'Oak Reach');
assert.equal(i18n.formatMessage({ messageKey: 'world.event', messageParams: { time: { gameTime: 1200 }, message: '<img onerror=alert(1)>' } }),
  '経過 20:00 · <img onerror=alert(1)>', 'formatting returns plain text, without evaluating player input');

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const englishEdition = new I18n({ locale: 'ko', allowedLocales: ['en'], storage: null });
assert.equal(englishEdition.locale,'en','the public edition cannot start in a saved or requested unsupported locale');
assert.equal(englishEdition.setLocale('ja'),false);
assert.equal(englishEdition.locale,'en','chat cannot switch an English edition into a hidden language');
for (const [, key] of html.matchAll(/data-i18n(?:-aria-label|-placeholder|-title)?="([^"]+)"/g)) {
  assert.ok(Object.hasOwn(catalogues.en, key), `HTML key exists: ${key}`);
}
const node = attributes => ({ attributes: { ...attributes }, textContent: '',
  getAttribute(key) { return this.attributes[key]; }, setAttribute(key, value) { this.attributes[key] = value; } });
const heading = node({ 'data-i18n': 'chat.title' });
const input = node({ 'data-i18n-placeholder': 'chat.placeholder', 'data-i18n-aria-label': 'chat.command' });
input.value = '書きかけの言葉'; input.selectionStart = 3;
const selector = { value: 'en' };
const document = { nodeType: 9, documentElement: {}, title: '',
  querySelectorAll(selector) { const attribute = selector.slice(1, -1); return [heading, input].filter(item => attribute in item.attributes); },
  querySelector() { return selector; },
};
i18n.applyDOM(document);
assert.equal(document.documentElement.lang, 'ja');
assert.equal(document.title, 'ピクセルヘブン — Phase 21');
assert.equal(selector.value, 'ja');
assert.equal(heading.textContent, '世界に言葉を届ける');
assert.equal(input.attributes['aria-label'], 'あなたの言葉');
assert.equal(input.value, '書きかけの言葉');
assert.equal(input.selectionStart, 3, 'static localization never rewrites the input or cursor');
console.log('i18n: passed');
