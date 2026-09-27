import assert from 'node:assert/strict';
import { createInitialWorld } from '../src/game/World.js';
import { tick } from '../src/game/Simulation.js';
import { Factions, createSeededRandom, FACTION_RULES } from '../src/game/Factions.js';
import { EventForecast, FORECAST_RULES } from '../src/game/EventForecast.js';
import { Emergence } from '../src/game/Emergence.js';
import { WorldDecisions } from '../src/game/WorldDecisions.js';
import { executeDivineAction } from '../src/actions/divineActions.js';
import { Game } from '../src/game/Game.js';
import { getWorldNeeds } from '../src/game/WorldNeeds.js';
import { BattleSystem, BATTLE_RULES } from '../src/game/Combat.js';

const committed = plan => ({ id: plan.id, kind: plan.kind, announcedAt: plan.announcedAt,
  startAt: plan.startAt, endAt: plan.endAt, sourceFactionId: plan.sourceFactionId,
  sourceNameKey: plan.sourceNameKey, severity: plan.severity, damage: { ...plan.damage }, harvestFactor: plan.harvestFactor,
  entryDirection: plan.entryDirection, enemyComposition: [...plan.enemyComposition] });

async function simulate(seed, count = 10000) {
  const world = createInitialWorld();
  const home = world.getVillage('home');
  const originalEntities = [...world.state.entities.keys()];
  const knownPlans = new Map();
  const outcomes = new Set();
  const counts = { warnings: 0, raids: 0, droughts: 0, averted: 0, defended: 0, aid: 0 };
  const decisions = new WorldDecisions(world, { onEvent(event) {
    if (event.action === 'forecast') {
      const plan = world.state.eventQueue.find(candidate => candidate.id === event.planId);
      assert.ok(plan);
      assert.ok(plan.startAt - event.time >= FORECAST_RULES.leadTicks, 'All adverse events must receive the complete advance-warning period');
      assert.ok(plan.damage.food <= 20 && plan.damage.people <= 1);
      knownPlans.set(plan.id, committed(plan));
      counts.warnings++;
    }
    if (['raid', 'drought'].includes(event.action)) {
      const plan = knownPlans.get(event.planId);
      assert.ok(plan, 'No event may start without an earlier committed warning');
      assert.equal(event.time, plan.startAt);
      counts[event.action === 'raid' ? 'raids' : 'droughts']++;
    }
    if (['raid_resolved', 'drought_resolved'].includes(event.action)) {
      assert.ok(knownPlans.has(event.planId), 'Every consequence belongs to an announced plan');
      assert.equal(outcomes.has(event.planId), false, 'An event resolves only once');
      outcomes.add(event.planId);
      const plan = world.state.eventQueue.find(candidate => candidate.id === event.planId);
      if (plan.stage === 'averted') counts.averted++;
      if (plan.outcome?.defended) counts.defended++;
    }
    if (event.action === 'faction_aid') counts.aid++;
  } });
  const onEvent = event => decisions.record(event);
  const factions = new Factions(world, { seed, onEvent });
  const battle = new BattleSystem(world, { onEvent });
  const forecasts = new EventForecast(world, { random: createSeededRandom(seed + 1), onEvent, battle });
  const emergence = new Emergence(world, { forecastManaged: true, onEvent,
    random: () => { throw new Error('Legacy random crisis generation must remain disabled'); } });

  for (let index = 0; index < count; index++) {
    // Deliver selected responses early, while deliberately leaving the rest
    // untreated so the same run exercises damage, support and recovery.
    for (const plan of world.state.eventQueue.filter(plan => plan.stage === 'forecast')) {
      if (world.state.time !== plan.announcedAt + 5) continue;
      const number = Number(plan.id.split('-').at(-1));
      if ((plan.kind === 'raid' && number % 3 === 0) || (plan.kind === 'drought' && number % 2 === 0)) {
        const action = plan.kind === 'raid' ? 'prepare_defense' : 'create_rain';
        const beforePreparation = structuredClone(world.state);
        const result = executeDivineAction(world, { status: 'understood', action, target: 'home', parameters: {} }, { planId: plan.id });
        if (!result.ok) {
          assert.equal(result.code, 'no_space', `${world.state.time}: ${action}: ${result.code}`);
          assert.deepEqual(world.state, beforePreparation, 'A densely built settlement rejects unplaceable preparation atomically');
        }
      }
    }
    tick(world.state);
    const beforeFactions = { food: home.food, population: home.population, weather: home.weather };
    factions.update();
    assert.ok(home.food >= beforeFactions.food, 'Autonomous external events never apply an immediate negative home effect');
    assert.equal(home.population, beforeFactions.population);
    assert.equal(home.weather, beforeFactions.weather);

    const beforeForecast = { food: home.food, population: home.population };
    forecasts.update();
    const losses = world.state.eventQueue.filter(plan => plan.kind === 'raid' && plan.resolvedAt === world.state.time);
    assert.equal(home.population, beforeForecast.population - losses.reduce((sum, plan) => sum + plan.outcome.people, 0));
    assert.ok(Math.abs(home.food - (beforeForecast.food - losses.reduce((sum, plan) => sum + plan.outcome.food, 0))) < 1e-8);
    for (const plan of losses) {
      assert.ok(plan.outcome.food >= 0 && plan.outcome.food <= plan.damage.food);
      assert.ok(plan.outcome.people >= 0 && plan.outcome.people <= plan.damage.people);
    }

    const beforeLegacy = { food: home.food, population: home.population, weather: home.weather,
      crisis: structuredClone(home.crisis) };
    emergence.update();
    assert.deepEqual({ food: home.food, population: home.population, weather: home.weather,
      crisis: home.crisis }, beforeLegacy, 'Legacy emergence cannot charge forecast damage twice or create an unannounced crisis');
    await decisions.update();

    const active = world.state.eventQueue.filter(plan => plan.stage === 'active');
    assert.ok(active.length <= 1, 'Adverse crises never overlap');
    assert.equal(home.crisis?.planId ?? null, active[0]?.id ?? null);
    if (active[0]?.kind === 'raid' && active[0].mitigation.defense && home.defenseUntil < world.state.time) {
      assert.equal(getWorldNeeds(world.state).find(need => need.type === 'raid')?.messageKey, 'need.raid_ready',
        'The active need still acknowledges bound early preparation after the temporary defense timer expires');
    }
    if (home.weather === 'drought') {
      assert.equal(active[0]?.kind, 'drought');
      assert.equal(home.droughtFactor, active[0].harvestFactor);
    } else assert.equal(home.droughtFactor, undefined);
    for (const plan of world.state.eventQueue) {
      assert.deepEqual(committed(plan), knownPlans.get(plan.id), 'A warning commits its eventual parameters');
    }
    assert.equal(world.state.villages.length, 1);
    assert.equal(world.state.playerSettlementId, 'home');
    assert.equal(world.state.factions.length, 24);
    assert.deepEqual([...world.state.entities.keys()], originalEntities, 'Population and factions do not spawn more pawns');
    assert.equal(world.state.resources.food, home.food);
    assert.equal(world.state.resources.wood, home.wood);
    assert.ok(Number.isFinite(home.food) && home.food >= 0);
    assert.ok(Number.isFinite(home.wood) && home.wood >= 0);
    assert.ok(Number.isInteger(home.population) && home.population >= 0);
    assert.ok(Number.isFinite(home.happiness) && home.happiness >= 0 && home.happiness <= 100);
    assert.equal(home.houseCount, [...world.state.buildings.values()].filter(building => building.type === 'house').length);
    assert.equal(home.farmCount, [...world.state.terrain.values()].filter(terrain => terrain.type === 'farmland').length);
    assert.ok(world.state.occupied.size < 2000, 'Construction remains inside the bounded settlement area');
    assert.ok(world.state.eventQueue.length <= FORECAST_RULES.queueLimit);
    assert.ok(world.state.combat.units.length <= BATTLE_RULES.maxUnits);
    assert.ok(world.state.combat.works.length <= BATTLE_RULES.maxWorks);
    assert.ok(world.state.combat.effects.length <= BATTLE_RULES.maxEffects);
    assert.ok(world.state.factionHistory.length <= FACTION_RULES.historyLimit);
    assert.ok(world.state.recent_events.length <= 50 && decisions.events.length <= 50);
    for (const faction of world.state.factions) {
      assert.ok(Number.isFinite(faction.strength) && faction.strength >= 5 && faction.strength <= 100);
      assert.ok(Object.keys(faction.relations).length < world.state.factions.length);
      for (const value of Object.values(faction.resources)) assert.ok(Number.isFinite(value) && value >= 0 && value <= FACTION_RULES.maxResource);
    }
  }
  assert.ok(home.population > 0, 'The seeded long run remains inhabited');
  for (const key of ['warnings', 'raids', 'droughts', 'averted', 'defended']) assert.ok(counts[key] > 0, `Exercise ${key}`);
  decisions.stop();
  return { state: structuredClone(world.state), records: structuredClone(decisions.events), counts };
}

const first = await simulate(318);
const replay = await simulate(318);
assert.deepEqual(replay, first, 'Seeded economy, outside groups, announced plans and autonomous home decisions reproduce together');

// Authority is checked at the engine boundary even if a model proposes a
// syntactically valid command for an external group.
const game = new Game(null, { seed: 318, random: createSeededRandom(319), interpret: async () => ({
  status: 'understood', action: 'increase_food', target: 'faction-01', parameters: { amount: 50 } }) });
const beforeForeign = structuredClone(game.world.state);
const foreign = await game.sendDivineMessage('Give us food');
assert.equal(foreign.ok, false);
assert.equal(foreign.code, 'invalid_target');
assert.deepEqual(game.world.state, beforeForeign, 'A model cannot route home miracles to an outside group');
game.stop();
const seededGameA = new Game(null, { seed: 912 });
const seededGameB = new Game(null, { seed: 912 });
assert.deepEqual(seededGameA.world.state.eventQueue, seededGameB.world.state.eventQueue,
  'Game seed alone reproduces the initial committed forecast queue');
assert.deepEqual(seededGameA.world.state.factions, seededGameB.world.state.factions);
seededGameA.stop(); seededGameB.stop();
console.log(`settlementSimulation: passed (10,000 ticks × 2; ${first.counts.warnings} warnings, ${first.counts.raids} raids, ${first.counts.droughts} droughts)`);
