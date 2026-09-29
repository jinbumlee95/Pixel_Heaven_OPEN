import { recordEvent } from './EventJournal.js';
import { faithCapacity } from './Faith.js';
import { WORKSHOPS } from '../content/production.js';

// Milestones read existing world state only. Each pays its faith reward once.
const home = state => state.villages.find(village => village.id === 'home');
const buildingCount = (state, match) => [...(state.buildings?.values() ?? [])].filter(b => b.villageId === 'home' && match(b.type)).length;
export const LEGENDS = Object.freeze([
  { id: 'growing_flock', reward: 10, goal: 12, progress: s => home(s)?.population ?? 0 },
  { id: 'hearth_and_home', reward: 8, goal: 3, progress: s => buildingCount(s, type => type === 'house') },
  { id: 'first_workshop', reward: 8, goal: 1, progress: s => buildingCount(s, type => Object.hasOwn(WORKSHOPS, type)) },
  { id: 'sacred_ground', reward: 15, goal: 1, progress: s => home(s)?.templeCount ?? 0 },
  { id: 'rising_hero', reward: 10, goal: 5, progress: s => s.hero?.level ?? 0 },
  { id: 'dungeon_delver', reward: 12, goal: 5, progress: s => s.hero?.dungeonsCleared ?? 0 },
  { id: 'boss_slayer', reward: 20, goal: 1, progress: s => s.hero?.dungeon?.bossWins ?? 0 },
  { id: 'wrath_of_heaven', reward: 5, goal: 1, progress: s => s.legends?.tally.smites ?? 0 },
  { id: 'unbroken_wall', reward: 15, goal: 1, progress: s => s.legends?.tally.flawless ?? 0 },
  { id: 'wonder_witness', reward: 6, goal: 3, progress: s => s.legends?.tally.wonders ?? 0 },
  { id: 'awakened_tree', reward: 20, goal: 1, progress: s => s.religion?.treeLevel ?? 0 },
  { id: 'thriving_realm', reward: 25, goal: 20, progress: s => home(s)?.population ?? 0 },
].map(Object.freeze));
export const LEGEND_TALLIES = Object.freeze(['smites', 'flawless', 'wonders']);

export function initializeLegends(state) {
  state.legends ??= { version: 1, earned: {}, tally: {} };
  for (const key of LEGEND_TALLIES) state.legends.tally[key] ??= 0;
  return state.legends;
}
// Counters are only incremented by engine outcomes (a smite, a flawless raid, a wonder).
export function tallyLegend(state, key) {
  if (!state.legends || !LEGEND_TALLIES.includes(key)) return;
  state.legends.tally[key] = (state.legends.tally[key] ?? 0) + 1;
}
export function validLegends(legends) {
  const n = value => Number.isFinite(value) && value >= 0 && value <= 1e9;
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  return record(legends) && legends.version === 1 && record(legends.earned) && record(legends.tally)
    && Object.entries(legends.earned).every(([id, time]) => LEGENDS.some(l => l.id === id) && n(time))
    && Object.entries(legends.tally).every(([key, value]) => LEGEND_TALLIES.includes(key) && Number.isInteger(value) && n(value));
}
export function legendProgress(state, legend) {
  return Math.min(legend.goal, Math.max(0, Math.floor(legend.progress(state) || 0)));
}

export class LegendSystem {
  constructor(world, { onEvent = () => {} } = {}) {
    this.world = world;
    this.onEvent = onEvent;
    initializeLegends(world.state);
  }

  update() {
    const state = this.world.state;
    const legends = initializeLegends(state);
    for (const legend of LEGENDS) {
      if (Object.hasOwn(legends.earned, legend.id) || legendProgress(state, legend) < legend.goal) continue;
      legends.earned[legend.id] = state.time;
      // The reward fills faith up to capacity; it never breaks the faith budget.
      const gained = state.faith ? Math.max(0, Math.min(legend.reward, faithCapacity(state) - state.faith.points)) : 0;
      if (gained) { state.faith.points += gained; state.faith.generated = (state.faith.generated ?? 0) + gained; }
      const event = { source: 'world', action: 'legend_earned', actor: 'home', time: state.time, legendId: legend.id,
        messageKey: 'legend.earned', messageParams: { legend: { messageKey: `legend.name.${legend.id}`, messageParams: {} }, faith: Math.round(gained) },
        message: `Legend earned: ${legend.id.replaceAll('_', ' ')} (+${Math.round(gained)} faith).` };
      recordEvent(state, event);
      this.onEvent(event);
    }
  }
}
