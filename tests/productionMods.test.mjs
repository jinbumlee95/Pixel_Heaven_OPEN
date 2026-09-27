import { initializeVisit, tradeBasket } from '../src/game/Trading.js';
import assert from 'node:assert/strict';
import { createContentRegistry } from '../src/content/ContentRegistry.js';
import { builtinPack } from '../src/content/builtin.js';
import { Game } from '../src/game/Game.js';
import { WorkSystem, queueConstruction } from '../src/game/Work.js';
import { queueProduction, productionReason, useProducedGoods } from '../src/game/Production.js';
import { parseChatCommand, executeChatOrder } from '../src/game/ChatCommands.js';
import { encodeWorld, decodeWorld, SAVE_VERSION } from '../src/state/Persistence.js';
import { RESOURCE_TYPES, stockLimit } from '../src/state/economy.js';
import { tick } from '../src/game/Simulation.js';
const pack={schemaVersion:1,id:'artisan',version:'1.0.0',translations:Object.fromEntries(['ko','en','ja'].map(l=>[l,{'artisan.inlay':l==='ko'?'상감재':l==='ja'?'象嵌材':'Inlay','artisan.make':'Inlay processing','artisan.export':'Export craft'}])),
 resources:[{id:'artisan:inlay',labelKey:'artisan.inlay',baseValue:1.8,storageClass:'materials',stackLimit:50}],
 recipes:[{id:'artisan:inlay',labelKey:'artisan.make',buildingTag:'smith',inputs:{copper:2},outputs:{'artisan:inlay':1},workSeconds:10},
 {id:'artisan:export',labelKey:'artisan.export',buildingTag:'smith',inputs:{'artisan:inlay':1,wood:8},outputs:{crafts:1},workSeconds:20}]};
const content=createContentRegistry([builtinPack,pack]);assert.equal(Object.keys(content.resources).length,18);assert.ok(Object.isFrozen(content.recipes));
const g=new Game(null,{content,packs:[pack]}),w=g.world,h=w.getVillage('home');for(const id of RESOURCE_TYPES)h[id]=200;h.tools=0;
const advance=n=>{for(let j=0;j<n;j++){w.state.time++;g.work.update();}};
assert.ok(queueConstruction(w,{action:'build_smith'}).ok);advance(50);
assert.ok(executeChatOrder(w,parseChatCommand('생산 artisan:inlay 2')).ok);advance(10);
const restored=new Game(null,{restored:decodeWorld(g.snapshot())});advance(10);for(let j=0;j<10;j++){restored.world.state.time++;restored.work.update();}
assert.deepEqual(restored.world.state,w.state,'embedded pack and recipe snapshot continue identically');assert.equal(h['artisan:inlay'],2);
assert.ok(queueProduction(w,'artisan:export',1).ok);advance(20);assert.equal(h['artisan:inlay'],1);assert.equal(h.crafts,201);
for(const mutate of [p=>p.resources[0].stackLimit=999999,p=>p.recipes[0].outputs={'unknown':1},p=>delete p.translations.ja['artisan.inlay'],p=>p.recipes[0].execute='javascript',p=>p.resources.push({...p.resources[0]}),p=>p.recipes[1].outputs={copper:1}]){
 const bad=structuredClone(pack);mutate(bad);assert.throws(()=>createContentRegistry([builtinPack,bad]));
}
const visit={id:'caravan-99',source:w.state.factions[0].id,stage:'visiting',arriveAt:w.state.time,departAt:w.state.time+1000,stock:{food:0,herbs:0,cloth:0,sheep:0,'artisan:inlay':3},earned:0};w.state.life.caravan=visit;initializeVisit(w,visit);
const silver=h.silver;assert.ok(tradeBasket(w,{...parseChatCommand('buy artisan:inlay 1'),visitId:visit.id,commandId:'mod-buy'}).ok);assert.equal(h['artisan:inlay'],2);assert.ok(h.silver<silver);assert.ok(decodeWorld(g.snapshot()));
assert.equal(tradeBasket(w,{...parseChatCommand('buy missing:inlay 1'),visitId:visit.id,commandId:'bad-mod'}).ok,false);
const bad=JSON.parse(g.snapshot());bad.state.production.jobs[0].recipe.outputs['artisan:inlay']=100;assert.throws(()=>decodeWorld(JSON.stringify(bad)),/invalid_production/);
for(const facility of ['sawmill','apothecary','kitchen']){assert.ok(queueConstruction(w,{action:`build_${facility}`}).ok);advance(50);}
for(const id of ['planks','tools','medicine','rations','crafts']){
 const before=h[id];assert.ok(queueProduction(w,id,1).ok);advance(30);assert.ok(h[id]>before,id);
}
h.happiness=50;const crafts=h.crafts;assert.ok(useProducedGoods(w,'crafts').ok);assert.equal(h.crafts,crafts-2);assert.equal(h.happiness,62);
w.state.hero.hp-=20;const medicine=h.medicine;assert.ok(useProducedGoods(w,'medicine').ok);assert.equal(h.medicine,medicine-1);
assert.ok(queueConstruction(w,{action:'build_warehouse'}).ok);advance(45);assert.equal(stockLimit(h,'iron'),1500);
h.iron=1200;const warehouse=[...w.state.buildings.values()].find(b=>b.type==='warehouse');warehouse.damage=100;advance(1);tick(w.state);advance(1);assert.equal(h.iron,1200,'damaged warehouse does not erase overflow');
assert.ok(queueProduction(w,'smelt',1).ok===false,'missing smelter');
// v3 runtime migration preserves old quantities and pending pre-snapshot jobs.
const base=new Game(null);const old=JSON.parse(base.snapshot());old.version=3;delete old.state.hero.equipment;for(const id of ['tools','planks','medicine','rations','crafts'])delete old.state.villages[0][id];
const loaded=new Game(null,{restored:decodeWorld(JSON.stringify(old))});assert.equal(loaded.world.getVillage('home').tools,0);assert.equal(loaded.world.state.hero.equipment.items.length,1);
const loadedAgain=new Game(null,{restored:decodeWorld(loaded.snapshot())});assert.equal(loadedAgain.world.state.hero.equipment.items.length,1);assert.equal(JSON.parse(loadedAgain.snapshot()).version,SAVE_VERSION);
for(const game of [g,restored,base,loaded,loadedAgain])game.stop();
console.log('production mods: schema, localization, bounded cycles, custom chain, snapshot/migration and warehouse overflow passed');
