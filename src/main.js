import { receiveCreationOracle } from './ui/Creation.js';
import { decodeWorld } from './state/Persistence.js';
import { createContentRegistry } from './content/ContentRegistry.js';
import { builtinPack } from './content/builtin.js';
import { Game } from './game/Game.js';
import { I18n } from './i18n/I18n.js';

const status = document.querySelector('#status');
const i18n = new I18n();
i18n.applyDOM(document);
status.textContent = i18n.t('app.loading');
let restored; let packs = [];let content;
try {
  const pending = sessionStorage.getItem('pixelHeaven.load');
  if (pending) { restored = decodeWorld(pending); sessionStorage.removeItem('pixelHeaven.load'); }
  else packs = JSON.parse(localStorage.getItem('pixelHeaven.packs') ?? '[]');
  content = createContentRegistry([builtinPack, ...packs]);
} catch (error) {
  sessionStorage.removeItem('pixelHeaven.load');
  status.textContent=i18n.t('app.startFailed',{error:error.message});status.setAttribute('role','alert');
  // Keep original saved files and packs available for repair; recovery is explicit.
  const recover=document.createElement('input');recover.placeholder=i18n.t('creation.recover');recover.setAttribute('aria-label',recover.placeholder);status.after(recover);
  await new Promise(resolve=>recover.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&/^(recover|복구|復旧)$/u.test(recover.value.trim()))resolve();}));recover.remove();packs=[];restored=undefined;content=createContentRegistry([builtinPack]);

}
if (!restored) await receiveCreationOracle(i18n);
const game = new Game(document.querySelector('#world'), { i18n, restored, packs, content });
try {
  await game.start();
  status.textContent = i18n.t('app.navigationHint');
  // Read-only inspection is useful for browser verification.
  globalThis.pixelHeaven = game;
} catch (error) {
  game.stop();
  status.textContent = i18n.t('app.startFailed', { error: error.message });
  status.setAttribute('role', 'alert');
  console.error(error);
}
