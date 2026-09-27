import { recordEvent } from '../game/EventJournal.js';
import { religionOrder, religionConflict } from '../game/Religion.js';
import { prepareDisaster } from '../game/Disasters.js';
import { proposeDiplomacy } from '../game/Diplomacy.js';
import { executeWorldAction } from './worldActions.js';
import { validateDivineSchema } from '../llm/schemas.js';
import { syncResourceTotals } from '../state/worldState.js';
import { SOCIETY } from '../state/society.js';
import { prepareBattle } from '../game/Combat.js';
import { quoteDivineCost, canSpendFaith, spendFaith } from '../game/Faith.js';
import { validateHeroOrder, executeHeroOrder } from '../game/Hero.js';

const failure = (code, message, messageParams = {}) => ({ ok: false, code, message,
  messageKey: `event.divine.failure.${code}`, messageParams });
export function validateDivineAction(world, action, { planId } = {}) {
  if (!validateDivineSchema(action)) return failure('invalid_action', 'This divine command is not supported.');
  // Presence in a state snapshot is not permission to command an external
  // settlement. Only the player's inhabited settlement can receive miracles.
  if ((world.state.playerSettlementId && action.target !== world.state.playerSettlementId) || !world.getVillage(action.target)) {
    return failure('invalid_target', 'Divine messages can reach only your settlement.');
  }
  if (planId !== undefined) {
    const kind = action.action === 'prepare_defense' ? 'raid' : action.action === 'create_rain' ? 'drought' : ['prepare_fire','prepare_flood','prepare_cold'].includes(action.action) ? action.action.slice(8) : null;
    const plan = (world.state.eventQueue ?? []).find(event => event.id === planId);
    if (typeof planId !== 'string' || !plan || plan.kind !== kind || !['forecast', 'active'].includes(plan.stage)) {
      return failure('invalid_context', 'This response no longer matches an upcoming event. Choose the event again.');
    }
  }
  if (action.action.startsWith('hero_')) {
    const hero = validateHeroOrder(world, action);
    if (!hero.ok) return hero;
  }
  const conflict=religionConflict(world.state,action);if(conflict)return conflict;
  const cost = quoteDivineCost(action);
  if (world.state.faith && !canSpendFaith(world.state, cost)) return failure('insufficient_faith',
    'The settlement has not gathered enough faith for this intervention.', { cost, available: Math.floor(world.state.faith.points) });
  return { ok: true };
}

// This is the sole divine-action mutation boundary. Even direct callers must
// pass validation; rejected actions never add events or partially change state.
export function executeDivineAction(world, action, { planId } = {}) {
  const validation = validateDivineAction(world, action, { planId });
  if (!validation.ok) return validation;
  if(action.action==='hold_festival'&&world.state.religion)return religionOrder(world,{type:'order',name:'religion',operation:'rite',id:'harvest'});
  const village = world.getVillage(action.target);
  const messageParams = { village: { villageId: village.id, name: village.name } };
  const { strength = 1, amount = 50, direction } = action.parameters;
  let message = '';
  let messageKey = `event.divine.${action.action}`;
  let position;
  switch (action.action) {
    case 'prepare_fire':
    case 'prepare_flood':
    case 'prepare_cold': {
      const result = prepareDisaster(world, action.action.slice(8), planId);
      if (!result.ok) return result;
      messageKey = result.messageKey; Object.assign(messageParams,result.messageParams); break;
    }
    case 'propose_alliance':
    case 'propose_truce': {
      const result = proposeDiplomacy(world, action.action === 'propose_alliance' ? 'alliance' : 'truce', action.parameters.factionId);
      if (!result.ok) return result;
      messageKey = result.messageKey; Object.assign(messageParams, result.messageParams); break;
    }
    case 'hold_festival':
      village.happiness = Math.min(100, village.happiness + 15);
      village.devotionUntil = world.state.time + 240;
      messageKey = 'diplomacy.festival'; break;
    case 'build_house':
    case 'farm':
    case 'build_temple': {
      const result = executeWorldAction(world, { action: action.action, actor: village.id, target: village.id,
        reason: 'interpretation_of_divine_message', parameters: action.parameters });
      if (!result.ok) return result;
      message = result.message ?? '';  messageKey = result.messageKey;
      Object.assign(messageParams, result.messageParams);
      position = result.event?.position;
      break;
    }
    case 'hero_dispatch':
    case 'hero_recall': {
      const result = executeHeroOrder(world, action);
      if (!result.ok) return result;
      message = result.message ?? '';
      messageKey = result.messageKey;
      Object.assign(messageParams, result.messageParams);
      break;
    }
    case 'prepare_defense': {
      const tactical = Boolean(world.state.combat) && village.id === 'home';
      const preparation = action.parameters.preparation ?? 'balanced';
      const raid = (world.state.eventQueue ?? []).filter(event => event.kind === 'raid'
        && ['forecast', 'active'].includes(event.stage)
        && (planId !== undefined ? event.id === planId : tactical
          ? !event.battlePreparation?.kinds.includes(preparation) : !event.mitigation?.defense))
        .sort((a, b) => a.startAt - b.startAt)[0];
      const prepared = tactical ? prepareBattle(world, raid, preparation) : null;
      if (prepared && !prepared.ok) return prepared;
      village.defenseUntil = world.state.time + SOCIETY.defenseTicks;
      if (raid) {
        village.preparedRaidId = raid.id;
        raid.mitigation = { ...raid.mitigation, defense: true };
        message = `${village.name} prepares defenders for the announced raid at tick ${raid.startAt}.`;
        messageParams.tick = raid.startAt;
        messageKey = 'event.divine.prepare_defense_forecast';
        if (prepared) {
          message = prepared.message;
          messageKey = prepared.messageKey;
          Object.assign(messageParams, prepared.messageParams);
        }
      } else {
        message = `${village.name} prepares defenders until tick ${village.defenseUntil}.`;
        messageParams.tick = village.defenseUntil;
      }
      break;
    }
    case 'create_rain':
      village.weather = 'rain';
      village.rainStrength = strength;
      village.rainUntil = world.state.time + 120;
      {
        const drought = (world.state.eventQueue ?? []).filter(event => event.kind === 'drought' && ['forecast', 'active'].includes(event.stage)
          && (planId !== undefined ? event.id === planId : !event.mitigation?.rain))
          .sort((a, b) => a.startAt - b.startAt)[0];
        if (drought) drought.mitigation = { ...drought.mitigation, rain: true };
      }
      message = `Rain falls on ${village.name}.`;
      break;
    case 'create_forest': {
      position = world.findEmptyArea(village, world.content.get('forest')?.footprint, direction);
      if (!position || !world.placeTerrain('forest', village.id, position)) {
        return failure('no_space', `There is no empty ground near ${village.name}.`, messageParams);
      }
      message = `A forest grows near ${village.name} at (${position.x}, ${position.y}).`;
      Object.assign(messageParams, position);
      break;
    }
    case 'bless_village':
    case 'curse_village': {
      const sign = action.action === 'bless_village' ? 1 : -1;
      village.happiness = Math.max(0, Math.min(100, village.happiness + sign * Math.round(10 * strength)));
      message = `${village.name} is ${sign === 1 ? 'blessed' : 'cursed'}. Happiness: ${village.happiness}.`;
      messageParams.happiness = village.happiness;
      break;
    }
    case 'increase_food':
      village.food += amount;
      message = `${village.name} receives ${amount} food.`;
      messageParams.amount = amount;
      break;
  }
  const faithCost = world.state.faith ? quoteDivineCost(action) : 0;
  if (world.state.faith) spendFaith(world.state, faithCost);
  if (messageParams.costs?.resourceBasket) messageParams.costs = { resourceBasket: { ...messageParams.costs.resourceBasket, faith: faithCost } };
  syncResourceTotals(world.state);
  const event = { source: 'divine', time: world.state.time, action: action.action,
    target: village.id, message, messageKey, messageParams,
    ...(position ? { position: { ...position } } : {}) };
  recordEvent(world.state,event);
  return { ok: true, event, message, messageKey: event.messageKey, messageParams, faithCost };
}
