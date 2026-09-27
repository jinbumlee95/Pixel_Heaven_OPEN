import assert from 'node:assert/strict';
import { createInitialWorld } from '../src/game/World.js';
import { HeroSystem, HERO_RULES, heroStats, validateHeroOrder, executeHeroOrder } from '../src/game/Hero.js';
import { BattleSystem } from '../src/game/Combat.js';
import { updateWander } from '../src/game/Wander.js';

const order = action => ({ action, target: 'home', parameters: {} });
const dispatch = world => executeHeroOrder(world, order('hero_dispatch'));
const recall = world => executeHeroOrder(world, order('hero_recall'));
function setup() {
  const world = createInitialWorld();
  const events = [];
  const system = new HeroSystem(world, { onEvent: event => events.push(event) });
  const home = world.getVillage('home');
  Object.assign(home, { food: 100, herbs: 20, coal: 20, economyVersion: 2 });
  const hero = world.state.hero;
  assert.ok(hero, 'The built-in catalog provides one named hero');
  return { world, system, hero, events, home, entity: world.state.entities.get(hero.entityId) };
}
function advance(system, duration, frameMs = 100) {
  for (let time = 0; time < duration; time += frameMs) system.update(Math.min(frameMs, duration - time));
}
function until(run, predicate, maxMs = 90000) {
  for (let time = 0; time < maxMs && !predicate(); time += 100) run.system.update(100);
  assert.ok(predicate(), 'A bounded hero run reaches its expected state');
}
function startBattle(run) {
  const plan = { id: 'test-raid', kind: 'raid', stage: 'active', startAt: run.world.state.time,
    endAt: run.world.state.time + 45, entryDirection: 'east', severity: 3, damage: { food: 30, people: 1 } };
  run.world.state.eventQueue = [plan];
  const battle = new BattleSystem(run.world);
  battle.start(plan);
  return { battle, plan };
}

const run = setup();
const count = run.world.state.entities.size;
new HeroSystem(run.world);
assert.equal(run.world.state.entities.size, count, 'Constructing the system again cannot spawn a duplicate hero');
const idle = structuredClone(run.hero);
const idlePosition = { ...run.entity.position };
for (let frame = 0; frame < 100; frame++) updateWander(run.world, 250, () => 0);
assert.deepEqual(run.entity.position, idlePosition, 'The hero is not a decorative random walker');
assert.deepEqual(run.hero, idle);
assert.equal(dispatch(run.world).ok, true);
assert.equal(run.home.food, 94);
assert.equal(run.home.herbs, 19);
assert.equal(run.home.coal, 19);
assert.equal(run.entity.hidden, true);
assert.equal(run.world.state.occupied.get(`${idlePosition.x},${idlePosition.y}`), undefined,
  'An absent hero releases its occupied cell');
assert.equal(run.hero.mode, 'outbound');
const afterDispatch = structuredClone(run.world.state);
assert.equal(dispatch(run.world).code, 'busy');
assert.deepEqual(run.world.state, afterDispatch, 'Rejected duplicate dispatch never charges supplies');
advance(run.system, HERO_RULES.outboundMs + HERO_RULES.exploreMs);
assert.equal(run.hero.mode, 'fighting');
assert.equal(run.hero.scene.monsterId, 'slime');
const xpBefore = run.hero.xp;
const stoneBefore = run.home.stone ?? 0;
advance(run.system, HERO_RULES.fightMs - 1);
assert.equal(run.hero.xp, xpBefore);
assert.equal(run.home.stone ?? 0, stoneBefore, 'Rewards cannot arrive before the visible attack finishes');
assert.ok(run.hero.scene.enemyHp > 0);
run.system.update(1);
assert.equal(run.hero.mode, 'victory');
assert.equal(run.hero.xp, 12);
assert.equal(run.home.stone, stoneBefore);
assert.equal(run.hero.bag.stone,2);
const wonHp = run.hero.hp;
run.system.finishEncounter();
assert.equal(run.hero.hp, wonHp);
assert.equal(run.hero.xp, 12, 'An already settled encounter never grants XP twice');
until(run, () => run.hero.dungeonsCleared === 1);
assert.notEqual(run.hero.mode,'returning'); recall(run.world);
until(run, () => run.hero.mode === 'home');
assert.equal(run.hero.dungeonsCleared, 1);
assert.equal(run.hero.totalXp, 68);
assert.equal(run.hero.level, 2);
assert.deepEqual(run.hero.lastLoot, { stone: 2, iron: 2, silver: 3, gold: 2 });
assert.equal(run.hero.hp, heroStats(2).maxHp);
assert.equal(run.entity.hidden, false);
assert.equal(run.world.state.occupied.get(`${run.entity.position.x},${run.entity.position.y}`), run.entity);
assert.equal(run.events.filter(event => event.action === 'hero_encounter_won').length, 3);
assert.equal(run.events.filter(event => event.action === 'hero_dungeon_cleared').length, 1);
const complete = structuredClone(run.world.state);
advance(run.system, 2000);
assert.equal(run.hero.scene.elapsedMs, 2000, 'Home practice advances only its visual clock');
complete.hero.scene.elapsedMs = run.hero.scene.elapsedMs;
assert.deepEqual(run.world.state, complete, 'Home practice cannot replay rewards or healing');
assert.deepEqual(JSON.parse(JSON.stringify(run.hero)), run.hero, 'Hero and its scene are serializable domain data');

const cancelled = setup();
assert.equal(dispatch(cancelled.world).ok, true);
assert.equal(recall(cancelled.world).ok, true);
assert.equal(recall(cancelled.world).ok, false);
until(cancelled, () => cancelled.hero.mode === 'home');
assert.equal(cancelled.hero.totalXp, 0);
assert.equal(cancelled.hero.dungeonsCleared, 0, 'Recalling before a fight never farms XP or a clear');

const midFight = setup();
dispatch(midFight.world);
until(midFight, () => midFight.hero.mode === 'fighting');
advance(midFight.system, 1000);
assert.equal(recall(midFight.world).ok, true);
assert.equal(midFight.hero.mode, 'fighting', 'Recall finishes the current visible attack');
advance(midFight.system, HERO_RULES.fightMs - 1001);
assert.equal(midFight.hero.totalXp, 0);
midFight.system.update(1);
assert.equal(midFight.hero.totalXp, 12);
until(midFight, () => midFight.hero.mode === 'home');
assert.equal(midFight.hero.totalXp, 12);
assert.equal(midFight.hero.dungeonsCleared, 0);

const poor = setup();
poor.home.herbs = 0;
const beforePoor = structuredClone(poor.world.state);
assert.equal(validateHeroOrder(poor.world, order('hero_dispatch')).code, 'supplies');
assert.equal(dispatch(poor.world).ok, false);
assert.deepEqual(poor.world.state, beforePoor, 'Missing dispatch supplies cannot mutate state');
assert.equal(executeHeroOrder(poor.world, { action: 'hero_dispatch', target: 'faction-01', parameters: {} }).ok, false);
assert.equal(executeHeroOrder(poor.world, { action: 'hero_dispatch', target: 'home', parameters: [] }).code, 'invalid_order');

const wounded = setup();
dispatch(wounded.world);
until(wounded, () => wounded.hero.mode === 'fighting');
wounded.hero.hp = 1;
// A newly committed weak encounter loses without granting the visible kill.
wounded.system.beginEncounter();
advance(wounded.system, HERO_RULES.fightMs);
assert.equal(wounded.hero.mode, 'field_recovery');
recall(wounded.world);
assert.equal(wounded.hero.totalXp, 0);
assert.deepEqual(wounded.hero.lastLoot, {});
until(wounded, () => wounded.hero.mode === 'home');
assert.equal(wounded.hero.hp, wounded.hero.maxHp);

const away = setup();
dispatch(away.world);
const awayBattle = startBattle(away);
assert.equal(away.world.state.combat.units.some(unit => unit.isHero), false,
  'A dungeon hero cannot simultaneously defend the settlement');
recall(away.world);
until(away, () => away.hero.mode === 'home');
away.world.state.time++;
awayBattle.battle.update();
assert.equal(away.world.state.combat.units.filter(unit => unit.isHero).length, 1,
  'A healthy returning hero joins the ongoing defense at its next decision');
assert.equal(away.hero.mode, 'defending');
assert.equal(dispatch(away.world).ok, false);
assert.equal(away.entity.hidden, true);
const heroUnit = away.world.state.combat.units.find(unit => unit.isHero);
heroUnit.hp = 0;
awayBattle.battle.resolve(awayBattle.plan);
assert.equal(heroUnit.hidden, true, 'The resolved combat copy is hidden before showing the home entity');
assert.equal(away.hero.mode, 'recovering');
assert.equal(away.hero.hp, 1, 'Defeat causes bounded recovery rather than permanent death');
assert.equal(dispatch(away.world).code, 'busy');
until(away, () => away.hero.mode === 'home');
assert.equal(away.hero.hp, away.hero.maxHp);
assert.equal(away.world.state.entities.size, count);

function defense(level) {
  const defenseRun = setup();
  defenseRun.hero.level = level;
  defenseRun.hero.hp = defenseRun.hero.maxHp = heroStats(level).maxHp;
  const { battle, plan } = startBattle(defenseRun);
  const unit = defenseRun.world.state.combat.units.find(candidate => candidate.isHero);
  assert.equal(unit.damage, heroStats(level).damage);
  for (let tick = 1; tick <= plan.endAt; tick++) { defenseRun.world.state.time = tick; battle.update(); }
  return { outcome: defenseRun.world.state.combat.outcome, unit };
}
const novice = defense(1);
const veteran = defense(5);
assert.ok(veteran.unit.damage > novice.unit.damage && veteran.unit.maxHp > novice.unit.maxHp);
assert.ok(veteran.outcome.enemyStrength < novice.outcome.enemyStrength
  || veteran.outcome.enemySurvivors < novice.outcome.enemySurvivors
  || veteran.outcome.food < novice.outcome.food,
  'Dungeon growth improves an actual deterministic defense outcome');

const stalled = setup();
dispatch(stalled.world);
stalled.system.update(60000);
assert.equal(stalled.hero.mode, 'outbound');
assert.equal(stalled.hero.scene.elapsedMs, 250, 'Background pauses cannot skip all visible dungeon motion');
assert.equal(stalled.hero.totalXp, 0);

const replay = setup();
dispatch(replay.world);
until(replay, () => replay.hero.dungeonsCleared === 1); recall(replay.world);
until(replay, () => replay.hero.mode === 'home');
assert.equal(replay.hero.totalXp, run.hero.totalXp);
assert.deepEqual(replay.hero.lastLoot, run.hero.lastLoot, 'Identical seeds and orders replay identical encounters');
console.log('hero: passed (visible reward timing, recall, supplies, progression, actual defense, and recovery)');
