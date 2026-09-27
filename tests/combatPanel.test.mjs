import assert from 'node:assert/strict';
import { CombatPanel } from './fixtures/legacy/ui/Combat.js';
import { createWorldState } from '../src/state/worldState.js';
import { I18n } from '../src/i18n/I18n.js';

class Node {
  constructor(tag, document) { this.tagName = tag; this.ownerDocument = document; this.children = []; this.dataset = {}; this.handlers = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
}
const document = { createElement(tag) { return new Node(tag, this); } };
const host = document.createElement('section');
const state = createWorldState();
const i18n = new I18n({ locale: 'en', storage: null });
const upcoming = { id: 'raid-next', kind: 'raid', stage: 'forecast', startAt: 720,
  entryDirection: 'east', enemyComposition: ['archer', 'archer'] };
state.eventQueue = [upcoming];
state.combat = { stage: 'resolved', planId: 'raid-previous', units: [
  { side: 'home', role: 'swordsman', hp: 13, maxHp: 40 },
  { side: 'enemy', role: 'rogue', hp: 2, maxHp: 22 },
], works: [{ type: 'cover', hp: 14 }] };
let requested;
const before = structuredClone(state);
const panel = new CombatPanel(host, state, i18n, (kind, planId) => { requested = { kind, planId }; });
assert.equal(panel.planId, upcoming.id);
assert.equal(panel.status.textContent, i18n.t('combat.stage.idle'));
assert.equal(panel.counts.textContent, i18n.t('combat.squad', { home: 0, allies: 0, enemies: 0 }));
assert.equal(panel.roster.textContent, '', 'Prior survivors cannot be presented as the upcoming raid roster');
assert.equal(panel.works.textContent, i18n.t('combat.works', { cover: 0, barricade: 0, trap: 0 }));
assert.ok(panel.plan.textContent.includes('east'));
assert.ok(panel.scouted.textContent.includes('Archer 2'));
assert.deepEqual(state, before, 'Changing the panel does not discard the rendered previous battle');
panel.buttons[0].button.handlers.click();
assert.deepEqual(requested, { kind: panel.buttons[0].kind, planId: upcoming.id });

state.combat = { ...state.combat, stage: 'fighting', planId: upcoming.id };
upcoming.stage = 'active';
panel.update(state);
assert.equal(panel.status.textContent, i18n.t('combat.stage.fighting'));
assert.equal(panel.counts.textContent, i18n.t('combat.squad', { home: 1, allies: 0, enemies: 1 }));
assert.equal(panel.roster.textContent, i18n.t('combat.health', { role: 'Swordsman', hp: 13, max: 40 }));
assert.equal(panel.works.textContent, i18n.t('combat.works', { cover: 1, barricade: 0, trap: 0 }));

// A future preparation can exist without owning the currently retained map
// battle. Show that forecast's defenses, without borrowing old soldier HP.
state.combat.stage = 'resolved';
state.combat.planId = 'raid-previous';
upcoming.stage = 'forecast';
upcoming.battlePreparation = { kinds: ['trap'], works: [{ type: 'trap', hp: 1 }] };
panel.update(state);
assert.equal(panel.roster.textContent, '');
assert.equal(panel.works.textContent, i18n.t('combat.works', { cover: 0, barricade: 0, trap: 1 }));
assert.equal(panel.buttons.find(item => item.kind === 'trap').button.disabled, true);

state.eventQueue = [];
panel.update(state);
assert.equal(panel.plan.textContent, i18n.t('combat.empty'));
assert.equal(panel.status.textContent, i18n.t('combat.stage.idle'));
assert.equal(panel.roster.textContent, '');
assert.ok(panel.buttons.every(item => item.button.disabled));
panel.dispose();
assert.equal(i18n.listeners.size, 0);
console.log('combatPanel: passed');
