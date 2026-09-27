import { recordEvent } from '../game/EventJournal.js';
import { applyBattleConsequences } from './Diplomacy.js';
import { waterBlocked } from './Landscape.js';
import { syncResourceTotals } from '../state/worldState.js';
import { allySupport } from './Factions.js';
import { enlistHero, releaseHeroFromBattle } from './Hero.js';
import { canAffordResources, spendResources } from '../state/economy.js';

export const PREPARATION_COSTS = Object.freeze({ balanced: 4, cover: 3, barricade: 5, trap: 4 });
export const PREPARATION_SUPPLIES = Object.freeze({
  balanced: Object.freeze({ wood: 4, iron: 1, cloth: 1 }),
  cover: Object.freeze({ wood: 3, stone: 4 }),
  barricade: Object.freeze({ wood: 5, iron: 2 }),
  trap: Object.freeze({ wood: 4, copper: 2, iron: 1 }),
});
export const BATTLE_RULES = Object.freeze({ maxUnits: 12, maxWorks: 12, maxEffects: 24,
  duration: 45, routeBudget: 1024, effectTicks: 2 });
export const COMBAT_ROLES = Object.freeze({
  swordsman: Object.freeze({ hp: 32, damage: 5, range: 1, cooldown: 2 }),
  archer: Object.freeze({ hp: 19, damage: 4, range: 5, cooldown: 3 }),
  mage: Object.freeze({ hp: 17, damage: 6, range: 4, cooldown: 5 }),
  rogue: Object.freeze({ hp: 21, damage: 6, range: 1, cooldown: 2 }),
});
// Movement is an intention, not an automatic side effect of every battle tick.
// Grid commits stay deterministic; the renderer traverses each committed step
// over moveDurationMs independently of the simulation clock.
export const COMBAT_MOVEMENT = Object.freeze({
  swordsman: Object.freeze({ interval: 1, durationMs: 900 }),
  archer: Object.freeze({ interval: 2, durationMs: 1100 }),
  mage: Object.freeze({ interval: 2, durationMs: 1100 }),
  rogue: Object.freeze({ interval: 1, durationMs: 850 }),
});
const VECTORS = { north: [0, -1], northeast: [1, -1], east: [1, 0], southeast: [1, 1],
  south: [0, 1], southwest: [-1, 1], west: [-1, 0], northwest: [-1, -1] };
const STEPS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const key = position => `${position.x},${position.y}`;
const same = (a, b) => a.x === b.x && a.y === b.y;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const alive = unit => unit.hp > 0;
const homeOf = world => world.state.villages.find(village => village.id === 'home');
const opposite = (a, b) => (a.side === 'enemy') !== (b.side === 'enemy');
const behindLine = (combat, position) => {
  const dx = combat.entry.x - combat.front.x;
  const dy = combat.entry.y - combat.front.y;
  return Math.hypot(position.x - combat.front.x, position.y - combat.front.y) <= 6
    && ((position.x - combat.front.x) * dx + (position.y - combat.front.y) * dy) / Math.max(1, Math.hypot(dx, dy)) <= 1;
};
const failed = (code, messageParams = {}) => ({ ok: false, code,
  messageKey: `combat.failure.${code}`, messageParams });

export function raidComposition(severity) {
  const bounded = Math.max(1, Math.min(3, Math.floor(severity) || 1));
  return ['swordsman', 'archer', 'rogue', 'swordsman', 'mage', 'archer'].slice(0, 3 + bounded);
}

function geometry(world, plan) {
  const home = homeOf(world);
  const [dx, dy] = VECTORS[plan.entryDirection] ?? VECTORS.north;
  const length = Math.hypot(dx, dy);
  const offset = (forward, sideways = 0) => ({ x: home.anchor.x + Math.round((dx * forward - dy * sideways) / length),
    y: home.anchor.y + Math.round((dy * forward + dx * sideways) / length) });
  return { entry: offset(home.settlementRadius + 2), front: offset(11), offset };
}

function groundOpen(world, position) {
  const home = homeOf(world);
  return Number.isInteger(position.x) && Number.isInteger(position.y)
    && Math.hypot(position.x - home.anchor.x, position.y - home.anchor.y) <= home.settlementRadius + 6
    && !world.state.occupied.has(key(position))
    && !waterBlocked(world.state, position.x, position.y)
    && !world.state.sanctuary?.reservedCells?.some(cell => same(cell, position));
}

function open(world, position, units = [], works = [], self = null) {
  return groundOpen(world, position)
    && !units.some(unit => unit !== self && alive(unit) && same(unit.position, position))
    && !works.some(work => work.type === 'barricade' && work.hp > 0 && same(work.position, position));
}

function freeSpot(world, desired, units = [], works = [], used = new Set()) {
  for (let radius = 0; radius <= 5; radius++) {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const position = { x: desired.x + dx, y: desired.y + dy };
      if (!used.has(key(position)) && open(world, position, units, works)) return position;
    }
  }
  return null;
}

function makeUnit(plan, side, role, index, position) {
  const stats = COMBAT_ROLES[role];
  const movement = COMBAT_MOVEMENT[role];
  const maxHp = side === 'enemy' ? Math.round(stats.hp * 0.9) : stats.hp;
  return { id: `${plan.id}:${side}:${index}`, side, role, position, previousPosition: { ...position },
    hp: maxHp, maxHp, damage: stats.damage, range: stats.range, cooldown: stats.cooldown,
    nextAttackAt: plan.startAt, slowUntil: 0, status: 'ready', breached: false,
    targetId: null, intent: 'hold', lastMoveAt: null,
    nextMoveAt: plan.startAt + index % movement.interval,
    moveDurationMs: movement.durationMs, nextRetreatAt: 0 };
}

function homeUnits(world, plan, works, roles) {
  const { offset } = geometry(world, plan);
  const units = [];
  for (const [index, role] of roles.entries()) {
    const desired = offset(role === 'archer' || role === 'mage' ? 9 : 11, [0, -2, 2, -3][index]);
    const position = freeSpot(world, desired, units, works);
    if (!position) return null;
    units.push(makeUnit(plan, 'home', role, index, position));
  }
  return units;
}

function view(world, plan, units, works, stage = 'preparing') {
  const { entry, front } = geometry(world, plan);
  return { stage, planId: plan.id, cleanupRequested: Boolean(plan.cleanupRequested), entry, front, units, works, effects: [],
    startedAt: stage === 'preparing' ? null : world.state.time, endAt: plan.endAt,
    lastTick: world.state.time - 1, breachPressure: 0, effectSequence: 0,
    preparationKinds: [...(plan.battlePreparation?.kinds ?? [])], outcome: null };
}

// Validate the complete placement/cost first. The only mutation after that is
// one inventory transfer and detached per-plan preparation data.
export function prepareBattle(world, plan, kind = 'balanced') {
  const home = homeOf(world);
  if (!home || home.population <= 0 || !plan || !(world.state.eventQueue ?? []).includes(plan)
    || plan.kind !== 'raid' || !['forecast', 'active'].includes(plan.stage)
    || !Object.hasOwn(PREPARATION_COSTS, kind)) return failed('invalid_preparation');
  if (plan.stage === 'active' && world.state.combat?.planId === plan.id && world.state.combat.stage === 'resolved') return failed('invalid_preparation');
  const previous = plan.battlePreparation ?? { kinds: [], works: [], woodSpent: 0 };
  if (previous.kinds.includes(kind)) return failed('already_prepared');
  const cost = PREPARATION_COSTS[kind];
  if (home.wood < cost) return failed('insufficient_wood', { wood: cost });
  const supplies = home.economyVersion === 2 ? PREPARATION_SUPPLIES[kind] : { wood: cost };
  if (!canAffordResources(home, supplies)) return failed('insufficient_supplies');
  const { offset } = geometry(world, plan);
  const definitions = kind === 'balanced' ? [['cover', 9, -2], ['barricade', 13, 0], ['trap', 15, 1]]
    : kind === 'cover' ? [['cover', 9, -3], ['cover', 9, 0], ['cover', 9, 3]]
      : kind === 'barricade' ? [['barricade', 13, -1], ['barricade', 13, 0], ['barricade', 13, 1]]
        : [['trap', 15, -2], ['trap', 15, 0], ['trap', 15, 2]];
  if (previous.works.length + definitions.length > BATTLE_RULES.maxWorks) return failed('no_space');
  const current = world.state.combat;
  const active = current?.planId === plan.id && ['approaching', 'fighting'].includes(current.stage);
  const works = structuredClone(active ? current.works : previous.works);
  const used = new Set(works.map(work => key(work.position)));
  for (const [type, forward, sideways] of definitions) {
    const position = freeSpot(world, offset(forward, sideways), active ? current.units : [], works, used);
    if (!position) return failed('no_space');
    used.add(key(position));
    const maxHp = type === 'barricade' ? 24 : type === 'cover' ? 14 : 1;
    works.push({ id: `${plan.id}:work:${works.length}`, type, position, hp: maxHp, maxHp,
      triggered: false, disarmed: false });
  }
  const squad = homeUnits(world, plan, works, Object.keys(COMBAT_ROLES));
  if (!squad) return failed('no_space');
  const additions = [];
  if (active) {
    for (const unit of squad.filter(unit => !current.units.some(existing => existing.side === 'home' && !existing.isHero && existing.role === unit.role))) {
      const position = freeSpot(world, unit.position, [...current.units, ...additions], works);
      if (!position) return failed('no_space');
      additions.push({ ...unit, position, previousPosition: { ...position } });
    }
    if (current.units.length + additions.length > BATTLE_RULES.maxUnits) return failed('no_space');
  }
  if (!spendResources(home, supplies)) return failed('insufficient_supplies');
  const resourcesSpent = { ...previous.resourcesSpent };
  for (const [resource, amount] of Object.entries(supplies)) resourcesSpent[resource] = (resourcesSpent[resource] ?? 0) + amount;
  plan.battlePreparation = { kinds: [...previous.kinds, kind], works: structuredClone(works), woodSpent: previous.woodSpent + cost,
    resourcesSpent };
  plan.mitigation = { ...plan.mitigation, defense: true };
  if (active) {
    current.works = works;
    current.units.push(...additions);
    current.preparationKinds = [...plan.battlePreparation.kinds];
  } else if (!current || !['approaching', 'fighting'].includes(current.stage)) {
    const nearest = (world.state.eventQueue ?? [plan]).filter(candidate => candidate.kind === 'raid'
      && candidate.stage === 'forecast' && candidate.battlePreparation).sort((a, b) => a.startAt - b.startAt)[0] ?? plan;
    if (nearest.id === plan.id) world.state.combat = view(world, plan, squad, works);
  }
  syncResourceTotals(world.state);
  return { ok: true, messageKey: 'combat.event.prepared', messageParams: {
    preparation: { messageKey: `combat.preparation.${kind}`, messageParams: {} }, wood: cost, costs: { resourceBasket: supplies }, gameTime: { gameTime: plan.startAt } },
  message: `Prepared ${kind} defenses for the raid at tick ${plan.startAt}, using ${cost} wood.` };
}

export const CLEANUP_RULES = Object.freeze({ delay: 12, interval: 2 });

// A request during preparation/combat schedules cleanup; it never dismantles
// live defenses. Historical buildings, paving and inventories are untouched.
export function requestBattleCleanup(world, planId) {
  const combat = world.state.combat;
  if (!combat || combat.stage === 'idle' || (planId != null && combat.planId !== planId)) return { ok:false, messageKey:'cw.noCleanup', messageParams:{} };
  if (combat.cleanupRequested) return { ok:false, messageKey:'cw.cleanupAlready', messageParams:{} };
  combat.cleanupRequested = true;
  const plan = world.state.eventQueue.find(p => p.id === combat.planId);
  if (plan) plan.cleanupRequested = true;
  if (combat.stage === 'resolved') combat.nextCleanupAt = world.state.time;
  return { ok:true, messageKey:combat.stage === 'resolved' ? 'cw.cleanupNow' : 'cw.cleanupQueued', messageParams:{} };
}

export class BattleSystem {
  constructor(world, { onEvent = () => {}, onCamera = () => {} } = {}) {
    this.world = world;
    this.onEvent = onEvent;
    this.onCamera = onCamera;
    world.state.combat ??= { stage: 'idle', planId: null, units: [], works: [], effects: [], outcome: null };
  }

  record(action, params = {}) {
    const state = this.world.state;
    const event = { source: 'world', action: `combat_${action}`, actor: 'home', time: state.time,
      planId: state.combat.planId, messageKey: `combat.event.${action}`, messageParams: params,
      message: `Combat: ${action.replaceAll('_', ' ')}.` };
    recordEvent(state,event);
    this.onEvent(event);
  }

  start(plan) {
    if (this.world.state.combat.planId === plan.id && this.world.state.combat.stage !== 'preparing') return;
    const works = structuredClone(plan.battlePreparation?.works ?? []);
    const used = new Set();
    for (const work of works) {
      const position = freeSpot(this.world, work.position, [], [], used);
      if (position) { work.position = position; used.add(key(position)); } else work.hp = 0;
    }
    const roles = plan.battlePreparation ? Object.keys(COMBAT_ROLES) : ['swordsman', 'archer'];
    const units = homeUnits(this.world, plan, works, roles) ?? [];
    const { offset } = geometry(this.world, plan);
    const home = homeOf(this.world);
    const composition = (plan.enemyComposition ?? raidComposition(plan.severity)).filter(role => Object.hasOwn(COMBAT_ROLES, role)).slice(0, 6);
    for (const [index, role] of composition.entries()) {
      const position = freeSpot(this.world, offset(home.settlementRadius + 2 + Math.floor(index / 3), (index % 3 - 1) * 2), units, works);
      if (position) units.push(makeUnit(plan, 'enemy', role, index, position));
    }
    if (allySupport(this.world.state) >= 0.1) {
      const position = freeSpot(this.world, offset(10, 4), units, works);
      if (position) units.push(makeUnit(plan, 'ally', 'swordsman', 0, position));
    }
    this.world.state.combat = view(this.world, plan, units, works, 'approaching');
    this.world.state.combat.enemyCount = composition.length;
    this.joinHero(plan);
    this.record('started', { enemies: units.filter(unit => unit.side === 'enemy').length,
      allies: units.filter(unit => unit.side === 'ally').length, gameTime: { gameTime: plan.endAt } });
    this.onCamera({ id: plan.id, position: { ...this.world.state.combat.entry }, kind: 'raid_entry' });
  }

  joinHero(plan) {
    const combat = this.world.state.combat;
    const hero = this.world.state.hero;
    if (!plan || !hero || hero.mode !== 'home' || hero.hp < hero.maxHp
      || combat.units.some(unit => unit.isHero) || combat.units.length >= BATTLE_RULES.maxUnits) return;
    const { offset } = geometry(this.world, plan);
    const position = freeSpot(this.world, offset(11, 2), combat.units, combat.works);
    if (!position) return;
    const unit = makeUnit(plan, 'home', 'swordsman', 0, position);
    unit.id = `${plan.id}:home:hero`;
    if (enlistHero(this.world, unit)) {
      combat.units.push(unit);
      this.record('hero_joined', { level: hero.level });
    }
  }

  effect(type, from, to, extra = {}) {
    const combat = this.world.state.combat;
    combat.effects.push({ id: `${combat.planId}:effect:${++combat.effectSequence}`, type,
      from: { ...from }, to: { ...to }, createdAt: this.world.state.time,
      expiresAt: this.world.state.time + BATTLE_RULES.effectTicks, ...extra });
    if (combat.effects.length > BATTLE_RULES.maxEffects) combat.effects.shift();
  }

  lineClear(from, to) {
    const combat = this.world.state.combat;
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    for (let index = 1; index < steps; index++) {
      const position = { x: Math.round(from.x + (to.x - from.x) * index / steps),
        y: Math.round(from.y + (to.y - from.y) * index / steps) };
      const object = this.world.state.occupied.get(key(position));
      if (object && (['world_tree', 'mountain'].includes(object.type) || this.world.state.buildings.has(object.id))) return false;
      if (combat.works.some(work => work.type === 'barricade' && work.hp > 0 && same(work.position, position))) return false;
    }
    return true;
  }

  covered(unit) {
    const works = this.world.state.combat.works;
    if (works.some(work => work.type === 'cover' && work.hp > 0 && distance(work.position, unit.position) <= 1)) return true;
    return STEPS.some(([dx, dy]) => ['forest', 'pine'].includes(this.world.state.occupied.get(`${unit.position.x + dx},${unit.position.y + dy}`)?.type));
  }

  hit(attacker, target, damage, ranged) {
    const home = homeOf(this.world);
    const readiness = attacker.side === 'home' && !attacker.isHero && home?.labor
      ? (0.5 + Math.min(4, home.labor.defense) * 0.125) * (0.8 + home.happiness / 250) : 1;
    const actual = Math.max(1, Math.round(damage * readiness * (ranged && this.covered(target) ? 0.55 : 1)) - (target.armor ?? 0));
    const cover = ranged && this.world.state.combat.works.find(work => work.type === 'cover'
      && work.hp > 0 && distance(work.position, target.position) <= 1);
    if (cover) cover.hp = Math.max(0, cover.hp - Math.max(0, damage - actual));
    target.hp = Math.max(0, target.hp - actual);
    if (!target.hp) target.status = 'fallen';
    return actual;
  }

  attack(unit, target) {
    const combat = this.world.state.combat;
    const ranged = unit.range > 1;
    this.hit(unit, target, unit.damage, ranged);
    unit.status = 'attacking';
    unit.intent = 'engage';
    unit.nextAttackAt = this.world.state.time + unit.cooldown;
    this.effect(unit.role === 'mage' ? 'spell' : ranged ? 'arrow' : 'slash', unit.position, target.position,
      { side: unit.side, sourceId: unit.id, targetId: target.id });
    if (unit.role === 'mage') {
      for (const secondary of combat.units.filter(other => other !== target && alive(other) && opposite(unit, other)
        && distance(other.position, target.position) <= 2)) this.hit(unit, secondary, Math.ceil(unit.damage / 2), true);
    }
  }

  selectTarget(unit, opponents) {
    const score = other => distance(other.position, unit.position) + (unit.role === 'rogue' && other.range === 1 ? 4 : 0);
    const targets = [...opponents].sort((a, b) => score(a) - score(b));
    const inRange = other => distance(unit.position, other.position) <= unit.range
      && this.lineClear(unit.position, other.position);
    const current = opponents.find(other => other.id === unit.targetId);
    const reachable = targets.find(inRange);
    // Keep an available target, including during attack cooldowns. A nearby
    // pawn taking one step must not make the whole line change direction.
    const target = current && inRange(current) ? current : reachable
      ?? (current && (!targets[0] || score(targets[0]) + 2 >= score(current)) ? current : targets[0]);
    unit.targetId = target?.id ?? null;
    return target;
  }

  commitMove(unit, position) {
    const time = this.world.state.time;
    if (time < (unit.nextMoveAt ?? 0) || same(unit.position, position)) return false;
    const movement = COMBAT_MOVEMENT[unit.role];
    unit.previousPosition = { ...unit.position };
    unit.position = { ...position };
    unit.lastMoveAt = time;
    unit.nextMoveAt = time + movement.interval;
    unit.moveDurationMs = movement.durationMs;
    unit.status = 'moving';
    return true;
  }

  moveToward(unit, target, range = 0) {
    if (this.world.state.time < (unit.nextMoveAt ?? 0)) return false;
    const combat = this.world.state.combat;
    const nodes = [{ position: unit.position, first: null }];
    const visited = new Set([key(unit.position)]);
    for (let cursor = 0; cursor < nodes.length && cursor < BATTLE_RULES.routeBudget; cursor++) {
      const current = nodes[cursor];
      if (current.first && distance(current.position, target) <= range && this.lineClear(current.position, target)) {
        return this.commitMove(unit, current.first);
      }
      const candidates = STEPS.map(([dx, dy]) => ({ x: current.position.x + dx, y: current.position.y + dy }))
        .sort((a, b) => distance(a, target) - distance(b, target));
      for (const position of candidates) {
        if (unit.side !== 'enemy' && !behindLine(combat, position)) continue;
        if (visited.has(key(position)) || !open(this.world, position, combat.units, combat.works, unit)) continue;
        if (visited.size >= BATTLE_RULES.routeBudget) continue;
        visited.add(key(position));
        nodes.push({ position, first: current.first ?? position });
      }
    }
    // A blocked route is retried intermittently rather than searched every
    // tick while neither the target nor the obstacle has changed.
    unit.nextMoveAt = this.world.state.time + 2;
    return false;
  }

  act(unit) {
    const state = this.world.state;
    const combat = state.combat;
    if (!alive(unit)) { unit.status = 'fallen'; return; }
    unit.status = 'ready';
    unit.intent = 'hold';
    if (unit.slowUntil > state.time && state.time % 2 === 0) { unit.status = 'stunned'; return; }
    const opponents = combat.units.filter(other => alive(other) && opposite(unit, other));
    if (unit.side === 'enemy' && unit.role === 'rogue' && state.time >= unit.nextAttackAt) {
      const trap = combat.works.find(work => work.type === 'trap' && !work.triggered && !work.disarmed && distance(work.position, unit.position) <= 1);
      if (trap) {
        trap.disarmed = true;
        unit.intent = 'disarm';
        unit.nextAttackAt = state.time + unit.cooldown;
        this.effect('trap', unit.position, trap.position, { disarmed: true });
        this.record('trap_disarmed');
        return;
      }
    }
    const nearest = [...opponents].sort((a, b) => distance(a.position, unit.position) - distance(b.position, unit.position))[0];
    if (unit.range > 1 && nearest && distance(nearest.position, unit.position) <= 1
      && state.time >= (unit.nextRetreatAt ?? 0) && state.time >= (unit.nextMoveAt ?? 0)) {
      const retreat = STEPS.map(([dx, dy]) => ({ x: unit.position.x + dx, y: unit.position.y + dy }))
        .filter(position => open(this.world, position, combat.units, combat.works, unit))
        .filter(position => unit.side === 'enemy' || behindLine(combat, position))
        .sort((a, b) => distance(b, nearest.position) - distance(a, nearest.position))[0];
      if (retreat && distance(retreat, nearest.position) > distance(unit.position, nearest.position)) {
        unit.intent = 'retreat';
        if (this.commitMove(unit, retreat)) {
          unit.nextRetreatAt = state.time + 4;
          this.checkEntry(unit);
          return;
        }
      }
    }
    const target = this.selectTarget(unit, opponents);
    if (target && distance(unit.position, target.position) <= unit.range && this.lineClear(unit.position, target.position)) {
      if (state.time >= unit.nextAttackAt) this.attack(unit, target);
      return;
    }
    // Defenders hold their prepared line instead of charging past the works
    // and following kiting enemies all the way to the arrival perimeter.
    if (unit.side !== 'enemy' && target && Math.hypot(target.position.x - combat.front.x, target.position.y - combat.front.y) > 8) return;
    const barrier = unit.side === 'enemy' && combat.works.find(work => work.type === 'barricade' && work.hp > 0
      && distance(work.position, unit.position) <= Math.max(1, unit.range - 1) && this.lineClear(unit.position, work.position));
    if (barrier && state.time >= unit.nextAttackAt) {
      barrier.hp = Math.max(0, barrier.hp - unit.damage);
      unit.nextAttackAt = state.time + unit.cooldown;
      unit.status = 'attacking';
      unit.intent = 'breach';
      this.effect(unit.range > 1 ? 'arrow' : 'slash', unit.position, barrier.position, { side: unit.side });
      if (!barrier.hp) { this.effect('breach', barrier.position, barrier.position); this.record('barricade_broken'); }
      return;
    }
    const plan = state.eventQueue.find(candidate => candidate.id === combat.planId);
    const { offset } = geometry(this.world, plan);
    if (unit.side === 'enemy' && unit.role === 'rogue' && !unit.breached
      && (!target || distance(unit.position, target.position) > 3)) {
      const goal = freeSpot(this.world, offset(7, 4), combat.units, combat.works);
      if (goal) { unit.intent = 'flank'; this.moveToward(unit, goal, 0); }
    }
    else if (target) { unit.intent = 'engage'; this.moveToward(unit, target.position, unit.range); }
    else if (unit.side === 'enemy') {
      const goal = freeSpot(this.world, offset(7), combat.units, combat.works);
      if (goal) { unit.intent = 'breach'; this.moveToward(unit, goal, 0); }
    }
    this.checkEntry(unit);
  }

  checkEntry(unit) {
    const state = this.world.state;
    const combat = state.combat;
    const home = homeOf(this.world);
    if (unit.side === 'enemy') {
      const trap = combat.works.find(work => work.type === 'trap' && !work.triggered && !work.disarmed && same(work.position, unit.position));
      if (trap) {
        trap.triggered = true;
        unit.hp = Math.max(0, unit.hp - 9);
        unit.slowUntil = state.time + 3;
        unit.status = unit.hp ? 'stunned' : 'fallen';
        this.effect('trap', trap.position, unit.position);
        this.record('trap_triggered');
      }
      if (alive(unit) && !unit.breached && Math.hypot(unit.position.x - home.anchor.x, unit.position.y - home.anchor.y) <= 9) {
        unit.breached = true;
        combat.breachPressure++;
      }
    }
  }

  update() {
    const state = this.world.state;
    const combat = state.combat;
    const currentPlan = state.eventQueue.find(candidate => candidate.id === combat.planId);
    if (combat.stage === 'resolved') {
      // The forecast first settles casualties/loot and records its outcome.
      // Retain the result until that boundary, including on restored saves.
      if (currentPlan?.stage === 'active') return;
      combat.nextCleanupAt ??= (combat.resolvedAt ?? state.time) + (combat.cleanupRequested ? 0 : CLEANUP_RULES.delay);
      if (state.time < combat.nextCleanupAt) return;
      combat.units = []; combat.effects = [];
      if (combat.works.length) combat.works.shift();
      if (currentPlan?.battlePreparation) currentPlan.battlePreparation.works = structuredClone(combat.works);
      combat.nextCleanupAt = state.time + CLEANUP_RULES.interval;
      if (!combat.works.length) {
        if (currentPlan) currentPlan.cleanedAt = state.time;
        this.record('cleaned');
        state.combat = { stage:'idle', planId:null, units:[], works:[], effects:[], outcome:null };
      }
      return;
    }
    if (combat.stage === 'preparing' && currentPlan?.stage !== 'forecast') {
      const next = state.eventQueue.filter(plan => plan.kind === 'raid' && plan.stage === 'forecast'
        && plan.battlePreparation).sort((a, b) => a.startAt - b.startAt)[0];
      if (next) {
        const works = structuredClone(next.battlePreparation.works);
        const squad = homeUnits(this.world, next, works, Object.keys(COMBAT_ROLES));
        if (squad) state.combat = view(this.world, next, squad, works);
      } else if (combat.stage === 'preparing') {
        state.combat = { stage: 'idle', planId: null, units: [], works: [], effects: [], outcome: null };
      }
      return;
    }
    if (!['approaching', 'fighting'].includes(combat.stage) || combat.lastTick >= state.time) return;
    combat.lastTick = state.time;
    this.joinHero(currentPlan);
    combat.effects = combat.effects.filter(effect => effect.expiresAt > state.time);
    for (const unit of combat.units) this.act(unit);
    const heroUnit = combat.units.find(unit => unit.isHero);
    if (heroUnit && state.hero?.mode === 'defending') {
      state.hero.hp = heroUnit.hp;
      state.hero.scene.heroHp = heroUnit.hp;
    }
    if (combat.units.some(unit => unit.status === 'attacking')) combat.stage = 'fighting';
    const plan = state.eventQueue.find(candidate => candidate.id === combat.planId);
    if (!combat.units.some(unit => unit.side === 'enemy' && alive(unit)) || state.time >= combat.endAt) this.resolve(plan);
  }

  resolve(plan) {
    const combat = this.world.state.combat;
    if (!plan || combat.planId !== plan.id) return null;
    if (combat.outcome) return { ...combat.outcome };
    const enemies = combat.units.filter(unit => unit.side === 'enemy' && alive(unit));
    const count = Math.max(1, combat.enemyCount);
    const strength = enemies.reduce((sum, unit) => sum + unit.hp / unit.maxHp, 0) / count;
    const ratio = Math.min(1, combat.breachPressure / count * (0.25 + 0.75 * strength));
    combat.outcome = { food: Math.min(plan.damage.food, Math.ceil(plan.damage.food * ratio)),
      people: ratio >= 0.65 ? Math.min(1, plan.damage.people) : 0,
      defended: Boolean(plan.battlePreparation), allied: combat.units.some(unit => unit.side === 'ally'),
      breachPressure: combat.breachPressure, enemySurvivors: enemies.length,
      enemyStrength: Math.round(strength * 100) / 100,
      homeSurvivors: combat.units.filter(unit => unit.side !== 'enemy' && alive(unit)).length };
    applyBattleConsequences(this.world, plan, combat);
    combat.stage = 'resolved';
    combat.resolvedAt = this.world.state.time;
    combat.nextCleanupAt = combat.resolvedAt + (combat.cleanupRequested ? 0 : CLEANUP_RULES.delay);
    const heroUnit = combat.units.find(unit => unit.isHero);
    if (heroUnit) releaseHeroFromBattle(this.world, heroUnit);
    this.record('finished', { food: combat.outcome.food, people: combat.outcome.people, breaches: combat.breachPressure });
    return { ...combat.outcome };
  }
}
