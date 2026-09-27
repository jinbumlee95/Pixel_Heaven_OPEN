import { recordEvent } from '../game/EventJournal.js';
import { queueConstruction } from '../game/Work.js';
import { ECONOMY, buildingCost, housingCapacity, reserveTicks, canAffordResources, spendResources } from '../state/economy.js';
import { DIRECTIONS } from '../state/directions.js';
import { syncResourceTotals } from '../state/worldState.js';
import { RULES } from '../game/Simulation.js';
import { RELIGIONS, relation, setRelation } from '../state/society.js';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const failed = code => ({ ok: false, code,
  messageKey: `event.world.failure.${code}`, messageParams: {} });
export function validateWorldSchema(value) {
  if (!record(value) || !Object.hasOwn(value, 'action')) return false;
  if (value.action === 'none') return Object.keys(value).length === 1;
  if (!['build_house', 'farm', 'trade', 'migrate', 'build_temple', 'change_religion', 'start_war', 'form_alliance'].includes(value.action)
    || Object.keys(value).length !== 5
    || !['actor', 'action', 'target', 'reason', 'parameters'].every(k => Object.hasOwn(value, k))
    || !['actor', 'target', 'reason'].every(k => typeof value[k] === 'string' && value[k].trim() && value[k].length <= 160)
    || !record(value.parameters)) return false;
  const p = value.parameters;
  if (['start_war', 'form_alliance'].includes(value.action)) return Object.keys(p).length === 0;
  if (value.action === 'change_religion') return Object.keys(p).length === 1 && RELIGIONS.includes(p.religion);
  if (['farm', 'build_house', 'build_temple'].includes(value.action)) {
    return Object.keys(p).every(k => k === 'direction')
      && (!Object.hasOwn(p, 'direction') || DIRECTIONS.includes(p.direction));
  }
  const key = value.action === 'trade' ? 'food' : 'people';
  return Object.keys(p).length === 1 && Object.hasOwn(p, key)
    && Number.isInteger(p[key]) && p[key] > 0 && p[key] <= (key === 'food' ? 100 : 20);
}

export function validateWorldAction(world, action) {
  if (!validateWorldSchema(action)) return failed('invalid_action');
  if (action.action === 'none') return { ok: true };
  const actor = world.getVillage(action.actor);
  const target = world.getVillage(action.target);
  if (!actor || !target || actor.population <= 0) return failed('invalid_target');
  const p = action.parameters;
  if (action.action === 'change_religion') {
    if (actor !== target) return failed('invalid_target');
    if (actor.religion === p.religion || (actor.templeCount ?? 0) === 0) return failed('faith_not_ready');
  } else if (['start_war', 'form_alliance'].includes(action.action)) {
    if (actor === target || target.population <= 0) return failed('invalid_target');
    if (action.action === 'start_war' && (relation(actor, target) !== 'neutral'
      || actor.happiness >= 35 || actor.religion === target.religion)) return failed('conflict_not_ready');
    if (action.action === 'form_alliance' && relation(actor, target) === 'allied') return failed('already_allied');
  } else if (['build_house', 'farm', 'build_temple'].includes(action.action)) {
    if (actor !== target) return failed('invalid_target');
    const cost = buildingCost(actor, action.action);
    if (actor.wood < cost.wood) return failed('insufficient_wood');
    if (!canAffordResources(actor, cost)) return failed('insufficient_resources');
    if (action.action === 'build_temple' && (actor.templeCount ?? 0) >= 1) return failed('temple_exists');
  } else {
    if (actor === target || target.population <= 0) return failed('invalid_target');
    if (relation(actor, target) === 'war') return failed('hostile_target');
    if (action.action === 'trade') {
      const cost = Math.ceil(p.food / ECONOMY.foodPerWood);
      if (actor.wood < cost || target.food - p.food < target.population * RULES.consumptionPerPerson * reserveTicks(target)) {
        return failed('insufficient_resources');
      }
    } else if (actor.population < p.people
      || housingCapacity(target) < target.population + p.people
      || target.food < (target.population + p.people) * RULES.consumptionPerPerson * reserveTicks(target)) {
      return failed('insufficient_capacity');
    }
  }
  return { ok: true };
}

export function executeWorldAction(world, action) {
  const validation = validateWorldAction(world, action);
  if (!validation.ok) return validation;
  if (action.action === 'none') return { ok: true, event: null };
  if (world.state.work && ['build_house', 'farm', 'build_temple'].includes(action.action)) return queueConstruction(world, action);
  const actor = world.getVillage(action.actor);
  const target = world.getVillage(action.target);
  const p = action.parameters;
  let message;
  const messageParams = { village: { villageId: actor.id, name: actor.name },
    target: { villageId: target.id, name: target.name } };
  let position;
  if (['start_war', 'form_alliance'].includes(action.action)) {
    setRelation(actor, target, action.action === 'start_war' ? 'war' : 'allied');
    message = `${actor.name} ${action.action === 'start_war' ? 'went to war with' : 'formed an alliance with'} ${target.name}.`;
  } else if (action.action === 'change_religion') {
    actor.religion = p.religion;
    message = `${actor.name} now follows ${p.religion}.`;
    messageParams.religion = { religionId: p.religion };
  } else if (['build_house', 'farm', 'build_temple'].includes(action.action)) {
    const temple = action.action === 'build_temple';
    const type = temple ? 'temple' : action.action === 'farm' ? 'farmland' : 'house';
    position = world.findEmptyArea(actor, world.content.get(type)?.footprint, p.direction);
    if (!position) return failed('no_space');
    const object = action.action === 'farm' ? world.placeTerrain('farmland', actor.id, position)
      : world.placeBuilding(type, actor.id, position);
    if (!object) return failed('no_space');
    spendResources(actor, buildingCost(actor, action.action));
    if (action.action === 'build_house') messageParams.people = housingCapacity({ ...actor, houseCount: 1 });
    message = `${actor.name} ${temple ? 'built a temple in response to the oracle' : action.action === 'farm' ? 'cultivated a field to improve the harvest' : `built a house for ${messageParams.people} people`}.`;
  } else if (action.action === 'trade') {
    const cost = Math.ceil(p.food / ECONOMY.foodPerWood);
    actor.food += p.food;
    target.food -= p.food;
    actor.wood -= cost;
    target.wood += cost;
    message = `${actor.name} traded ${cost} wood for ${p.food} food from ${target.name}.`;
    Object.assign(messageParams, { wood: cost, food: p.food });
  } else {
    actor.population -= p.people;
    target.population += p.people;
    message = `${p.people} people moved from ${actor.name} to ${target.name}.`;
    messageParams.people = p.people;
  }
  syncResourceTotals(world.state);
  const event = { source: 'world', time: world.state.time, actor: actor.id,
    target: target.id, action: action.action, reason: action.reason, message,
    messageKey: `event.world.${action.action}`, messageParams,
    ...(position ? { position: { ...position } } : {}) };
  recordEvent(world.state,event);
  return { ok: true, event };
}
