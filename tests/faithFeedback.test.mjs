import assert from 'node:assert/strict';
import { Game } from '../src/game/Game.js';
import { ChatCommands, parseChatCommand } from '../src/game/ChatCommands.js';
import { updateReligion, ritePreview, validReligion, religionConflict } from '../src/game/Religion.js';
import { decodeWorld } from '../src/state/Persistence.js';
import { tick } from '../src/game/Simulation.js';
import { faithCapacity, faithGenerationPerDay } from '../src/game/Faith.js';
import { religionSummary } from '../src/ui/ReligionSummary.js';
import { ECONOMY } from '../src/state/economy.js';

const cases={
 enact:['일곱째 날은 쉬어라','안식일을 지켜라','안식 계율을 선포하라','keep the sabbath','安息 戒律 宣言'],
 rite:['수확제를 열어라','수확제 열어줘','장례 치러','출정식을 열어','hold a harvest festival','収穫祭を開いて'],
 accept:['식량 기도 수락','accept food prayer','食料 祈りを受け入れる'],
 praise:['찬양해','praise','賛美して'],offering:['세계수 헌납해','offer to worldtree','世界樹に奉納'],
};
for(const [op,inputs] of Object.entries(cases))for(const text of inputs)assert.equal(parseChatCommand(text)?.operation,op,text);
for(const text of ['do not enact rest','수확제 열지 마','森林保護 撤回しない'])assert.notEqual(parseChatCommand(text)?.name,'religion',text);
const games=[];
const setup=(seed=77)=>{const g=new Game(null,{seed});games.push(g);g.world.state.faith.points=100;return {g,s:g.world.state,h:g.world.getVillage('home'),chat:new ChatCommands(g)};};
const {g,s,h,chat}=setup();
let priestNotice;g.priestView={show:event=>{priestNotice=event;}};
g.worldDecisions.record({source:'priest',actor:'home',action:'storage_wait',time:0,messageKey:'exp.wait.storage',messageParams:{}});
assert.equal(priestNotice.messageKey,'exp.wait.storage');
s.religion.commandments=['preserve'];h.labor.woodcutting=3;
assert.equal(religionConflict(s,null,{name:'labor',role:'woodcutting',amount:3}),null);
assert.equal(religionConflict(s,null,{name:'labor',role:'woodcutting',amount:1}),null);
assert.equal(religionConflict(s,null,{name:'labor',role:'woodcutting',amount:4}).ok,false);
h.labor.woodcutting=1;
h.food=0;h.cloth=0;updateReligion(s);
assert.equal((await chat.send('그 기도를 들어주마')).ok,false,'multiple requests require a named target');
assert.ok((await chat.send('식량 기도 수락')).ok);
assert.equal(s.religion.answered,0,'acceptance alone is not fulfillment');
assert.ok((await chat.send('식량 30 줘')).ok);
updateReligion(s);
assert.equal(s.religion.answered,1);
const food=s.religion.prayers.find(p=>p.kind==='food');
assert.equal(food.intervention.messageId,g.divineHistory.at(-1).id);
assert.equal(food.evidence.credited,true);
const answered=s.religion.answered;updateReligion(s);assert.equal(s.religion.answered,answered);
assert.ok(s.story.memories.some(e=>e.action==='opened'));
assert.ok(s.story.memories.some(e=>e.action==='answered'));
assert.equal(s.story.memories.find(e=>e.action==='answered').messageId,food.intervention.messageId);
h.cloth=2;updateReligion(s);assert.equal(s.religion.answered,1,'unaccepted automatic fulfillment has no progress');
assert.ok(s.story.memories.some(e=>e.action==='grateful'));

const passive=setup();passive.h.food=0;passive.h.cloth=0;updateReligion(passive.s);
await passive.chat.send('식량 기도 수락');passive.h.food=100;updateReligion(passive.s);
assert.equal(passive.s.religion.answered,0,'accepted but entirely passive resolution does not count');

// A production order retains its oracle ID through save, partial batches and completion.
const prod=setup();prod.h.food=100;prod.h.cloth=0;prod.h.fiber=30;prod.h.wood=100;prod.h.stone=100;
assert.ok((await prod.chat.send('build weaver')).ok);
for(let i=0;i<90;i++){prod.s.time++;prod.g.work.update();}
updateReligion(prod.s);assert.ok((await prod.chat.send('천 기도 수락')).ok);
assert.ok((await prod.chat.send('produce weave 1')).ok);
const job=prod.s.production.jobs.at(-1);assert.ok(job.messageId);
const restored=new Game(null,{restored:decodeWorld(prod.g.snapshot())});games.push(restored);
for(let i=0;i<40;i++){prod.s.time++;prod.g.work.update();updateReligion(prod.s);restored.world.state.time++;restored.work.update();updateReligion(restored.world.state);}
assert.equal(prod.s.religion.answered,1);assert.deepEqual(restored.world.state.religion,prod.s.religion);

const urgent=setup();urgent.h.population=10;urgent.h.food=100;urgent.h.cloth=0;updateReligion(urgent.s);
assert.equal(urgent.s.religion.prayers.filter(p=>p.status==='open').length,2);
urgent.s.hero.hp=1;urgent.s.hero.mode='home';urgent.h.medicine=0;urgent.s.time=30;updateReligion(urgent.s);
assert.ok(urgent.s.religion.prayers.some(p=>p.kind==='healing'&&p.status==='open'));
assert.ok((await urgent.chat.send('치유 기도 수락')).ok);urgent.h.medicine=3;
for(let i=0;i<3;i++)assert.ok((await urgent.chat.send('heal hero with medicine')).ok);
updateReligion(urgent.s);assert.equal(urgent.s.religion.answered,1);
const temple=setup();Object.assign(temple.h,{population:10,food:100,cloth:2,wood:100,stone:100,silver:10,gold:10});updateReligion(temple.s);
assert.ok((await temple.chat.send('성전 기도 수락')).ok);assert.ok((await temple.chat.send('build a temple')).ok);
for(let i=0;i<100;i++){temple.s.time++;temple.g.work.update();updateReligion(temple.s);}
assert.equal(temple.s.religion.answered,1,'construction completion retains the command that fulfilled it');

// Fixed per-world omen, stable across queries/save, varying across seeds.
const sequence=state=>Array.from({length:12},(_,i)=>{state.religion.riteSequence=i;return ritePreview(state,'harvest').quality;});
const omen=setup(77),other=setup(78);assert.notDeepEqual(sequence(omen.s),sequence(other.s));
assert.deepEqual(ritePreview(omen.s,'harvest'),ritePreview(decodeWorld(omen.g.snapshot()).world.state,'harvest'));
h.crafts=20;h.food=100;h.devotionUntil=9000;s.faith.points=100;
assert.ok((await chat.send('수확제를 열어라')).ok);assert.equal(h.devotionUntil,9000);
const noCraft=setup();noCraft.h.crafts=0;noCraft.h.food=100;const unchanged=noCraft.s.faith.points;
assert.equal((await noCraft.chat.send('수확제 열어')).ok,false);assert.equal(noCraft.s.faith.points,unchanged);

// Worship is an atomic long-term sink, with bounded staged costs and useful upgrades.
s.faith.points=100;assert.ok((await chat.send('찬양해')).ok);assert.ok((await chat.send('praise')).ok);
assert.equal(s.religion.worship,20);assert.equal(s.faith.points,0);
assert.equal((await chat.send('賛美して')).ok,false);assert.equal(s.religion.worship,20);
h.wood=100;h.stone=100;h.crafts=10;
const capacity=faithCapacity(s),income=faithGenerationPerDay(s);
assert.ok((await chat.send('세계수 헌납해')).ok);assert.equal(s.religion.worship,0);assert.equal(s.religion.treeLevel,1);
assert.equal(faithCapacity(s),capacity+20);assert.ok(faithGenerationPerDay(s)>income);assert.equal(h.crafts,8);
const resources=[h.wood,h.stone,h.crafts];assert.equal((await chat.send('세계수 헌납해')).ok,false);assert.deepEqual([h.wood,h.stone,h.crafts],resources);
for(const level of [2,3]){
  s.religion.worship=20*level;h.wood=20*level;h.stone=10*level;h.crafts=2*level;
  assert.ok((await chat.send('세계수 헌납해')).ok);assert.equal(s.religion.treeLevel,level);assert.equal(s.religion.worship,0);
}
assert.equal((await chat.send('세계수 헌납해')).ok,false,'completed growth cannot charge again');
assert.ok(validReligion(s.religion));assert.deepEqual(decodeWorld(g.snapshot()).world.state.religion,s.religion);
for(const [key,value] of [['worship',-1],['treeLevel',4],['omenSeed',Infinity]])assert.equal(validReligion({...s.religion,[key]:value}),false);
const legacy=JSON.parse(g.snapshot());delete legacy.state.religion.worship;delete legacy.state.religion.treeLevel;delete legacy.state.religion.omenSeed;
const migrated=new Game(null,{restored:decodeWorld(JSON.stringify(legacy))});games.push(migrated);
assert.equal(migrated.world.state.religion.worship,0);assert.equal(migrated.world.state.religion.answered,s.religion.answered);
s.religion.commandments=['toil'];s.time=59;const happiness=h.happiness;tick(s);assert.equal(h.happiness,happiness-1);
const growth=setup();growth.h.food=300;growth.h.houseCount=10;growth.s.religion.commandments=['restraint'];
const pop=growth.h.population;growth.s.time=ECONOMY.settlementGrowthInterval-1;tick(growth.s);assert.equal(growth.h.population,pop);
growth.s.time=ECONOMY.settlementGrowthInterval*2-1;tick(growth.s);assert.equal(growth.h.population,pop+1);
for(const locale of ['ko','en','ja']){g.i18n.setLocale(locale);const text=religionSummary(s,g.i18n);assert.ok(!text.includes('prayer-'));assert.ok(!text.includes('[object Object]'));assert.ok(!text.includes('religion.'));}
for(const game of games)game.stop();
console.log('faith feedback: intervention provenance, acceptance, urgent prayers, worship, migration, omen seeds, costs and multilingual grammar passed');
