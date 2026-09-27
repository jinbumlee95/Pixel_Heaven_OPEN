import assert from 'node:assert/strict';
import {Game} from '../src/game/Game.js';
import {ChatCommands} from '../src/game/ChatCommands.js';
import {religionSummary} from '../src/ui/ReligionSummary.js';
import {tick} from '../src/game/Simulation.js';
import {updateReligion,religionOrder,ritePreview,validReligion} from '../src/game/Religion.js';
import {faithGenerationPerDay,accrueFaith,refundFaith} from '../src/game/Faith.js';
import {faithRule} from '../src/content/religion.js';
import {decodeWorld} from '../src/state/Persistence.js';
import {interpretDivineMessage} from '../src/llm/divineLLM.js';
import {LocalAI} from '../src/llm/LocalAI.js';
const g=new Game(null),s=g.world.state,h=g.world.getVillage('home'),chat=new ChatCommands(g);
const queries=['식량 충분해?','비 올까?','영웅 던전 갔어?','숲이 있나?','will it rain?','did the hero go to the dungeon?','食料は足りてる？','雨は降る？','목재 몇 개 있어?','돌은 얼마나 남았지?','약초 얼마나 있니','생산 왜 멈췄어?','계율이 뭐였지?','수확제 열어도 될까?','buy iron 3?'];
for(const q of queries){const before=g.snapshot();assert.ok((await chat.send(q)).ok,q);assert.equal(g.snapshot(),before,q);assert.equal((await interpretDivineMessage(q)).status,'unclear');assert.equal((await new LocalAI().interpret(q,{})).status,'unclear');}
const before=g.snapshot();await g.sendDivineMessage('비 올까?');assert.equal(g.snapshot(),before);
s.faith.points=100;const generation=faithGenerationPerDay(s);
assert.ok((await chat.send('안식 계율 선포')).ok);assert.equal(s.faith.points,70);assert.equal(faithGenerationPerDay(s),generation*1.25);
const conflict=g.snapshot();assert.equal((await chat.send('enact toil')).ok,false);assert.equal(s.faith.points,70);
assert.ok((await chat.send('revoke rest')).ok);assert.equal(h.happiness,58);
for(const [lang,command] of [['ja','戒律 森林保護 宣言'],['en','revoke preserve'],['ko','절제 계율 선포']]){g.i18n.setLocale(lang);assert.ok((await chat.send(command)).ok,command);assert.ok(!religionSummary(s,g.i18n).includes('[object Object]'));}
assert.equal(faithRule(s,'foodConsumption'),.9);
// Actual stock change resolves a prayer once, not merely a promise or command.
h.food=0;h.cloth=0;updateReligion(s);assert.equal(s.religion.prayers.filter(p=>p.status==='open').length,2);
const food=s.religion.prayers.find(p=>p.kind==='food');h.food=food.target;const faith=s.faith.points;updateReligion(s);assert.equal(s.faith.points,faith+1);updateReligion(s);assert.equal(s.faith.points,faith+1);assert.equal(s.religion.answered,0);
assert.ok(food.evidence.after>food.evidence.before);assert.equal(validReligion(s.religion),true);
// Existing amounts and unfinished prayers survive migration/save continuation.
assert.deepEqual(decodeWorld(g.snapshot()).world.state.religion,s.religion);
const legacy=JSON.parse(g.snapshot());legacy.version=4;delete legacy.state.religion;legacy.state.faith.points=50;
const old=new Game(null,{restored:decodeWorld(JSON.stringify(legacy))});assert.equal(old.world.state.religion.answered,0);assert.equal(old.world.state.faith.points,50);old.stop();
const malformed=JSON.parse(g.snapshot());malformed.state.religion.commandments=['rest','toil'];assert.throws(()=>decodeWorld(JSON.stringify(malformed)),/invalid_religion/);
s.faith.points=100;h.food=200;h.crafts=20;h.rations=10;
const preview=ritePreview(s,'harvest');assert.deepEqual(ritePreview(s,'harvest'),preview);
assert.ok((await chat.send('수확제 열어')).ok);assert.equal(h.food,180);assert.equal(h.crafts,18);const paid=s.faith.points;
assert.equal((await chat.send('ritual harvest')).ok,false);assert.equal(s.faith.points,paid);
assert.equal((await chat.send('ritual funeral')).ok,false);h.population--;updateReligion(s);assert.ok((await chat.send('儀式 葬儀')).ok);assert.equal((await chat.send('ritual funeral')).ok,false);
h.population++;
assert.ok((await chat.send('출정식 해줘')).ok);assert.equal((await chat.send('출정식 해줘')).ok,false);
assert.ok((await chat.send('hero dispatch')).ok);const mission=s.hero.missionId;assert.equal(s.religion.departure.missionId,mission);s.hero.room=1;g.hero.beginEncounter();assert.ok(s.hero.encounter.stats.armor>=2);
s.hero.cycleId=2;g.hero.beginEncounter();assert.equal(s.religion.departure,null);
// Passive income never destroys prayer over-cap rewards or refunded faith.
s.faith.points=s.faith.capacity+8;const overflow=s.faith.points;accrueFaith(s);assert.equal(s.faith.points,overflow);refundFaith(s,3);assert.equal(s.faith.points,overflow+3);
const restored=new Game(null,{restored:decodeWorld(g.snapshot())});tick(s);tick(restored.world.state);assert.deepEqual(restored.world.state.religion,s.religion);restored.stop();g.stop();
console.log('religion: query safety, three languages, commandments, prayers, rites, costs, cooldowns, buffs and save continuation passed');
