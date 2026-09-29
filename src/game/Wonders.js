import { recordEvent } from './EventJournal.js';
import { faithCapacity } from './Faith.js';
import { housingCapacity, stockLimit } from '../state/economy.js';
import { syncResourceTotals } from '../state/worldState.js';
import { worldRandom } from '../state/Persistence.js';
import { tallyLegend } from './Legends.js';

// Rare good fortune between the forecast threats. Its own saved RNG stream
// keeps raid/drought forecasts identical to worlds without wonders.
export const WONDER_RULES = Object.freeze({ firstDelay: 180, minGap: 300, maxGap: 540 });
export const WONDERS = Object.freeze(['pilgrims', 'star_iron', 'golden_harvest', 'wandering_bard', 'faithful_dream', 'merchant_gift']);
const home = state => state.villages.find(village => village.id === 'home');
const add = (village, id, amount) => {
  const gained = Math.max(0, Math.min(amount, stockLimit(village, id) - (village[id] ?? 0)));
  village[id] = (village[id] ?? 0) + gained;
  return Math.floor(gained);
};

export function validWonders(wonders) {
  return Boolean(wonders) && Number.isSafeInteger(wonders.sequence) && wonders.sequence >= 0
    && Number.isFinite(wonders.nextAt) && wonders.nextAt >= 0
    && (wonders.last === null || WONDERS.includes(wonders.last));
}

// Each candidate reports its effect, or null when it cannot help right now.
function applyWonder(state, id) {
  const village = home(state);
  if (id === 'pilgrims') {
    const room = Math.min(2, housingCapacity(village) - village.population);
    if (room <= 0) return null;
    village.population += room;
    return { people: room };
  }
  if (id === 'star_iron') {
    const iron = add(village, 'iron', 4), gold = add(village, 'gold', 1);
    return iron || gold ? { iron, gold } : null;
  }
  if (id === 'golden_harvest') {
    const food = add(village, 'food', 10 + village.population * 2);
    return food ? { food } : null;
  }
  if (id === 'wandering_bard') {
    if (village.happiness >= 95) return null;
    const joy = Math.min(8, 100 - village.happiness);
    village.happiness += joy;
    return { happiness: Math.round(joy) };
  }
  if (id === 'faithful_dream') {
    if (!state.faith) return null;
    const faith = Math.max(0, Math.min(8, faithCapacity(state) - state.faith.points));
    if (!faith) return null;
    state.faith.points += faith; state.faith.generated = (state.faith.generated ?? 0) + faith;
    return { faith: Math.round(faith) };
  }
  const silver = add(village, 'silver', 2);
  return silver ? { silver } : null;
}

export class WonderSystem {
  constructor(world, { seed = 72913, onEvent = () => {} } = {}) {
    this.world = world;
    this.onEvent = onEvent;
    this.random = worldRandom(world, (Number(seed) ^ 0x5bd1e995) >>> 0, 'wonderRandomState');
    world.state.wonders ??= { sequence: 0, nextAt: world.state.time + WONDER_RULES.firstDelay, last: null };
  }

  update() {
    const state = this.world.state;
    const wonders = state.wonders;
    if (state.time < wonders.nextAt || !home(state) || home(state).population <= 0) return;
    wonders.nextAt = state.time + WONDER_RULES.minGap + Math.floor(this.random() * (WONDER_RULES.maxGap - WONDER_RULES.minGap));
    // Try candidates in a random order, never repeating the previous wonder.
    const pool = WONDERS.filter(id => id !== wonders.last);
    const start = Math.floor(this.random() * pool.length);
    for (let index = 0; index < pool.length; index++) {
      const id = pool[(start + index) % pool.length];
      const effect = applyWonder(state, id);
      if (!effect) continue;
      wonders.sequence++; wonders.last = id;
      tallyLegend(state, 'wonders');
      syncResourceTotals(state);
      const event = { source: 'world', action: 'wonder', actor: 'home', time: state.time, wonderId: id,
        messageKey: `wonder.${id}`, messageParams: effect, message: `A wonder: ${id.replaceAll('_', ' ')}.` };
      recordEvent(state, event);
      this.onEvent(event);
      return;
    }
  }
}
