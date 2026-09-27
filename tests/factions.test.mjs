import assert from 'node:assert/strict';
import { Factions, createFactions, createSeededRandom, chooseHostileFaction, allySupport, FACTION_RULES } from '../src/game/Factions.js';
import { FactionsPanel } from './fixtures/legacy/ui/Factions.js';
import { factionCatalogs } from '../src/i18n/factions.js';

function fixture() {
  return { state: { time: 0, weather: 'clear', resources: { food: 10, wood: 20, stone: 0 },
    villages: [{ id: 'home', population: 8, food: 10, wood: 20 }], recent_events: [],
    occupied: new Map([['1000,1000', { type: 'house' }]]), entities: new Map([['priest', { x: 1000, y: 1000 }]]) } };
}

for (const count of [20, 24, 30]) {
  const factions = createFactions({ count, seed: 7 });
  assert.equal(factions.length, count);
  assert.equal(new Set(factions.map(faction => faction.id)).size, count);
  assert.ok(factions.some(faction => faction.stance === 'hostile'));
  assert.ok(factions.some(faction => faction.stance === 'allied'));
  for (const faction of factions) {
    assert.equal('anchor' in faction, false);
    assert.equal('population' in faction, false);
    for (const locale of ['ko', 'en', 'ja']) assert.ok(factionCatalogs[locale][faction.nameKey]);
  }
}
for (const count of [0, 19, 31, 24.5]) assert.throws(() => createFactions({ count }), RangeError);
assert.deepEqual(createFactions({ seed: 'world-a' }), createFactions({ seed: 'world-a' }));
assert.notDeepEqual(createFactions({ seed: 'world-a' }), createFactions({ seed: 'world-b' }));
const randomA = createSeededRandom(0);
const randomB = createSeededRandom(0);
assert.deepEqual(Array.from({ length: 12 }, randomA), Array.from({ length: 12 }, randomB));

const a = fixture();
const b = fixture();
const events = [];
const simulationA = new Factions(a, { seed: 41, onEvent: event => events.push(event) });
const simulationB = new Factions(b, { seed: 41 });
const initialFactions = structuredClone(a.state.factions);
const initialMap = structuredClone({ occupied: a.state.occupied, entities: a.state.entities });
for (let tick = 1; tick <= 6000; tick++) {
  a.state.time = b.state.time = tick;
  simulationA.update(); simulationB.update();
  if (tick < FACTION_RULES.interval) assert.deepEqual(a.state.factions, initialFactions, 'Groups update on a slow interval');
  assert.equal(a.state.factions.length, 24);
  assert.ok(a.state.factionHistory.length <= FACTION_RULES.historyLimit);
  assert.ok(a.state.recent_events.length <= 50);
}
assert.deepEqual(a.state, b.state, 'A fixed seed reproduces the whole external-world history and home aid');
assert.deepEqual({ occupied: a.state.occupied, entities: a.state.entities }, initialMap, 'External groups never create map objects or pawns');
assert.equal(a.state.villages.length, 1);
assert.equal(a.state.villages[0].population, 8, 'Outside simulation never causes unannounced home casualties');
assert.ok(a.state.villages[0].food >= 10, 'Immediate effects on home are positive aid only');
for (const action of ['faction_raid', 'faction_trade', 'faction_alliance', 'faction_conflict', 'faction_recovery', 'faction_truce', 'faction_aid']) {
  assert.ok(events.some(event => event.action === action), `${action} must happen in the seeded world`);
}
assert.ok(events.some(event => event.actor.startsWith('faction-') && event.target.startsWith('faction-')));
for (const faction of a.state.factions) {
  assert.ok(Number.isFinite(faction.strength) && faction.strength >= 5 && faction.strength <= 100);
  for (const amount of Object.values(faction.resources)) assert.ok(Number.isFinite(amount) && amount >= 0 && amount <= FACTION_RULES.maxResource);
  for (const [peer, relation] of Object.entries(faction.relations)) {
    assert.equal(a.state.factions.find(group => group.id === peer).relations[faction.id], relation);
  }
}
for (const score of ['threat', 'support', 'trade']) assert.ok(a.state.worldConditions[score] >= 0 && a.state.worldConditions[score] <= 100);
const beforeRepeat = structuredClone(a.state);
simulationA.update();
assert.deepEqual(a.state, beforeRepeat, 'The same tick cannot be processed twice');

// Serialized plain state carries the PRNG position and next update time.
const restored = { state: structuredClone(a.state) };
const resumed = new Factions(restored, { seed: 999 });
for (let tick = 6001; tick <= 6300; tick++) {
  a.state.time = restored.state.time = tick;
  simulationA.update(); resumed.update();
}
assert.deepEqual(restored.state, a.state, 'Restoring state does not restart its random sequence');
const snapshot = simulationA.snapshot();
snapshot.factions[0].resources.food = -99;
assert.notEqual(a.state.factions[0].resources.food, -99);

const hostile = chooseHostileFaction(a.state, () => 0.5);
assert.equal(hostile.stance, 'hostile');
hostile.strength = -100;
assert.ok(a.state.factions.find(group => group.id === hostile.id).strength > 0);
assert.ok(allySupport(a.state) >= 0 && allySupport(a.state) <= 1);
assert.equal(chooseHostileFaction({ factions: a.state.factions.map(faction => ({ ...faction, stance: 'allied' })) }), null);

const aidWorld = fixture();
const aid = new Factions(aidWorld);
aidWorld.state.time = 60;
const foodTotal = () => aidWorld.state.villages[0].food + aidWorld.state.factions.reduce((sum, faction) => sum + faction.resources.food, 0);
const priorFood = foodTotal();
aid.updateHomeAid();
assert.equal(aidWorld.state.villages[0].food, 16);
assert.equal(foodTotal(), priorFood, 'Aid transfers real faction resources to the settlement');

// Render the real panel against a small DOM surface: the roster contains no
// command controls, and reading it cannot mutate faction or settlement state.
class Node {
  constructor(tag, document) { this.tagName = tag; this.ownerDocument = document; this.children = []; this.dataset = {}; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener() {}
}
const document = { createElement(tag) { return new Node(tag, this); } };
const host = new Node('section', document);
let unsubscribed = false;
const i18n = { locale: 'en', t: key => factionCatalogs.en[key] ?? key,
  formatMessage: event => event.message, subscribe: () => () => { unsubscribed = true; } };
const beforePanel = structuredClone(a.state);
const panel = new FactionsPanel(host, a.state, i18n);
const flatten = node => [node, ...node.children.flatMap(flatten)];
const nodes = flatten(host);
assert.equal(nodes.filter(node => node.dataset.factionId).length, 24);
assert.equal(nodes.filter(node => ['button', 'input', 'select', 'form'].includes(node.tagName)).length, 0);
assert.deepEqual(a.state, beforePanel);
panel.dispose();
assert.equal(unsubscribed, true);
console.log('factions: passed');
