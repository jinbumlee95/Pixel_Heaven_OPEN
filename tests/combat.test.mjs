import assert from 'node:assert/strict';
import { createInitialWorld } from '../src/game/World.js';
import { Factions } from '../src/game/Factions.js';
import { BattleSystem, prepareBattle, PREPARATION_COSTS, COMBAT_ROLES, COMBAT_MOVEMENT, BATTLE_RULES } from '../src/game/Combat.js';
import { EventForecast } from '../src/game/EventForecast.js';
import { executeDivineAction } from '../src/actions/divineActions.js';

function setup({ preparation, allied = false, direction = 'north' } = {}) {
  const world = createInitialWorld();
  const home = world.getVillage('home');
  home.food = 100; home.wood = 100;
  new Factions(world, { seed: 7 });
  world.state.factions.forEach((faction, index) => { faction.stance = allied && index < 8 ? 'allied' : 'hostile'; });
  const events = [];
  const camera = [];
  const battle = new BattleSystem(world, { onEvent: event => events.push(event), onCamera: event => camera.push(event) });
  const draws = [0, 0, 0.99, ['north', 'east', 'south', 'west'].indexOf(direction) / 4];
  let index = 0;
  const forecast = new EventForecast(world, { battle, random: () => draws[index++ % draws.length], onEvent: event => events.push(event) });
  const plan = world.state.eventQueue[0];
  if (preparation) assert.ok(prepareBattle(world, plan, preparation).ok);
  return { world, home, battle, forecast, plan, events, camera };
}

function advance(run, time) { run.world.state.time = time; run.forecast.update(); }
function play(preparation, direction = 'north') {
  const run = setup({ preparation, direction });
  const { world, plan } = run;
  const occupied = structuredClone(world.state.occupied);
  const entityCount = world.state.entities.size;
  const effects = new Set();
  const positions = new Set();
  for (let time = 1; time <= plan.endAt; time++) {
    advance(run, time);
    const combat = world.state.combat;
    assert.ok(combat.units.length <= BATTLE_RULES.maxUnits);
    assert.ok(combat.works.length <= BATTLE_RULES.maxWorks);
    assert.ok(combat.effects.length <= BATTLE_RULES.maxEffects);
    const live = combat.units.filter(unit => unit.hp > 0);
    assert.equal(new Set(live.map(unit => `${unit.position.x},${unit.position.y}`)).size, live.length);
    for (const unit of combat.units) {
      assert.ok(Number.isInteger(unit.position.x) && Number.isInteger(unit.position.y));
      assert.ok(Number.isFinite(unit.hp) && unit.hp >= 0 && unit.hp <= unit.maxHp);
      assert.equal(world.state.occupied.has(`${unit.position.x},${unit.position.y}`), false, 'Tactical soldiers cannot occupy buildings, nature, Priest or villager cells');
      assert.ok(!world.state.sanctuary.reservedCells.some(cell => cell.x === unit.position.x && cell.y === unit.position.y));
      positions.add(`${unit.id}:${unit.position.x},${unit.position.y}`);
    }
    combat.effects.forEach(effect => effects.add(effect.type));
  }
  assert.deepEqual(world.state.occupied, occupied, 'Combat has no effect on world occupancy storage');
  assert.equal(world.state.entities.size, entityCount, 'Tactical units do not become population entities');
  assert.equal(run.camera.length, 1);
  assert.equal(run.camera[0].kind, 'raid_entry');
  assert.ok(Math.abs(Math.hypot(run.camera[0].position.x - run.home.anchor.x,
    run.camera[0].position.y - run.home.anchor.y) - (run.home.settlementRadius + 2)) <= 1);
  assert.equal(plan.stage, 'resolved');
  assert.equal(world.state.combat.stage, 'resolved');
  assert.deepEqual(plan.outcome, world.state.combat.outcome, 'The actual battle supplies settlement consequences');
  assert.equal(run.home.food, 100 - plan.outcome.food);
  assert.equal(run.home.population, 8 - plan.outcome.people);
  assert.ok(plan.outcome.food <= plan.damage.food && plan.outcome.people <= plan.damage.people);
  assert.ok(positions.size > world.state.combat.units.length * 2, 'Visible units traverse actual grid positions');
  const beforeRepeated = structuredClone(world.state);
  run.forecast.update(); run.battle.update(); run.battle.resolve(plan);
  assert.deepEqual(world.state, beforeRepeated, 'Repeated resolution never charges damage twice');
  assert.deepEqual(JSON.parse(JSON.stringify(world.state.combat)), world.state.combat, 'Battle view is fully serializable plain data');
  return { run, effects };
}

const unprepared = play();
const prepared = play('balanced');
assert.equal(unprepared.run.world.state.combat.units.filter(unit => unit.side === 'home').length, 2);
assert.deepEqual(prepared.run.world.state.combat.units.filter(unit => unit.side === 'home').map(unit => unit.role), Object.keys(COMBAT_ROLES));
assert.ok(unprepared.run.plan.outcome.food > 0, 'An actual breached undefended line causes loss');
assert.ok(prepared.run.plan.outcome.food < unprepared.run.plan.outcome.food, 'Mustered roles and works change the actual battle outcome');
for (const effect of ['slash', 'arrow', 'spell']) assert.ok(prepared.effects.has(effect), `${effect} has a real attack behind its effect`);
const replay = play('balanced');
assert.deepEqual(replay.run.world.state.combat, prepared.run.world.state.combat, 'Combat requires no random impact rolls');
for (const direction of ['east', 'south', 'west']) {
  const approach = play(undefined, direction);
  assert.equal(approach.run.plan.entryDirection, direction);
  assert.ok(approach.run.plan.outcome.breachPressure > 0, `${direction} attackers can reach the settlement despite protected altar cells`);
}

// Costs and all required placement are checked before mutating any state.
const costs = setup();
for (const preparation of Object.keys(PREPARATION_COSTS)) {
  const prior = costs.home.wood;
  const result = executeDivineAction(costs.world, { status: 'understood', action: 'prepare_defense', target: 'home',
    parameters: { preparation } }, { planId: costs.plan.id });
  assert.ok(result.ok, `${preparation}: ${result.code}`);
  assert.equal(costs.home.wood, prior - PREPARATION_COSTS[preparation]);
}
assert.equal(costs.plan.battlePreparation.works.length, 12);
assert.deepEqual(costs.plan.battlePreparation.kinds, Object.keys(PREPARATION_COSTS));
const duplicate = structuredClone(costs.world.state);
assert.equal(prepareBattle(costs.world, costs.plan, 'cover').code, 'already_prepared');
assert.deepEqual(costs.world.state, duplicate);
for (let time = 1; time <= costs.plan.endAt; time++) advance(costs, time);
assert.ok(costs.plan.outcome.food < prepared.run.plan.outcome.food, 'Additional cover, barricades and traps provide actual protection beyond basic mustering');
const poor = setup(); poor.home.wood = 0;
const poorBefore = structuredClone(poor.world.state);
assert.equal(prepareBattle(poor.world, poor.plan).code, 'insufficient_wood');
assert.deepEqual(poor.world.state, poorBefore);
const blocked = setup();
for (let y = 974; y <= 1026; y++) for (let x = 974; x <= 1026; x++) blocked.world.state.occupied.set(`${x},${y}`, { type: 'stone' });
const blockedBefore = structuredClone(blocked.world.state);
assert.equal(prepareBattle(blocked.world, blocked.plan).code, 'no_space');
assert.deepEqual(blocked.world.state, blockedBefore);

// The public queue never offers a second raid while this army is active.
const active = setup({ preparation: 'balanced' });
advance(active, active.plan.startAt);
assert.equal(active.world.state.eventQueue.filter(p=>p.kind==='raid'&&['forecast','active'].includes(p.stage)).length,1);
assert.equal(prepareBattle(active.world,active.world.state.eventQueue[1],'cover').ok,false);

// Focused tactical arrangements exercise behavior, not just role labels.
const tactical = setup({ preparation: 'balanced', allied: true });
advance(tactical, tactical.plan.startAt);
assert.equal(tactical.world.state.combat.units.filter(unit => unit.side === 'ally').length, 1);
const combat = tactical.world.state.combat;
combat.front = { x: 1013, y: 1000 };
const templates = Object.fromEntries(combat.units.filter(unit => unit.side === 'home').map(unit => [unit.role, structuredClone(unit)]));
const sample = role => structuredClone(templates[role]);
const make = (role, side, x, y, id) => ({ ...sample(role), id, side, position: { x, y }, previousPosition: { x, y },
  hp: 30, maxHp: 30, nextAttackAt: 0, nextMoveAt: 0, nextRetreatAt: 0, targetId: null });
const archer = make('archer', 'enemy', 1016, 1000, 'test-archer');
const guarded = make('swordsman', 'home', 1013, 1000, 'test-guard');
combat.units = [archer, guarded];
combat.works = [{ id: 'cover', type: 'cover', position: { x: 1013, y: 1001 }, hp: 14, maxHp: 14 }];
tactical.battle.attack(archer, guarded);
const coveredLoss = 30 - guarded.hp;
guarded.hp = 30; combat.works = [];
tactical.battle.attack(archer, guarded);
assert.ok(30 - guarded.hp > coveredLoss, 'Adjacent cover reduces actual ranged damage');

const mage = make('mage', 'home', 1014, 1000, 'test-mage');
const victim = make('swordsman', 'enemy', 1017, 1000, 'test-victim');
const secondary = make('archer', 'enemy', 1017, 1001, 'test-secondary');
combat.units = [mage, victim, secondary];
tactical.battle.attack(mage, victim);
assert.ok(victim.hp < 30 && secondary.hp < 30, 'A mage spell actually damages nearby enemy targets');

const breaker = make('swordsman', 'enemy', 1016, 1000, 'test-breaker');
const defender = make('archer', 'home', 1013, 1000, 'test-defender');
combat.units = [breaker, defender];
combat.works = [{ id: 'barrier', type: 'barricade', position: { x: 1015, y: 1000 }, hp: 5, maxHp: 24 }];
tactical.battle.act(breaker);
assert.equal(combat.works[0].hp, 0, 'A blocking barricade is attacked and can be breached');
assert.ok(combat.effects.some(effect => effect.type === 'breach'));

const entrant = make('swordsman', 'enemy', 1016, 1000, 'test-entrant');
combat.units = [entrant, defender];
combat.works = [{ id: 'trap', type: 'trap', position: { x: 1015, y: 1000 }, hp: 1, triggered: false, disarmed: false }];
tactical.battle.act(entrant);
assert.equal(combat.works[0].triggered, true);
assert.equal(entrant.hp, 21);
assert.ok(entrant.slowUntil > tactical.world.state.time);
const trapHp = entrant.hp;
tactical.battle.act(entrant);
assert.equal(entrant.hp, trapHp, 'A triggered trap cannot deal damage a second time');

const rogue = make('rogue', 'enemy', 1016, 1000, 'test-rogue');
combat.units = [rogue, defender];
combat.works = [{ id: 'disarm', type: 'trap', position: { x: 1015, y: 1000 }, hp: 1, triggered: false, disarmed: false }];
tactical.battle.act(rogue);
assert.equal(combat.works[0].disarmed, true);
assert.equal(rogue.hp, 30, 'Rogues disarm an adjacent untriggered trap instead of walking into it');

const retreating = make('archer', 'home', 1014, 1000, 'test-retreat');
const pursuer = make('swordsman', 'enemy', 1015, 1000, 'test-pursuer');
combat.units = [retreating, pursuer]; combat.works = [];
tactical.battle.act(retreating);
assert.ok(Math.abs(retreating.position.x - pursuer.position.x) + Math.abs(retreating.position.y - pursuer.position.y) > 1,
  'Ranged units try to open space when threatened in melee');
const afterRetreat = { ...retreating.position };
pursuer.position = { x: afterRetreat.x + 1, y: afterRetreat.y };
tactical.world.state.time += 2;
tactical.battle.act(retreating);
assert.deepEqual(retreating.position, afterRetreat,
  'A ranged unit stands and fights during retreat recovery instead of kiting on every tick');
assert.equal(retreating.status, 'attacking');

// Movement schedules do not stop attacks, and holding range produces no
// redundant movement commitments for the frame-based renderer.
const holding = make('archer', 'enemy', 1016, 1000, 'test-holding');
const inRange = make('swordsman', 'home', 1013, 1000, 'test-in-range');
combat.units = [holding, inRange]; combat.works = [];
const holdingPosition = { ...holding.position };
const attackAt = tactical.world.state.time;
tactical.battle.act(holding);
assert.equal(holding.status, 'attacking');
tactical.world.state.time++;
tactical.battle.act(holding);
assert.deepEqual(holding.position, holdingPosition);
assert.equal(holding.status, 'ready');
assert.equal(holding.intent, 'hold');
assert.equal(holding.lastMoveAt, null);
assert.equal(holding.nextAttackAt, attackAt + holding.cooldown, 'Movement cadence leaves the damage cooldown intact');

const advancing = make('archer', 'enemy', 1020, 1000, 'test-advancing');
const distant = make('swordsman', 'home', 1010, 1000, 'test-distant');
combat.units = [advancing, distant];
const beforeAdvance = { ...advancing.position };
const moveAt = tactical.world.state.time;
tactical.battle.act(advancing);
assert.notDeepEqual(advancing.position, beforeAdvance);
assert.deepEqual(advancing.previousPosition, beforeAdvance);
assert.equal(advancing.lastMoveAt, moveAt);
assert.equal(advancing.moveDurationMs, COMBAT_MOVEMENT.archer.durationMs);
const firstStep = { ...advancing.position };
tactical.world.state.time++;
tactical.battle.act(advancing);
assert.deepEqual(advancing.position, firstStep, 'Ranged repositioning rests between committed steps');
assert.equal(advancing.lastMoveAt, moveAt);
assert.equal(advancing.status, 'ready', 'A waiting unit never leaves a stale walking status');
tactical.world.state.time++;
tactical.battle.act(advancing);
assert.notDeepEqual(advancing.position, firstStep, 'A still-needed move resumes when its own cadence allows');
assert.deepEqual(advancing.previousPosition, firstStep);

const pursuing = make('swordsman', 'enemy', 1017, 1000, 'test-pursuing');
const firstTarget = make('swordsman', 'home', 1013, 1000, 'test-first-target');
const passing = make('swordsman', 'home', 1017, 1005, 'test-passing');
combat.units = [pursuing, firstTarget, passing];
tactical.battle.act(pursuing);
assert.equal(pursuing.targetId, firstTarget.id);
passing.position = { x: pursuing.position.x, y: pursuing.position.y + 2 };
tactical.world.state.time++;
tactical.battle.act(pursuing);
assert.equal(pursuing.targetId, firstTarget.id,
  'A one-cell advantage for a passing target does not reverse the current pursuit');
passing.position = { x: pursuing.position.x, y: pursuing.position.y + 1 };
tactical.world.state.time++;
tactical.battle.act(pursuing);
assert.equal(pursuing.targetId, passing.id, 'A reachable threat can replace a target that is still out of reach');
assert.equal(pursuing.status, 'attacking');

// Expanded inventories make each preparation a distinct, atomic resource choice.
const supplies = setup();
supplies.home.economyVersion = 2;
supplies.home.iron = 0;
const beforeSupplies = structuredClone(supplies.world.state);
const missingSupplies = prepareBattle(supplies.world, supplies.plan, 'balanced');
assert.equal(missingSupplies.ok, false);
assert.equal(missingSupplies.code, 'insufficient_supplies');
assert.deepEqual(supplies.world.state, beforeSupplies,
  'A missing metal cannot charge wood, place works, or muster units');
supplies.home.stone = 5;
assert.equal(prepareBattle(supplies.world, supplies.plan, 'cover').ok, true);
assert.equal(supplies.home.stone, 1);
assert.deepEqual(supplies.plan.battlePreparation.resourcesSpent, { wood: 3, stone: 4 });
console.log(`combat: passed (unprepared loss ${unprepared.run.plan.outcome.food}; balanced ${prepared.run.plan.outcome.food}; all works ${costs.plan.outcome.food})`);
