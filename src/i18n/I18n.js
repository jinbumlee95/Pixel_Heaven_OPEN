import { failureCatalogs } from '../llm/OracleFailure.js';
import { dungeonCatalogs } from './dungeon.js';
import { religionCatalogs } from './religion.js';
import { equipmentCatalogs } from './equipment.js';
import { productionCatalogs } from './production.js';
import { tradeCatalogs } from './trade.js';
import { chatWorldCatalogs } from './chatWorld.js';
import { expansionCatalogs } from './expansion.js';
import { uiCatalogs } from './locales.js';
import { eventCatalogs } from './events.js';
import { runtimeCatalogs } from './runtime.js';
import { factionCatalogs } from './factions.js';
import { forecastCatalogs } from './forecast.js';
import { settlementCatalogs } from './settlement.js';
import { combatCatalogs } from './combat.js';
import { progressionCatalogs } from './progression.js';
import { durationParts, elapsedClock } from '../game/GameTime.js';

export const SUPPORTED_LOCALES = Object.freeze(['ko', 'en', 'ja']);
export const LOCALE_STORAGE_KEY = 'pixelHeaven.locale';
export const catalogues = Object.freeze(Object.fromEntries(SUPPORTED_LOCALES.map(locale =>
  [locale, Object.freeze({ ...uiCatalogs[locale], ...eventCatalogs[locale], ...runtimeCatalogs[locale],
    ...factionCatalogs[locale], ...forecastCatalogs[locale], ...settlementCatalogs[locale], ...combatCatalogs[locale], ...progressionCatalogs[locale], ...expansionCatalogs[locale], ...chatWorldCatalogs[locale], ...tradeCatalogs[locale], ...productionCatalogs[locale], ...equipmentCatalogs[locale], ...religionCatalogs[locale], ...failureCatalogs[locale], ...dungeonCatalogs[locale] })])));
const intlLocales = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP' };
const defaultVillageNames = { home: 'Worldtree Settlement', north: 'North village', south: 'South village' };

export function normalizeLocale(locale) {
  if (typeof locale !== 'string') return 'en';
  const language = locale.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(language) ? language : 'en';
}

function browserStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export class I18n {
  constructor({ locale, storage = browserStorage(), catalogs = catalogues } = {}) {
    this.storage = storage;
    this.catalogs = catalogs;
    this.listeners = new Set();
    let stored;
    try { stored = storage?.getItem(LOCALE_STORAGE_KEY); } catch { /* Preferences may be blocked. */ }
    this.locale = normalizeLocale(locale ?? stored ?? globalThis.navigator?.language ?? 'en');
    this.numbers = new Intl.NumberFormat(intlLocales[this.locale]);
  }

  setLocale(locale) {
    const next = normalizeLocale(locale);
    try { this.storage?.setItem(LOCALE_STORAGE_KEY, next); } catch { /* Keep the current session usable. */ }
    if (next === this.locale) return;
    this.locale = next;
    this.numbers = new Intl.NumberFormat(intlLocales[next]);
    for (const listener of this.listeners) listener(next);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  has(key) {
    return Object.hasOwn(this.catalogs[this.locale] ?? {}, key)
      || Object.hasOwn(this.catalogs.en ?? {}, key);
  }

  t(key, params = {}) {
    const template = this.catalogs[this.locale]?.[key] ?? this.catalogs.en?.[key] ?? key;
    if (typeof template !== 'string') return String(key ?? '');
    return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, name) =>
      Object.hasOwn(params, name) ? this.formatValue(params[name]) : match);
  }

  formatValue(value) {
    if (typeof value === 'number') return this.numbers.format(value);
    if (value && typeof value === 'object') {
      if (value.resourceBasket && typeof value.resourceBasket === 'object') return Object.entries(value.resourceBasket).map(([id, amount]) => `${this.t(id === 'faith' ? 'faith.title' : `resource.${id}`)} ${this.numbers.format(amount)}`).join(' / ');
      if (typeof value.gameTime === 'number') return this.gameTime(value.gameTime);
      if (typeof value.duration === 'number') return this.duration(value.duration);
      if (typeof value.villageId === 'string') return this.villageName(value.villageId, value.name);
      if (typeof value.factionId === 'string') return value.nameKey && this.has(value.nameKey)
        ? this.t(value.nameKey) : value.name || value.factionId;
      if (typeof value.religionId === 'string') return this.t(`religion.${value.religionId}`);
      if (typeof value.messageKey === 'string') return this.formatMessage(value);
      return '';
    }
    return value == null ? '' : String(value);
  }

  formatMessage(record) {
    if (typeof record === 'string') return record;
    if (!record) return '';
    if (record.messageKey && this.has(record.messageKey)) {
      const params = { ...record.messageParams };
      // Existing engine events retain their numeric deadlines. Convert only at
      // presentation, so saved/history records keep stable simulation values.
      for (const key of ['tick', 'end']) {
        if (typeof params[key] === 'number') params[key] = { gameTime: params[key] };
      }
      return this.t(record.messageKey, params);
    }
    return typeof record.message === 'string' ? record.message : typeof record.reply === 'string' ? record.reply : '';
  }

  villageName(id, name) {
    if (name && name !== defaultVillageNames[id]) return name;
    return this.has(`village.${id}`) ? this.t(`village.${id}`) : name || id;
  }

  gameTime(seconds) {
    return this.t('time.elapsed', { clock: elapsedClock(seconds) });
  }

  duration(seconds) {
    const parts = durationParts(seconds);
    return this.t(parts.minutes > 0 ? (parts.seconds > 0 ? 'time.minutesSeconds' : 'time.minutes') : 'time.seconds', parts);
  }

  applyDOM(root = globalThis.document) {
    if (!root) return;
    const attributes = { 'data-i18n': null, 'data-i18n-aria-label': 'aria-label',
      'data-i18n-placeholder': 'placeholder', 'data-i18n-title': 'title' };
    for (const [dataAttribute, attribute] of Object.entries(attributes)) {
      for (const node of root.querySelectorAll(`[${dataAttribute}]`)) {
        const value = this.t(node.getAttribute(dataAttribute));
        if (attribute) node.setAttribute(attribute, value); else node.textContent = value;
      }
    }
    const document = root.nodeType === 9 ? root : root.ownerDocument;
    if (document?.documentElement) document.documentElement.lang = this.locale;
    if (document) document.title = this.t('app.title');
    const selector = root.querySelector('#locale-select');
    if (selector) selector.value = this.locale;
  }
}
