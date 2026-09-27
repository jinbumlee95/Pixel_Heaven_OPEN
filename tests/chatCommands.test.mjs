import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { ChatCommands, parseChatCommand, executeChatOrder } from '../src/game/ChatCommands.js';
import { decisionQueue } from '../src/game/DecisionQueue.js';
import { encodeWorld, decodeWorld } from '../src/state/Persistence.js';
import { interpretDivineMessage } from '../src/llm/divineLLM.js';

for(const [texts,name]of [
  [['자원 보여줘','show resources','資源を見せて'],'resources'],[['저장해','save','保存'],'save'],
  [['농부를 세 명 배치해','assign farming 3','農民3人配置'],'labor'],[['양 구매','buy sheep','羊購入'],'buy'],
  [['수락 proposal-1','accept proposal-1','proposal-1承諾'],'offer'],[['홍수부터 대비해','prepare flood','洪水対策'],'respond'],
  [['forecast-1 맡겨','ignore forecast-1','forecast-1任せる'],'ignore']])
  for(const text of texts)assert.equal(parseChatCommand(text)?.name,name,text);
for(const text of ['do not buy sheep','농부 3명 배치하지 마','羊購入しない','assign farming -1','buy sheep and food','ignore forecast-1 and respond forecast-2'])
  assert.ok(!['order','decision'].includes(parseChatCommand(text)?.type),text);
assert.equal(parseChatCommand('proposal-2拒否').accept,false);
assert.equal(parseChatCommand('농부를 세 명 배치해').amount,3);
const g=new Game(null,{ritual:false,interpret:interpretDivineMessage,decideWorld:async()=>null});
const c=new ChatCommands(g),h=g.world.getVillage('home');
const costReply=(await c.send('비용')).message;
const allianceCost=costReply.split('\n').find(line=>line.startsWith(g.i18n.t('cw.action.propose_alliance')));
assert.ok(allianceCost.includes(`${g.i18n.t('resource.food')} 4`) && allianceCost.includes(`${g.i18n.t('resource.silver')} 1`),'Diplomacy costs include supplies as well as faith');
let points=g.world.state.faith.points;
assert.equal((await c.send('자원 보여줘')).ok,true);
assert.equal(g.world.state.faith.points,points,'Queries never spend faith');
assert.equal((await c.send('농부 3명 배치')).ok,true);
assert.equal(h.labor.farming,3);assert.equal(g.world.state.faith.points,points-2);
points=g.world.state.faith.points;
assert.equal((await c.send('농부 999명 배치')).ok,false);assert.equal(g.world.state.faith.points,points);
assert.equal((await c.send('pause')).ok,true);
assert.equal((await c.send('give 10 food')).code,'paused');
assert.equal((await c.send('show resources')).ok,true);await c.send('resume');
const cards=decisionQueue(g.world.state),card=cards[0],deadline=card.object.startAt;
assert.equal((await c.send('맡겨')).code,'ambiguous');
assert.equal((await c.send(card.id)).ok,true,'A target-only follow-up completes clarification');
assert.equal(card.object.playerDecision,'autonomous');assert.equal(card.object.startAt,deadline);
const restored=decodeWorld(encodeWorld(g.world));
assert.equal(decisionQueue(restored.world.state)[0].object.playerDecision,'autonomous');
card.object.stage='resolved';
assert.equal((await c.send(`respond ${card.id}`)).code,'expired');
const before=structuredClone(g.world.state);
assert.equal(executeChatOrder(g.world,{type:'order',name:'labor',role:'farming',amount:-1}).ok,false);
assert.deepEqual(g.world.state,before,'Validation failure never mutates state');
assert.equal((await c.send('양 구매')).ok,false,'No caravan cannot charge faith');
assert.equal(g.world.state.faith.points,points);
g.stop();
// A management oracle cannot apply before visible reception, and survives a
// save during travel without paying twice or losing its exact structured order.
const traveling=new Game(null,{ritual:true});
const order={type:'order',name:'labor',role:'farming',amount:3,original:'농부 3명 배치'};
const waiting=traveling.sendDivineMessage(order.original,'home',{order});
await Promise.resolve();await Promise.resolve();
assert.equal(traveling.world.getVillage('home').labor.farming,4);
const saved=traveling.snapshot();traveling.stop();await waiting;
const resumed=new Game(null,{ritual:true,restored:decodeWorld(saved)}),entry=resumed.divineHistory[0];
const delivery=resumed.sendDivineMessage(entry.message,'home',{order:entry.order,resumeEntry:entry});
for(let n=0;n<120;n++){resumed.ritual.update(250);await Promise.resolve();}
assert.equal((await delivery).ok,true);assert.equal(resumed.world.getVillage('home').labor.farming,3);
assert.equal(resumed.world.state.faith.spent,2);assert.equal(resumed.divineHistory.length,1);
resumed.stop();
console.log('chat commands: passed');
