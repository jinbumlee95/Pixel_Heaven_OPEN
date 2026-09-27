import { ORACLE_SUBJECTS } from './OracleFailure.js';
import { DIRECTIONS } from '../state/directions.js';

export const DIVINE_ACTIONS = Object.freeze([
  'prepare_fire', 'prepare_flood', 'prepare_cold',
  'hold_festival', 'propose_alliance', 'propose_truce',
  'build_house', 'farm', 'build_temple',
  'create_rain', 'create_forest', 'bless_village', 'curse_village', 'increase_food', 'prepare_defense', 'hero_dispatch', 'hero_recall',
]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

// Interpretation results have two disjoint shapes. Uncertainty is never an
// executable action; validateDivineSchema below remains action-only.
export function validateDivineInterpretation(value) {
  if (validateDivineSchema(value)) return true;
  return record(value) && Object.keys(value).every(k=>['status','confidence','reason','subject'].includes(k))
    && (value.subject === undefined || ORACLE_SUBJECTS.includes(value.subject))
    && (value.reason === undefined || ['provider_failed','invalid_output','invalid_json','unsupported_language','mode_changed'].includes(value.reason))
    && Object.hasOwn(value, 'status') && Object.hasOwn(value, 'confidence')
    && value.status === 'unclear' && typeof value.confidence === 'number'
    && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1;
}

// Validate the data boundary before the engine reads or executes any parameters.
export function validateDivineSchema(value) {
  if (!record(value) || Object.keys(value).length !== 4
    || !['status', 'action', 'target', 'parameters'].every(key => Object.hasOwn(value, key))) return false;
  if (value.status !== 'understood' || !DIVINE_ACTIONS.includes(value.action)
    || typeof value.target !== 'string' || !value.target.trim() || value.target.length > 64
    || !record(value.parameters)) return false;
  const parameters = value.parameters;
  const allowed = value.action.startsWith('propose_') ? ['factionId'] : ['hold_festival','prepare_fire','prepare_flood','prepare_cold'].includes(value.action) ? [] : value.action.startsWith('hero_') ? [] : value.action === 'prepare_defense' ? ['preparation'] : ['create_forest', 'build_house', 'farm', 'build_temple'].includes(value.action) ? ['direction']
    : value.action === 'increase_food' ? ['amount'] : ['strength'];
  if (Object.keys(parameters).some(key => !allowed.includes(key))) return false;
  if (Object.hasOwn(parameters, 'factionId') && !/^faction-\d{2}$/.test(parameters.factionId)) return false;
  if (Object.hasOwn(parameters, 'direction') && !DIRECTIONS.includes(parameters.direction)) return false;
  if (Object.hasOwn(parameters, 'preparation') && !['balanced', 'cover', 'barricade', 'trap'].includes(parameters.preparation)) return false;
  if (Object.hasOwn(parameters, 'strength') && (typeof parameters.strength !== 'number'
    || !Number.isFinite(parameters.strength) || parameters.strength <= 0 || parameters.strength > 1)) return false;
  if (Object.hasOwn(parameters, 'amount') && (!Number.isInteger(parameters.amount)
    || parameters.amount < 1 || parameters.amount > 1000)) return false;
  return true;
}

// Provider output and engine validation share the same action names and parameter contract.
export const DIVINE_RESPONSE_SCHEMA = { type: 'object', oneOf: [
  { type: 'object', additionalProperties: false, required: ['status', 'confidence'],
    properties: { status: { const: 'unclear' }, confidence: { type: 'number', minimum: 0, maximum: 1 }, subject: {enum:ORACLE_SUBJECTS} } },
  ...DIVINE_ACTIONS.map(action => {
    const properties = action.startsWith('propose_') ? { factionId: { type: 'string', pattern: '^faction-[0-9]{2}$' } } : ['hold_festival','prepare_fire','prepare_flood','prepare_cold'].includes(action) ? {} : action.startsWith('hero_') ? {} : action === 'prepare_defense'
      ? { preparation: { enum: ['balanced', 'cover', 'barricade', 'trap'] } }
      : ['create_forest', 'build_house', 'farm', 'build_temple'].includes(action)
        ? { direction: { enum: DIRECTIONS } } : action === 'increase_food'
          ? { amount: { type: 'integer', minimum: 1, maximum: 1000 } }
          : { strength: { type: 'number', exclusiveMinimum: 0, maximum: 1 } };
    return { type: 'object', additionalProperties: false, required: ['status', 'action', 'target', 'parameters'],
      properties: { status: { const: 'understood' }, action: { const: action }, target: { type: 'string', minLength: 1, maxLength: 64 },
        parameters: { type: 'object', properties, additionalProperties: false } } };
  }),
] };
