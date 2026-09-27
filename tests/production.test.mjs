import assert from 'node:assert/strict';
import { createInitialWorld } from '../src/game/World.js';
import { WorkSystem, queueConstruction } from '../src/game/Work.js';
import { queueProduction, cancelProduction, productionReason, validProduction } from '../src/game/Production.js';
import { tick } from '../src/game/Simulation.js';
import { encodeWorld, decodeWorld } from '../src/state/Persistence.js';
import { parseChatCommand, executeChatOrder } from '../src/game/ChatCommands.js';
import { RECIPES } from '../src/content/production.js';
import { I18n } from '../src/i18n/I18n.js';
import { productionSummary } from '../src/game/ProductionCommands.js';
import { Game } from '../src/game/Game.js';
import { ChatCommands } from '../src/game/ChatCommands.js';
import { quoteTrade, initializeVisit } from '../src/game/Trading.js';

const w = createInitialWorld(), work = new WorkSystem(w), h = w.getVillage('home'), events = [];
work.onEvent = e => events.push(e);
const advance = n => { for (let i = 0; i < n; i++) { w.state.time++; work.update(); } };
h.wood = 100; h.stone = 100; h.iron_ore = 20; h.fiber = 30; h.coal = 20;
assert.equal(queueProduction(w, 'smelt', 2).code, 'facility');
assert.ok(queueConstruction(w, { action: 'build_smelter' }).ok);
assert.ok(queueConstruction(w, { action: 'build_weaver' }).ok);
advance(90);
assert.equal([...w.state.buildings.values()].filter(b => ['smelter', 'weaver'].includes(b.type)).length, 2);
const iron = h.iron, cloth = h.cloth;
assert.ok(queueProduction(w, 'smelt', 2).ok); assert.equal(h.iron_ore, 16);
assert.ok(queueProduction(w, 'weave', 2).ok); assert.equal(h.fiber, 24);
advance(10);
const restored = decodeWorld(encodeWorld(w)).world, restoredWork = new WorkSystem(restored);
for (let i = 0; i < 50; i++) { advance(1); restored.state.time++; restoredWork.update(); }
assert.deepEqual(restored.state, w.state, 'mid-production save resumes identically');
assert.equal(h.iron, iron + 2); assert.equal(h.cloth, cloth + 4);
assert.equal(events.filter(e => e.action === 'production_complete').length, 2);
work.update(); assert.equal(h.iron, iron + 2, 'same tick cannot award twice');

assert.ok(queueProduction(w, 'smelt', 2).ok); advance(12);
assert.equal(h.iron, iron + 3);
assert.ok(cancelProduction(w, 'smelt').ok); assert.equal(h.iron_ore, 14, 'only unconsumed batch returns');
assert.equal(cancelProduction(w, 'smelt').ok, false);
assert.ok(queueProduction(w, 'weave', 1).ok);
h.labor.crafting = 0; advance(30);
const job = w.state.production.jobs.at(-1);
assert.equal(productionReason(w, job), 'workers'); assert.equal(job.progress, 0);
h.labor.crafting = 1; h.cloth = 1000; advance(20);
assert.equal(productionReason(w, job), 'capacity'); assert.equal(job.completed, 0);
h.cloth = 998; advance(10); assert.equal(h.cloth, 1000);
assert.equal(job.status, 'complete');
assert.ok(queueProduction(w, 'smelt', 1).ok);
const smelter = [...w.state.buildings.values()].find(b => b.type === 'smelter');
smelter.damage = 100; advance(12);
assert.equal(productionReason(w, w.state.production.jobs.at(-1)), 'facility');
assert.equal(w.state.production.jobs.at(-1).progress, 0);
smelter.damage = 50; advance(12); assert.equal(w.state.production.jobs.at(-1).progress, 6);
smelter.damage = 0; advance(6); assert.equal(w.state.production.jobs.at(-1).status, 'complete');
assert.equal(queueProduction(w, '__proto__', 1).ok, false);
for (const count of [-1, 0, 1.5, 21, NaN]) assert.equal(queueProduction(w, 'smelt', count).ok, false);

const before = encodeWorld(w);
assert.equal(executeChatOrder(w, { type: 'order', name: 'produce', recipeId: 'smelt', count: 100 }).ok, false);
assert.equal(encodeWorld(w), before);
assert.ok(validProduction(w.state.production, w.state.time));
for (const mutate of [p => p.jobs[0].reserved.iron_ore = 999, p => p.jobs[0].recipeId = 'made_up', p => p.jobs.push(p.jobs[0]), p => p.jobs[0].progress = -1]) {
  const document = JSON.parse(before); mutate(document.state.production);
  assert.throws(() => decodeWorld(JSON.stringify(document)), /invalid_production/u);
}
const old = JSON.parse(before); old.version = 2;
delete old.state.production; delete old.state.villages[0].productionVersion;
delete old.state.villages[0].iron_ore; delete old.state.villages[0].fiber;
const migrated = decodeWorld(JSON.stringify(old)).world;
assert.equal(migrated.getVillage('home').iron, h.iron);
assert.equal(migrated.getVillage('home').iron_ore, 0);
assert.equal(migrated.getVillage('home').fiber, 0);
assert.equal(encodeWorld(decodeWorld(encodeWorld(migrated)).world), encodeWorld(migrated));
new WorkSystem(migrated); tick(migrated.state);
assert.ok(migrated.getVillage('home').iron_ore > 0, 'old map has a raw material path');
const fresh = createInitialWorld(); new WorkSystem(fresh); const fh = fresh.getVillage('home');
fh.coal = 50; fh.food = 100; fh.iron = 0; fh.cloth = 0;
for (let i = 0; i < 30; i++) tick(fresh.state);
assert.equal(fh.iron, 0, 'coal alone cannot create iron'); assert.equal(fh.cloth, 0, 'food alone cannot create cloth');
assert.ok(fh.iron_ore > 0 && fh.fiber > 0);

for (const words of ['제련소 지어줘', 'build smelter', '製錬所を建てて', '직조소 지어줘', 'build weaver', '織物工房を建てて']) assert.equal(parseChatCommand(words).name, 'workshop');
for (const words of ['제련 3회', 'smelt 3', '製錬3回', '직조 2회', 'weave 2', '織布2回']) assert.equal(parseChatCommand(words).name, 'produce');
for (const words of ['제련하지 마', 'do not smelt 3', '製錬しない', '철이 부족하면 제련 3회']) assert.equal(parseChatCommand(words).type, 'invalid');
for (const words of ['나무 얼마나 있어?', '자원 알려줘', '섬유 보여줘']) assert.ok(['resources','question'].includes(parseChatCommand(words).name));
assert.equal(parseChatCommand('홍수에 대비해줘').kind, 'flood');
for (const locale of ['ko', 'en', 'ja']) {
  const i18n = new I18n({ locale, storage: null });
  assert.doesNotMatch(productionSummary(w, i18n), /production\.|resource\.|work\.type/u);
  assert.doesNotMatch(productionSummary(w, i18n, true), /production\.|resource\.|work\.type/u);
}
for (const recipe of Object.values(RECIPES)) assert.ok(Object.keys(recipe.inputs).length && (Object.keys(recipe.outputs).length || recipe.equipment));
for (const [locale, build, order] of [['ko', '제련소 지어줘', '제련 2회'], ['en', 'build smelter', 'smelt 2'], ['ja', '製錬所を建てて', '製錬2回']]) {
  const game = new Game(null, { i18n: new I18n({ locale, storage: null }) }), chat = new ChatCommands(game), home = game.world.getVillage('home');
  Object.assign(home, { wood: 100, stone: 100, copper: 10, iron_ore: 4, coal: 5 });
  assert.ok((await chat.send(build)).ok);
  for (let i = 0; i < 45; i++) { game.world.state.time++; game.work.update(); }
  const faith = game.world.state.faith.points;
  assert.ok((await chat.send(order)).ok); assert.equal(home.iron_ore, 0);
  assert.equal(game.world.state.faith.points, faith - 2);
  const visit = { id: 'caravan-99', source: game.world.state.factions[0].id, stage: 'visiting', arriveAt: 0, departAt: 200, stock: { iron_ore: 10 }, earned: 0 };
  game.world.state.life.caravan = visit; initializeVisit(game.world, visit);
  assert.equal(quoteTrade(game.world, { visitId: visit.id, commandId: 'reserved-sale', lines: [{ side: 'sell', resource: 'iron_ore', amount: 1 }] }).ok, false, 'reserved ore cannot be sold');
  const funded = game.world.state.faith.points;
  assert.equal((await chat.send(order)).ok, false); assert.equal(game.world.state.faith.points, funded, 'failed order costs no faith');
  game.stop();
}
console.log('production: reservation, capacity, refunds, migration, repeat settlement and multilingual boundaries passed');
