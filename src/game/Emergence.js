import { recordEvent } from '../game/EventJournal.js';
import { SOCIETY, relation } from '../state/society.js';
import { syncResourceTotals } from '../state/worldState.js';

// Tick-driven aggregate effects and transient outside forces; never NPC armies
// or persistent extra settlements. Randomness is injectable for reproducibility.
export class Emergence {
  constructor(world, { random = Math.random, onEvent = () => {}, forecastManaged = false } = {}) {
    this.world = world;
    this.random = random;
    this.onEvent = onEvent;
    this.forecastManaged = forecastManaged;
    this.nextCrisis = world.state.time + SOCIETY.firstCrisisTick;
    this.lastTick = world.state.time;
  }

  record(actor, action, message, messageKey, messageParams) {
    const event = { source: 'world', time: this.world.state.time, actor, action, message, messageKey, messageParams };
    recordEvent(this.world.state,event);
    this.onEvent(event);
  }

  update() {
    const state = this.world.state;
    if (state.time <= this.lastTick) return;
    this.lastTick = state.time;
    const living = state.villages.filter(v => v.population > 0);
    const enemies = new Map(living.map(v => [v.id, living.find(other => relation(v, other) === 'war')]));
    for (const v of state.villages) {
      const village = { villageId: v.id, name: v.name };
      const crisis = v.crisis;
      if (!this.forecastManaged && crisis && (state.time >= crisis.resolveAt || v.population <= 0
        || (crisis.kind === 'drought' && v.weather === 'rain'))) {
        if (crisis.kind === 'raid') {
          const defended = (v.defenseUntil ?? 0) >= state.time;
          const allied = state.villages.some(other => other.population > 0 && relation(v, other) === 'allied');
          const food = defended ? 0 : Math.min(v.food, allied ? 20 : 40);
          const people = defended ? 0 : Math.min(v.population, Math.ceil(v.population * (allied ? 0.01 : 0.02)));
          v.food -= food;
          v.population -= people;
          this.record(v.id, 'raid_resolved', `${v.name}: raiders withdrew. Lost ${food.toFixed(0)} food and ${people} people${defended ? '; defenders held the line' : allied ? '; allies reduced the losses' : ''}.`,
            defended ? 'event.crisis.raid_defended' : allied ? 'event.crisis.raid_allied' : 'event.crisis.raid_resolved',
            { village, food: Math.round(food), people });
        } else {
          if (v.weather === 'drought') v.weather = crisis.previousWeather === 'rain'
            ? (v.rainUntil > state.time ? 'rain' : 'clear') : crisis.previousWeather;
          this.record(v.id, 'drought_resolved', `${v.name}: the drought has ended.`, 'event.crisis.drought_resolved', { village });
        }
        v.crisis = null;
      }
      if (v.population > 0 && state.time % 10 === 0) {
        if ((v.templeCount ?? 0) > 0 && v.religion !== 'none') v.happiness = Math.min(100, v.happiness + 1);
        const enemy = enemies.get(v.id);
        if (enemy) {
          const defended = (v.defenseUntil ?? 0) >= state.time;
          v.food = Math.max(0, v.food - (defended ? 1 : 3));
          if (!defended) v.population = Math.max(0, v.population - 1);
          v.happiness = Math.max(0, v.happiness - 1);
          this.record(v.id, 'conflict', `${v.name}: conflict with ${enemy.name} costs ${defended ? '1 food' : '3 food and 1 person'}. An alliance could end the fighting.`,
            defended ? 'event.crisis.conflict_defended' : 'event.crisis.conflict',
            { village, target: { villageId: enemy.id, name: enemy.name }, food: defended ? 1 : 3, people: defended ? 0 : 1 });
        }
      }
    }
    if (!this.forecastManaged && state.time >= this.nextCrisis) {
      this.nextCrisis = state.time + SOCIETY.crisisInterval;
      const candidates = state.villages.filter(v => v.population > 0 && !v.crisis);
      if (candidates.length) {
        const v = candidates[Math.min(candidates.length - 1, Math.max(0, Math.floor(this.random() * candidates.length)))];
        const kind = this.random() < 0.5 ? 'raid' : 'drought';
        v.crisis = { kind, resolveAt: state.time + (kind === 'raid' ? SOCIETY.raidWarningTicks : SOCIETY.droughtTicks),
          previousWeather: v.weather ?? state.weather };
        if (kind === 'drought') v.weather = 'drought';
        this.record(v.id, kind, kind === 'raid'
          ? `${v.name}: raiders approach! Prepare defenders before tick ${v.crisis.resolveAt}.`
          : `${v.name}: drought threatens the harvest until tick ${v.crisis.resolveAt}. Send rain before famine follows.`,
          `event.crisis.${kind}`, { village: { villageId: v.id, name: v.name }, tick: v.crisis.resolveAt });
      }
    }
    syncResourceTotals(state);
  }
}
