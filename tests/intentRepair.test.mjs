import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { interpretDivineMessage } from '../src/llm/divineLLM.js';
import { LocalAI } from '../src/llm/LocalAI.js';

for (const message of ['Give us 10 food', '식량 10을 내려라', '食料を10与えて']) {
  const game = new Game(null);
  const home = game.world.getVillage('home');
  const before = home.food;
  const result = await game.sendDivineMessage(message);
  assert.equal(result.ok, true, message);
  assert.equal(home.food - before, 10, message);
  assert.equal(result.faithCost, 4);
  game.stop();
}
for (const message of ['Protect our people', 'Defend village', 'Protect our village from the enemy', '우리 마을을 지켜라', '村を守って']) {
  assert.equal((await interpretDivineMessage(message)).action, 'prepare_defense', message);
}
for (const message of ['Give us -10 food', 'Give us 1.5 food', 'Give us 2000 food', 'Give us 10 or 20 food']) {
  assert.equal((await interpretDivineMessage(message)).status, 'unclear', message);
}
for (const [message, action] of [['Build a house', 'build_house'], ['밭을 만들어라', 'farm'], ['神殿を建てて', 'build_temple']]) {
  assert.equal((await interpretDivineMessage(message)).action, action, message);
}
let calls = 0;
const ai = new LocalAI({ api: { availability: async () => 'available', create: async () => ({ destroy() {},
  clone: async () => ({ destroy() {}, prompt: async p => { calls++; return p.startsWith('Verify')?'{"matches":true}':JSON.stringify({intent:'prepare_defense',value:'balanced',amount:0,direction:'',target:'home'}); } }) }) } });
await ai.detect(); await ai.enable();
assert.equal((await ai.interpret('Protect our people…', { defaultTarget: 'home' })).action, 'prepare_defense');
assert.equal(calls, 2);
ai.stop();
const wrongAmount=new LocalAI({api:{availability:async()=> 'available',create:async()=>({destroy(){},clone:async()=>({destroy(){},prompt:async(p)=>p.startsWith('Verify')?'{"matches":true}':JSON.stringify({intent:'increase_food',value:'',amount:50,direction:'',target:'home'})})})}});
await wrongAmount.detect();await wrongAmount.enable();
assert.equal((await wrongAmount.interpret('식량 10을 주어라',{defaultTarget:'home'})).status,'unclear');
assert.equal(wrongAmount.traces.divine.reason,'invalid_output');wrongAmount.stop();
const builder = new Game(null);
const home = builder.world.getVillage('home'); home.wood = 100; home.stone = 100; home.cloth = 10;
const beforeHouses = home.houseCount;
assert.equal((await builder.sendDivineMessage('Build a house northeast of our village')).ok, true);
assert.equal(home.houseCount, beforeHouses, 'construction takes work rather than appearing instantly');
assert.equal(builder.world.state.work.jobs[0].type, 'house');
assert.equal(builder.world.state.faith.points, 22);
const next = await builder.sendDivineMessage('Give us -10 food');
assert.equal(next.code, 'unclear');
assert.equal(builder.world.state.faith.points, 22);
builder.stop();
for(const message of ['faction-02에 동맹을 제안하라','propose an alliance faction-02','faction-02に同盟を提案']){
  const g=new Game(null);const result=await g.sendDivineMessage(message);assert.equal(result.ok,true,message);assert.equal(g.world.state.diplomacy.proposals[0].factionId,'faction-02');g.stop();
}
console.log('intentRepair: passed');
