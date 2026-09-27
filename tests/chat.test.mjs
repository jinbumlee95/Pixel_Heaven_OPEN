import assert from 'node:assert/strict';
import { Chat } from '../src/ui/Chat.js';
import { Counters } from './fixtures/legacy/ui/Counters.js';
import { Events } from '../src/ui/Events.js';
import { I18n } from '../src/i18n/I18n.js';
import { createInitialWorld } from '../src/game/World.js';
import { getWorldNeeds } from '../src/game/WorldNeeds.js';

// A small DOM boundary exercises event ordering and retained player state.
class Element {
  constructor() { this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.value = ''; this.textContent = ''; this.disabled = false; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  get options() { return this.children; }
  addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
  async emit(type, event = {}) { for (const callback of this.listeners[type] ?? []) await callback({ preventDefault() {}, ...event }); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  focus() { this.focused = true; }
  scrollIntoView(options) { this.scrollOptions = options; }
  querySelector(selector) { return this.nodes[selector]; }
}
const originalDocument = globalThis.document;
const text = node => node.textContent + node.children.map(text).join(' ');
const globals = Object.fromEntries(['#divine-events', '#divine-history', '#summary', '#clock', '#coordinates'].map(selector => [selector, new Element()]));
globalThis.document = { createElement: () => new Element(), querySelector: selector => globals[selector], body: { classList: { contains: () => true } } };
try {
  const host = new Element();
  host.nodes = Object.fromEntries(['form', 'textarea', 'button[type="submit"]', '[role="status"]'].map(selector => [selector, new Element()]));
  host.nodes['.reply-status'] = new Element();
  const faithPreview = host.nodes['[role="status"]'];
  faithPreview.textContent = 'Faith estimate';
  const i18n = new I18n({ locale: 'ko', storage: null });
  const world = createInitialWorld();
  let calls = 0; let finish; let sentTarget; let sentContext;
  const chat = new Chat(host, world.state.villages, (message, target, context) => {
    calls++; sentTarget = target; sentContext = context; return new Promise(resolve => { finish = resolve; });
  }, i18n);
  assert.equal(chat.target, undefined, 'single-settlement UI has no target selector');
  assert.equal(chat.status, host.nodes['.reply-status'], 'oracle replies must not share the live cost preview');
  chat.input.value = '私たちの集落に雨を'; chat.input.selectionStart = 4;
  await chat.input.emit('compositionstart');
  await chat.form.emit('submit');
  assert.equal(calls, 0, 'composing Hangul or kana never sends a command');
  await chat.input.emit('keydown', { key: 'Enter', keyCode: 229, isComposing: true });
  await chat.input.emit('compositionend');
  await chat.form.emit('submit');
  assert.equal(calls, 0, 'IME confirmation Enter cannot leak through a later submit event');
  await chat.input.emit('keyup', { key: 'Enter' });
  chat.form.requestSubmit=()=>{chat.submitted=chat.form.emit('submit');};
  await chat.input.emit('keydown',{key:'Enter',shiftKey:true});
  assert.equal(calls,0,'Shift+Enter keeps a multiline draft');
  // Some IMEs report composition keystrokes as Process/229, then release
  // Process without keyCode 229. A later real Enter must still send.
  await chat.input.emit('compositionstart');
  await chat.input.emit('keydown',{key:'Process',keyCode:229,isComposing:true});
  await chat.input.emit('compositionend');
  await chat.input.emit('keyup',{key:'Process'});
  let prevented=false;
  await chat.input.emit('keydown',{key:'Enter',preventDefault(){prevented=true;}});
  assert.equal(prevented,true,'Enter after IME Process release must send instead of inserting a newline');
  const pending=chat.submitted;
  assert.equal(calls, 1);
  assert.equal(chat.busy, true);
  assert.equal(chat.sendButton.disabled,true,'the send button cannot duplicate a pending request');
  assert.equal(host.attributes['aria-busy'], 'true');
  i18n.setLocale('ja');
  assert.equal(chat.input.value, '私たちの集落に雨を');
  assert.equal(chat.input.selectionStart, 4);
  assert.equal(sentTarget, 'home');
  assert.equal(chat.busy, true, 'language switching cannot release an in-flight request');
  assert.equal(chat.status.textContent, i18n.t('chat.pending'));
  await chat.form.emit('submit');
  assert.equal(calls, 1, 'double-submit during a pending interpretation is blocked');
  const event = { time: 7, message: 'Rain falls on Worldtree Settlement.', messageKey: 'event.divine.create_rain',
    messageParams: { village: { villageId: 'home', name: 'Worldtree Settlement' } } };
  finish({ ok: true, ...event, event });
  await pending;
  assert.equal(chat.input.value, '');
  assert.equal(chat.busy, false);
  assert.equal(chat.sendButton.disabled,false,'the send button becomes available after reception');
  assert.match(text(globals['#divine-events']), /世界樹の集落に雨/);
  chat.renderHistory([{ id: 1, time: 7, message: '<b>my original words</b>', outcome: 'applied', replyMessage: event }]);
  i18n.setLocale('en');
  assert.match(text(globals['#divine-history']), /my original words/);
  assert.match(text(globals['#divine-history']), /Rain falls on Worldtree Settlement/);
  assert.match(text(globals['#divine-events']), /Rain falls on Worldtree Settlement/);
  chat.prepareResponse('home', 'Send rain here', { planId: 'forecast-1' });
  assert.equal(chat.responsePlanId, 'forecast-1');
  i18n.setLocale('ko');
  assert.equal(chat.responsePlanId, 'forecast-1', 'language changes preserve the selected forecast');
  const targetedRequest = chat.form.emit('submit');
  assert.equal(sentContext.planId, 'forecast-1', 'the selected forecast reaches the engine boundary');
  finish({ ok: true, ...event, event }); await targetedRequest;
  assert.equal(chat.responsePlanId, undefined);
  chat.prepareResponse('home', 'Send rain here', { planId: 'forecast-2' });
  await chat.input.emit('input');
  assert.equal(chat.responsePlanId, undefined, 'manual edits release the old forecast binding');
  chat.input.value = 'Keep this draft';
  chat.prepareResponse('home', 'Make rain', { planId: 'forecast-3' });
  assert.equal(chat.input.value, 'Keep this draft');
  assert.equal(chat.responsePlanId, undefined, 'preserving a draft never attaches a different event');
  assert.equal(chat.input.scrollOptions.behavior, 'auto', 'reduced-motion preference also applies to response navigation');
  const refused = chat.form.emit('submit');
  finish({ ok: false, code: 'insufficient_faith', messageKey: 'event.divine.failure.insufficient_faith',
    messageParams: { cost: 18, available: 3 } });
  await refused;
  faithPreview.textContent = 'Updated faith estimate';
  assert.match(chat.status.textContent, /신앙이 부족합니다.*18.*3/,
    'refreshing the cost preview must leave the refusal visible');
  for (let count = 0; count < 55; count++) chat.addEvent(event);
  assert.equal(globals['#divine-events'].children.length, 50);
  assert.equal(chat.eventRecords.length, 50);

  const eventHost = new Element();
  eventHost.nodes = { '#world-needs': new Element(), '#world-events': new Element() };
  let suggestion;
  const events = new Events(eventHost, (id, example) => { suggestion = { id, example }; }, i18n);
  world.getVillage('home').food = 0;
  const needs = getWorldNeeds(world.state);
  const original = structuredClone(needs);
  events.updateNeeds(needs);
  events.add({ ...event, source: 'divine', messageId: 12 });
  i18n.setLocale('ja');
  assert.equal(eventHost.nodes['#world-events'].textContent,i18n.t('cw.empty'));
  events.add({...event,source:'factions'});
  assert.match(text(eventHost.nodes['#world-events']), /雨/);
  events.add({...event,source:'factions',messageKey:undefined,message:'latest'});
  assert.match(text(eventHost.nodes['#world-events']), /latest/);
  assert.deepEqual(needs, original);

  const counters = new Counters(new Element(), world.state, () => {}, i18n);
  counters.update(world.state, { x: 1000, y: 980 });
  assert.match(text(globals['#summary']), /食料/);
  i18n.setLocale('ko');
  assert.match(text(globals['#summary']), /식량/);
  assert.equal(counters.rows.get('home').button.textContent, '세계수 정착지');
  assert.equal(counters.rows.get('home').morale.attributes['aria-label'], '세계수 정착지 행복도');
  world.state.time = 125;
  counters.update(world.state, { x: 1000, y: 980 });
  assert.equal(globals['#clock'].textContent, '2일째 · 낮 · 경과 02:05');
  assert.match(globals['#clock'].attributes.title, /게임 하루 = 2분/);
  assert.match(text(globals['#divine-history']), /경과 00:07/);
  assert.match(text(eventHost.nodes['#world-events']), /경과 00:07/);
  assert.doesNotMatch(text(globals['#divine-history']) + text(eventHost.nodes['#world-events']), /\bTick\b|틱|ティック|시각\s*\d/u);
  chat.dispose(); events.dispose(); counters.dispose();
  assert.equal(i18n.listeners.size, 0);
} finally { globalThis.document = originalDocument; }
console.log('chat: passed');
