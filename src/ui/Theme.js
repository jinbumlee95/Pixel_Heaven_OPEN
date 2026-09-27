export const THEME_STORAGE_KEY = 'pixelHeaven.theme';
export const THEME_COLORS = Object.freeze({ light: '#d6cbb7', dark: '#211e1a' });

const validTheme = value => value === 'light' || value === 'dark';

export function resolveTheme(saved, system) {
  return validTheme(saved) ? saved : validTheme(system) ? system : 'dark';
}

function browserStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

// Theme is presentation state only. Following the OS never writes a preference;
// the first explicit player selection takes precedence for this session too.
export class Theme {
  constructor({ root = globalThis.document?.documentElement,
    select = globalThis.document?.querySelector('#theme-select'),
    colorMeta = globalThis.document?.querySelector('meta[name="theme-color"]'),
    storage = browserStorage(), matchMedia = globalThis.matchMedia?.bind(globalThis) } = {}) {
    this.root = root;
    this.select = select;
    this.colorMeta = colorMeta;
    this.storage = storage;
    this.media = {};
    for (const value of ['dark', 'light']) {
      try { this.media[value] = matchMedia?.(`(prefers-color-scheme: ${value})`); } catch { /* Use the dark fallback. */ }
    }
    let saved;
    try { saved = storage?.getItem(THEME_STORAGE_KEY); } catch { /* Preferences can be unavailable. */ }
    this.selection = validTheme(saved) ? saved : undefined;
    this.theme = resolveTheme(this.selection, this.systemTheme());
    this.onSystemChange = () => {
      if (this.selection) return;
      this.theme = resolveTheme(undefined, this.systemTheme());
      this.render();
    };
    this.onSelect = () => this.setTheme(this.select.value);
    this.select?.addEventListener('change', this.onSelect);
    for (const media of Object.values(this.media)) {
      if (media?.addEventListener) media.addEventListener('change', this.onSystemChange);
      else media?.addListener?.(this.onSystemChange);
    }
    this.render();
  }

  systemTheme() {
    if (this.media.dark?.matches) return 'dark';
    if (this.media.light?.matches) return 'light';
    return undefined;
  }

  setTheme(theme) {
    if (!validTheme(theme)) return false;
    this.selection = theme;
    this.theme = theme;
    try { this.storage?.setItem(THEME_STORAGE_KEY, theme); } catch { /* Keep the selected theme for this session. */ }
    this.render();
    return true;
  }

  render() {
    if (this.root) this.root.dataset.theme = this.theme;
    if (this.select) this.select.value = this.theme;
    this.colorMeta?.setAttribute('content', THEME_COLORS[this.theme]);
  }

  dispose() {
    this.select?.removeEventListener('change', this.onSelect);
    for (const media of Object.values(this.media)) {
      if (media?.removeEventListener) media.removeEventListener('change', this.onSystemChange);
      else media?.removeListener?.(this.onSystemChange);
    }
  }
}
