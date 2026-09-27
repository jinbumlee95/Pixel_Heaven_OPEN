import { prayerValues, creditPrayer } from './Religion.js';
import { buildingCost, canAffordResources, spendResources, RESOURCE_TYPES, stockLimit } from '../state/economy.js';
import { syncResourceTotals } from '../state/worldState.js';
import { WORKSHOPS } from '../content/production.js';
import { initializeProduction, updateProduction } from './Production.js';

export const JOBS = Object.freeze(['farming', 'woodcutting', 'mining', 'crafting', 'building', 'defense', 'husbandry']);
export const STOCK_LIMIT = 1000;
const homeOf = world => world.getVillage('home');
const failure = code => ({ ok: false, code, messageKey: `work.failure.${code}`, messageParams: {} });
export function initializeWork(world) {
  const home = homeOf(world);
  if (!home || home.economyVersion !== 2) return;
  home.labor ??= { farming: Math.min(4, home.population), woodcutting: 1, mining: 1, crafting: 1, building: 1, defense: 0, husbandry: 0 };
  world.state.work ??= { sequence: 0, jobs: [], lastTick: world.state.time, ledger: [], previous: {} };
  reconcileLabor(home);
  initializeProduction(world);
}
export function reconcileLabor(home) {
  if (!home.labor) return;
  let available = home.population;
  for (const job of JOBS) { home.labor[job] = Math.min(available, Math.max(0, Math.floor(home.labor[job] ?? 0))); available -= home.labor[job]; }
}
export function assignLabor(world, role, amount) {
  const home = homeOf(world);
  if (!home?.labor || !JOBS.includes(role) || !Number.isInteger(amount) || amount < 0) return failure('invalid_labor');
  const others = JOBS.filter(job => job !== role).reduce((sum, job) => sum + home.labor[job], 0);
  if (others + amount > home.population) return failure('no_workers');
  home.labor[role] = amount;
  return { ok: true };
}
export function queueConstruction(world, action, { repairId } = {}) {
  const home = homeOf(world); const work = world.state.work;
  if (!home || !work || work.jobs.filter(job => job.status === 'working').length >= 4) return failure('queue_full');
  const type = { build_house: 'house', farm: 'farmland', build_temple: 'temple', build_smelter: 'smelter', build_weaver: 'weaver', ...Object.fromEntries(Object.keys(WORKSHOPS).map(id=>[`build_${id}`,id])) }[action.action];
  const repair = repairId ? world.state.buildings.get(repairId) ?? world.state.terrain.get(repairId) : null;
  if (repairId && (!repair || !(repair.damage > 0))) return failure('not_damaged');
  if (!type && !repair) return failure('invalid_job');
  if (work.jobs.some(job => job.status === 'working' && (repairId ? job.repairId === repairId : job.type === type && !job.repairId))) return failure('already_queued');
  const cost = repair ? { wood: Math.ceil(repair.damage / 10), stone: Math.ceil(repair.damage / 20) } : WORKSHOPS[type]?.cost ?? buildingCost(home, action.action);
  if (!canAffordResources(home, cost)) return failure('materials');
  const footprint = repair?.footprint ?? world.content.get(type)?.footprint;
  const position = repair?.position ?? world.findEmptyArea(home, footprint, action.parameters?.direction);
  if (!position) return failure('space');
  if (!spendResources(home, cost)) return failure('materials');
  const job = { id: `job-${++work.sequence}`, type: repair?.type ?? type, position: { ...position }, footprint: { ...footprint },
    action: action.action, repairId: repairId ?? null, status: 'working', progress: 0, required: repair ? repair.damage : WORKSHOPS[type]?.workSeconds ?? (type === 'temple' ? 90 : 30),
    cost: { ...cost }, startedAt: world.state.time };
  work.jobs.push(job); work.jobs = work.jobs.slice(-24); syncResourceTotals(world.state);
  const event = { source: 'world', action: 'construction_started', time: world.state.time, actor: 'home',
    messageKey: 'work.started', messageParams: { job: job.id, type: { messageKey: `work.type.${job.type}` } } };
  return { ok: true, event, messageKey: event.messageKey, messageParams: event.messageParams };
}
export function cancelConstruction(world, id) {
  const job = world.state.work?.jobs.find(job => job.id === id);
  if (!job || job.status !== 'working') return failure('invalid_job');
  const home = homeOf(world); const remaining = Math.max(0, 1 - job.progress / job.required);
  if(Object.entries(job.cost).some(([id,n])=>home[id]+Math.floor(n*remaining)>stockLimit(home,id)))return failure('materials');
  for (const [resource, amount] of Object.entries(job.cost)) home[resource] += Math.floor(amount * remaining);
  job.status = 'cancelled'; syncResourceTotals(world.state); return { ok: true };
}
export class WorkSystem {
  constructor(world, { onEvent = () => {} } = {}) { this.world = world; this.onEvent = onEvent; initializeWork(world); }
  update() {
    const state = this.world.state, home = homeOf(this.world), work = state.work;
    if (!work || work.lastTick >= state.time) return;
    work.lastTick = state.time; reconcileLabor(home);
    if (home.population <= 0) return;
    state.climate ??= { wet:0,dry:0 };
    state.climate.wet=home.weather==='rain'?Math.min(360,state.climate.wet+1):Math.max(0,state.climate.wet-1);
    state.climate.dry=['clear','drought',undefined].includes(home.weather)?Math.min(720,state.climate.dry+1):Math.max(0,state.climate.dry-2);
    home.forestCapacity = [...state.terrain.values()].filter(o=>['forest','pine'].includes(o.type)
      && Math.hypot(o.position.x-home.anchor.x,o.position.y-home.anchor.y)<=home.settlementRadius).reduce((sum,o)=>sum+1-(o.damage??0)/100,0);
    home.templeCondition = [...state.buildings.values()].filter(o=>o.type==='temple').reduce((sum,o)=>sum+1-(o.damage??0)/100,0);
    const fields = [...state.terrain.values()].filter(o=>o.type==='farmland');
    const houses = [...state.buildings.values()].filter(o=>o.type==='house');
    home.harvestCondition = fields.length ? fields.reduce((sum,o)=>sum+1-(o.damage??0)/100,0)/fields.length : 1;
    home.housingCondition = houses.length ? houses.reduce((sum,o)=>sum+1-(o.damage??0)/200,0)/houses.length : 1;
    for (const plan of state.eventQueue ?? []) if (plan.stage === 'active' && ['cold','flood'].includes(plan.kind)) home.harvestCondition *= plan.mitigation.protected ? 0.9 : 0.5;
    const jobs = work.jobs.filter(job => job.status === 'working');
    const rate = home.labor.building / Math.max(1, jobs.length);
    for (const job of jobs) {
      // Flooded work sites stop until drainage/protection or the announced end.
      if((state.eventQueue??[]).some(p=>p.kind==='flood'&&p.stage==='active'&&!p.mitigation.protected&&p.exposure?.some(e=>e.id===job.repairId||Math.hypot(e.position.x-job.position.x,e.position.y-job.position.y)<3)))continue;
      job.progress = Math.min(job.required, job.progress + rate);
      if (job.progress < job.required) continue;
      job.status = 'completing';
      const prayerBefore=prayerValues(state);
      let completed;
      if (job.repairId) {
        completed = state.buildings.get(job.repairId) ?? state.terrain.get(job.repairId);
        if (completed) completed.damage = 0;
      } else completed = job.type === 'farmland' ? this.world.placeTerrain(job.type, 'home', job.position) : this.world.placeBuilding(job.type, 'home', job.position);
      job.status = completed ? 'complete' : 'working';
      if(completed)creditPrayer(state,job.messageId,prayerBefore);
      if (completed) { job.finishedAt = state.time; this.onEvent({ source: 'world', action: 'construction_complete', actor: 'home', time: state.time,
        ...(job.messageId ? {messageId: job.messageId} : {}), messageKey: 'work.complete', messageParams: { job: job.id, type: { messageKey: `work.type.${job.type}` } } }); }
    }
    home.warehouseBonus=Math.min(4,[...state.buildings.values()].filter(b=>b.type==='warehouse'&&(b.damage??0)<100).length)*500;
    updateProduction(this.world, this.onEvent);
    // Bounded inventory ledger makes shortages and labor opportunity costs visible.
    if (state.time % 10 === 0) {
      const changes = Object.fromEntries(RESOURCE_TYPES.map(id => [id, Math.round((home[id] - (work.previous[id] ?? home[id])) * 100) / 100]));
      work.ledger.push({ time: state.time, changes }); work.ledger = work.ledger.slice(-24);
      work.previous = Object.fromEntries(RESOURCE_TYPES.map(id => [id, home[id]]));
    }
    // Existing overflow after warehouse damage is retained; production waits.
    syncResourceTotals(state);
  }
}
