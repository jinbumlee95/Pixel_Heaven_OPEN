import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { ChatCommands } from '../src/game/ChatCommands.js';
import { I18n } from '../src/i18n/I18n.js';
import { stepWorld } from '../src/game/WorldStep.js';
import { decodeWorld } from '../src/state/Persistence.js';
// Actual economy, work, dungeon and save paths. No inventory/faith grants,
// no forced event/hero state and no accelerated production coefficients.
for(const seed of [42,91,314]) {
 const g=new Game(null,{seed,i18n:new I18n({locale:'en',storage:null})});g.commands=new ChatCommands(g);
 const advance=async seconds=>{for(let n=0;n<seconds;n++)await stepWorld(g,1000);};
 const send=async message=>{const r=await g.commands.send(message);assert.equal(r.ok,true,message+': '+JSON.stringify(r));return r;};
 try {
  await send('Send the hero to the dungeon.');await advance(120);
  await send('build sawmill');await advance(80);
  await send('produce planks 3');await advance(160);
  assert.equal(g.world.getVillage('home').planks,6);
  assert.ok(g.world.state.hero.dungeonsCleared>0);
  assert.ok(g.world.state.hero.level>1);
  await send('Bring the hero home.');await advance(45);
  assert.equal(g.world.state.hero.mode,'home');
  const restored=decodeWorld(g.snapshot());
  assert.equal(restored.world.getVillage('home').planks,6);
  assert.equal(restored.world.state.hero.level,g.world.state.hero.level);
  await advance(1400);
  assert.ok(g.world.getVillage('home').population>=8,'settlement survives 30 minutes without resource injection');
  assert.ok(g.world.state.faith.points>=0);
  assert.ok(Number.isFinite(g.world.getVillage('home').food));
 } finally {g.stop();}
}
console.log('englishPlaythrough: 3 normal-start 30-minute runs passed');
