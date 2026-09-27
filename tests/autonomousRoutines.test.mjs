import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { ChatCommands, parseChatCommand } from '../src/game/ChatCommands.js';
import { prepareBattle, requestBattleCleanup, CLEANUP_RULES } from '../src/game/Combat.js';
import { encodeWorld, decodeWorld } from '../src/state/Persistence.js';
import { interpretDivineMessage } from '../src/llm/divineLLM.js';

for (const s of ['전투 준비해','알아서 전투 준비해','습격에 대비해','prepare for battle','戦闘準備'])
  assert.deepEqual(parseChatCommand(s),{type:'decision',name:'respond',kind:'raid'});
for (const s of ['전투 끝나면 방어 시설 정리해','전투 끝나면 정리해','장애물 철거해','장애물 삭제해','clean up defenses after battle','戦闘後に防衛設備を片付けて'])
  assert.equal(parseChatCommand(s)?.name,'cleanup');
for (const s of ['방어 시설 정리하지 마','do not remove defenses','防衛設備を撤去しないで'])
  assert.notEqual(parseChatCommand(s)?.name,'cleanup');
const g=new Game(null,{random:()=>0,ritual:false,interpret:interpretDivineMessage,decideWorld:async()=>null});
const c=new ChatCommands(g), state=g.world.state, home=g.world.getVillage('home');
const plan=state.eventQueue.find(p=>p.kind==='raid');
const faith=state.faith.points;
assert.equal((await c.send('알아서 전투 준비해')).ok,true);
assert.deepEqual(state.combat.works.map(w=>w.type),['cover','barricade','trap']);
assert.equal(state.combat.units.length,4);
assert.ok(state.faith.points<faith);
const beforeRepeat=structuredClone(state);
assert.equal((await c.send('전투 준비해')).ok,false);
assert.deepEqual(state.resources,beforeRepeat.resources,'Duplicate preparation cannot spend supplies');
assert.deepEqual(state.faith,beforeRepeat.faith,'Duplicate preparation cannot spend faith');
assert.deepEqual(state.combat,beforeRepeat.combat);
assert.equal((await c.send('전투 끝나면 방어 시설 정리해')).ok,true);
assert.equal(plan.cleanupRequested,true);
const wrong=structuredClone(state);
assert.equal(requestBattleCleanup(g.world,'forecast-999').ok,false);
assert.deepEqual(state,wrong,'Delayed cleanup cannot attach to a different battle');
assert.equal(state.combat.works.length,3,'Scheduling cannot remove live defenses');
const restored=decodeWorld(encodeWorld(g.world));
const resumed=new Game(null,{restored,random:()=>0,ritual:false});
const rs=resumed.world.state, rp=rs.eventQueue.find(p=>p.id===plan.id);
rs.time=rp.startAt; resumed.forecasts.update();
assert.equal(rs.combat.cleanupRequested,true,'Scheduling survives save and battle start');
assert.equal(rs.combat.works.length,3);
for(let n=0;n<60 && rp.stage==='active';n++){rs.time++;resumed.forecasts.update();}
assert.equal(rp.stage,'resolved');
const outcome=structuredClone(rp.outcome), buildings=structuredClone(rs.buildings), ground=structuredClone(rs.groundTiles);
const resources=structuredClone(rs.resources);
const settledAt=rs.time;
for(let n=0;n<12;n++){rs.time++;resumed.forecasts.update();}
assert.equal(rs.combat.stage,'idle');assert.deepEqual(rs.combat.works,[]);
assert.deepEqual(rp.battlePreparation.works,[]);assert.ok(rp.cleanedAt>=settledAt);
assert.deepEqual(rp.outcome,outcome);assert.deepEqual(rs.buildings,buildings);assert.deepEqual(rs.groundTiles,ground);
assert.deepEqual(rs.resources,resources,'Cleanup has no salvage/refund exploit');
assert.equal(rs.recent_events.filter(e=>e.action==='combat_cleaned').length,1);
assert.equal(requestBattleCleanup(resumed.world).ok,false);
g.stop();resumed.stop();
// Default cleanup needs no oracle, works for existing resolved saves, and is gradual.
const auto=new Game(null,{random:()=>0,ritual:false});const as=auto.world.state;
const ap=as.eventQueue.find(p=>p.kind==='raid');
assert.equal(prepareBattle(auto.world,ap).ok,true);
ap.stage='resolved';as.combat.stage='resolved';as.combat.resolvedAt=0;
as.time=CLEANUP_RULES.delay-1;auto.battle.update();assert.equal(as.combat.works.length,3);
as.time++;auto.battle.update();assert.equal(as.combat.works.length,2);
auto.battle.update();assert.equal(as.combat.works.length,2,'Same tick cannot clear twice');
const mid=decodeWorld(encodeWorld(auto.world));const again=new Game(null,{restored:mid,random:()=>0,ritual:false});
for(let i=0;i<5;i++){again.world.state.time++;again.battle.update();}
assert.equal(again.world.state.combat.stage,'idle');auto.stop();again.stop();
console.log('autonomous routines: passed');
