import { recordEvent } from '../game/EventJournal.js';
import { faithRule } from '../content/religion.js';
import { reconcileLabor } from './Work.js';
import { nextStoryTime } from './Story.js';
import { DISASTERS, hazardExposure, updateDisaster } from './Disasters.js';
import { SOCIETY } from '../state/society.js';
import { syncResourceTotals } from '../state/worldState.js';
import { allySupport, chooseHostileFaction } from './Factions.js';
import { BATTLE_RULES, raidComposition } from './Combat.js';
import { GAME_DAY_SECONDS } from './GameTime.js';
import { refundFaith, quoteDivineCost } from './Faith.js';

export const FORECAST_RULES = Object.freeze({ leadTicks: 3 * GAME_DAY_SECONDS, spacingTicks: 3 * GAME_DAY_SECONDS,
  raidDuration: BATTLE_RULES.duration, droughtDuration: SOCIETY.droughtTicks, queueLimit: 4, pendingCount: 2 });
const pending = event => event.stage === 'forecast' || event.stage === 'active';

export function getForecasts(state) {
  return structuredClone((state.eventQueue ?? []).filter(pending).sort((a, b) => a.startAt - b.startAt));
}

export class EventForecast {
  constructor(world, { random = Math.random, onEvent = () => {}, battle = null } = {}) {
    this.world = world;
    this.random = random;
    this.onEvent = onEvent;
    this.battle = battle;
    world.state.eventQueue ??= [];
    world.state.forecastSimulation ??= { sequence: 0, lastTick: world.state.time - 1 };
    // Old saves could contain two published raids. Keep the active/earliest
    // raid; explicitly avert duplicates without damage and refund preparation.
    const raids=world.state.eventQueue.filter(p=>p.kind==='raid'&&pending(p))
      .sort((a,b)=>Number(b.stage==='active')-Number(a.stage==='active')||a.startAt-b.startAt);
    for(const plan of raids.slice(1)) {
      plan.stage='averted';plan.resolvedAt=world.state.time;plan.outcome={food:0,people:0,migration:true};
      const home=world.state.villages.find(v=>v.id==='home'), prep=plan.battlePreparation;
      if(prep){for(const [id,n]of Object.entries(prep.resourcesSpent??{wood:prep.woodSpent??0}))home[id]+=n;
        if(world.state.faith)for(const kind of prep.kinds)refundFaith(world.state,quoteDivineCost({action:'prepare_defense',parameters:{preparation:kind}}));}
      if(home.preparedRaidId===plan.id)home.preparedRaidId=null;
      if(world.state.combat?.planId===plan.id)world.state.combat={stage:'idle',units:[],works:[],effects:[]};
      this.record(plan,'raid_migrated','cw.legacy',{id:plan.id});
    }
    if(raids.length>1)syncResourceTotals(world.state);
    this.fillQueue();
  }

  sample() { return Math.max(0, Math.min(1 - Number.EPSILON, Number(this.random()) || 0)); }

  record(plan, action, messageKey, params = {}, message = '') {
    const state = this.world.state;
    const event = { source: 'world', action, actor: 'home', target: 'home', time: state.time,
      planId: plan.id, messageKey, message, messageParams: {
        tick: plan.startAt, end: plan.endAt, severity: plan.severity,
        faction: plan.sourceFactionId ? { factionId: plan.sourceFactionId, nameKey: plan.sourceNameKey }
          : { messageKey: 'forecast.raiders', messageParams: {} }, ...params } };
    recordEvent(state,event);
    this.onEvent(event);
  }

  fillQueue() {
    const state = this.world.state;
    const home = state.villages.find(village => village.id === 'home');
    if (!home || home.population <= 0) return;
    while (state.eventQueue.filter(pending).length < FORECAST_RULES.pendingCount) {
      const previousStart = Math.max(-FORECAST_RULES.spacingTicks, ...state.eventQueue.map(event => event.startAt));
      const startAt = state.story ? Math.max(nextStoryTime(state, Math.max(0, previousStart), () => this.sample()), Math.max(-120,...state.eventQueue.map(p=>p.endAt))+120) : Math.max(state.time + FORECAST_RULES.leadTicks, previousStart + FORECAST_RULES.spacingTicks);
      let kind = state.story ? ['raid','drought','fire','flood','cold'][Math.min(4,Math.floor(this.sample()*5))] : this.sample() < 0.5 ? 'raid' : 'drought';
      // Weather influences only the next unpublished forecast, never impact rolls.
      if(state.story&&state.climate?.wet>=120&&kind==='drought')kind='flood';
      if(state.story&&state.climate?.dry>=360&&kind==='flood')kind='fire';
      // Eligibility is determined before committing a new warning. An existing
      // raid occupies the combat slot through complete resolution, not start.
      if(kind==='raid'&&state.eventQueue.some(p=>p.kind==='raid'&&pending(p)))kind='drought';
      const source = kind === 'raid' ? chooseHostileFaction(state, () => this.sample()) : null;
      if (kind === 'raid' && !source) kind = 'drought';
      const severity = 1 + Math.floor(this.sample() * (state.story?.profile==='gentle'?2:3));
      const plan = { id: `forecast-${++state.forecastSimulation.sequence}`, kind, stage: 'forecast',
        announcedAt: state.time, startAt,
        endAt: startAt + (kind === 'raid' ? FORECAST_RULES.raidDuration : state.story ? (kind === 'fire' ? 60 : 120 + severity * 40) : FORECAST_RULES.droughtDuration),
        ...(DISASTERS.includes(kind) ? { exposure: hazardExposure(this.world, kind) } : {}),
        sourceFactionId: source?.id ?? null, sourceNameKey: source?.nameKey ?? null,
        severity, damage: { food: kind === 'raid' ? 8 + severity * 4 : 0, people: kind === 'raid' ? 1 : 0 },
        entryDirection: kind === 'raid' ? ['north', 'east', 'south', 'west'][Math.floor(this.sample() * 4)] : null,
        enemyComposition: kind === 'raid' ? raidComposition(severity) : [],
        harvestFactor: kind === 'drought' ? Math.round((1 - severity * 0.2) * 100) / 100 : null,
        mitigation: { rain: false, defense: false } };
      state.eventQueue.push(plan);
      if(DISASTERS.includes(kind))plan.damage.structures=kind==='cold'?0:Math.min(100,Math.ceil((plan.endAt-plan.startAt)/10)*severity*2*faithRule(state,'disasterDamage'));
      this.record(plan, 'forecast', `forecast.event.warning_${kind}`, {},
        kind === 'raid' ? `An outside raid is expected at tick ${startAt}. Prepare our defenders.`
          : `Drought is expected at tick ${startAt}. Send rain before it arrives.`);
    }
    // Keep two future/current plans and at most two finished plans. The original
    // sampled parameters remain available for inspection after each outcome.
    const finished = state.eventQueue.filter(event => !pending(event));
    while (state.eventQueue.length > FORECAST_RULES.queueLimit && finished.length) {
      const oldest = finished.shift();
      state.eventQueue.splice(state.eventQueue.indexOf(oldest), 1);
    }
  }

  finish(plan, home, averted = false) {
    const state = this.world.state;
    if (!pending(plan)) return;
    plan.stage = averted ? 'averted' : 'resolved';
    plan.resolvedAt = state.time;
    if (plan.kind === 'raid') {
      const battleOutcome = !averted && this.battle ? this.battle.resolve(plan) : null;
      const defended = battleOutcome ? battleOutcome.defended
        : plan.mitigation.defense || home.preparedRaidId === plan.id || (home.defenseUntil ?? 0) >= state.time;
      const aid = battleOutcome ? battleOutcome.allied : allySupport(state) > 0;
      const food = averted ? 0 : battleOutcome ? Math.min(home.food, plan.damage.food, battleOutcome.food)
        : defended ? 0 : Math.min(home.food, Math.ceil(plan.damage.food * (aid ? 0.5 : 1)));
      const people = averted ? 0 : battleOutcome ? Math.min(home.population, plan.damage.people, battleOutcome.people)
        : defended || aid ? 0 : Math.min(home.population, plan.damage.people);
      home.food -= food;
      home.population -= people;
      plan.outcome = { ...battleOutcome, food, people, defended, allied: aid };
      if (home.preparedRaidId === plan.id) home.preparedRaidId = null;
      this.record(plan, 'raid_resolved', averted ? 'forecast.event.raid_averted'
        : battleOutcome ? 'combat.event.settlement_loss'
          : defended ? 'forecast.event.raid_defended' : aid ? 'forecast.event.raid_supported' : 'forecast.event.raid_resolved',
      { food, people }, `The forecast raid ended: ${food} food and ${people} people lost.`);
    } else if (DISASTERS.includes(plan.kind)) {
      if (home.weather === 'cold') home.weather = 'clear';
      plan.outcome = { protected: Boolean(plan.mitigation.protected), extinguished: Boolean(plan.extinguished) };
      this.record(plan, 'disaster_resolved', 'disaster.resolved', { kind: { messageKey: `disaster.${plan.kind}` } });
    } else {
      if (home.weather === 'drought') home.weather = plan.previousWeather === 'rain'
        ? (home.rainUntil > state.time ? 'rain' : 'clear') : plan.previousWeather ?? 'clear';
      delete home.droughtFactor;
      plan.outcome = { rain: averted || plan.mitigation.rain || home.weather === 'rain' };
      this.record(plan, 'drought_resolved', averted ? 'forecast.event.drought_averted' : 'forecast.event.drought_resolved', {},
        averted ? 'Early rain averted the forecast drought.' : 'The forecast drought has ended.');
    }
    if (home.crisis?.planId === plan.id) home.crisis = null;
    reconcileLabor(home);
    syncResourceTotals(state);
  }

  start(plan, home) {
    const state = this.world.state;
    if (plan.kind === 'raid') {
      const source = state.factions?.find(faction => faction.id === plan.sourceFactionId);
      if (source && source.stance !== 'hostile') { this.finish(plan, home, true); return; }
    } else if (plan.kind === 'drought' && plan.mitigation.rain) {
      this.finish(plan, home, true);
      return;
    }
    plan.stage = 'active';
    plan.previousWeather = home.weather ?? state.weather;
    home.crisis = { kind: plan.kind, resolveAt: plan.endAt, previousWeather: plan.previousWeather,
      planId: plan.id, sourceFactionId: plan.sourceFactionId, sourceNameKey: plan.sourceNameKey };
    if (plan.kind === 'drought') {
      home.weather = 'drought';
      home.droughtFactor = plan.harvestFactor;
    }
    if (plan.kind === 'raid') this.battle?.start(plan);
    this.record(plan, plan.kind, `forecast.event.active_${plan.kind}`, {},
      plan.kind === 'raid' ? `The warned raiders have arrived. Defenders have until tick ${plan.endAt}.`
        : `The warned drought has begun and will end at tick ${plan.endAt}.`);
  }

  update() {
    const state = this.world.state;
    if (state.time <= state.forecastSimulation.lastTick) return;
    state.forecastSimulation.lastTick = state.time;
    const home = state.villages.find(village => village.id === 'home');
    if (!home || home.population <= 0) return;
    this.battle?.update();
    for (const plan of state.eventQueue) {
      if (plan.stage === 'forecast' && state.time >= plan.startAt) this.start(plan, home);
      if (plan.stage === 'active' && DISASTERS.includes(plan.kind)) updateDisaster(this.world, plan);
      if (plan.stage === 'active' && plan.kind === 'raid') this.battle?.update();
      const battleEnded = plan.kind === 'raid' && this.battle && state.combat?.planId === plan.id
        && state.combat.stage === 'resolved';
      if (plan.stage === 'active' && (state.time >= plan.endAt || plan.extinguished || battleEnded || (plan.kind === 'drought' && home.weather === 'rain'))) {
        this.finish(plan, home);
      }
    }
    this.fillQueue();
  }
}
