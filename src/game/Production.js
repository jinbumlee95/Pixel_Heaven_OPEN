import { prayerValues, creditPrayer } from './Religion.js';
import { RESOURCE_DEFINITIONS } from '../content/resources.js';
import { grantEquipment, storeCapacity } from './Equipment.js';
import { RECIPES, MAX_PRODUCTION_ORDERS, MAX_PRODUCTION_HISTORY } from '../content/production.js';
import { canAffordResources, spendResources, resourceAmount, stockLimit } from '../state/economy.js';
import { syncResourceTotals } from '../state/worldState.js';

const fail = (code, params = {}) => ({ ok: false, code, messageKey: `production.${code}`, messageParams: params });
const basket = (items, count) => Object.fromEntries(Object.entries(items).map(([id, n]) => [id, n * count]));
export const recipesFor = world => world.content.recipes ?? RECIPES;
const active = job => job.status === 'working';
export function initializeProduction(world) {
  const home = world.getVillage('home');
  if (!home?.labor) return;
  home.productionVersion = 1;
  for(const id of Object.keys(world.content.resources ?? RESOURCE_DEFINITIONS))home[id]??=0;
  home.modResources=Object.keys(world.content.resources??{}).filter(id=>!Object.hasOwn(RESOURCE_DEFINITIONS,id));
  home.resourceLimits=Object.fromEntries(Object.entries(world.content.resources??RESOURCE_DEFINITIONS).map(([id,r])=>[id,r.stackLimit]));
  home.oreDeposit ??= 240;
  world.state.production ??= { sequence: 0, lastTick: world.state.time, jobs: [] };
}
export function workshopFor(world, recipe) {
  return [...world.state.buildings.values()].find(b => b.villageId === 'home' && b.type === recipe.buildingTag && (b.damage ?? 0) < 100);
}
export function productionReason(world, job) {
  const recipe = (job.recipe ?? recipesFor(world)[job.recipeId]), home = world.getVillage('home');
  if (!workshopFor(world, recipe)) return 'facility';
  if(recipe.equipment&&world.state.hero?.equipment.items.filter(i=>i.location==='store').length>=storeCapacity(world))return 'capacity';
  if (!(home.labor?.crafting > 0)) return 'workers';
  if (Object.entries(recipe.outputs).some(([id, n]) => resourceAmount(home, id) + n > stockLimit(home,id))) return 'capacity';
  return 'running';
}
export function queueProduction(world, recipeId, count) {
  const p = world.state.production, home = world.getVillage('home'), recipe = recipesFor(world)[recipeId];
  if (!p || !Object.hasOwn(recipesFor(world), recipeId) || !Number.isSafeInteger(count) || count < 1 || count > 20) return fail('invalid');
  if (p.jobs.filter(active).length >= MAX_PRODUCTION_ORDERS) return fail('queue_full');
  if (!workshopFor(world, recipe)) return fail('facility', { facility: { messageKey: `work.type.${recipe.buildingTag}` } });
  if((recipe.unlock??0)>(world.state.hero?.equipment?.crafted??0))return fail('unlock');
  const reserved = basket(recipe.inputs, count);
  if (!canAffordResources(home, reserved)) return fail('materials');
  spendResources(home, reserved);
  const job = { id: `production-${++p.sequence}`, recipeId, recipe:structuredClone(recipe), count, completed: 0, progress: 0, status: 'working', reserved, startedAt: world.state.time };
  // Retain all active orders; trim history only.
  p.jobs = [...p.jobs.filter(active), ...p.jobs.filter(j => !active(j)).slice(-(MAX_PRODUCTION_HISTORY - MAX_PRODUCTION_ORDERS - 1)), job];
  syncResourceTotals(world.state);
  return { ok: true, messageKey: 'production.queued', messageParams: { job:job.id, recipe: { messageKey: `production.recipe.${recipeId}` }, count } };
}
export function cancelProduction(world, recipeId) {
  const jobs = world.state.production?.jobs.filter(j => active(j) && j.recipeId === recipeId) ?? [];
  if (jobs.length !== 1) return fail(jobs.length ? 'ambiguous' : 'missing');
  const job = jobs[0], home = world.getVillage('home');
  // Do not silently throw away refunds if trade/gathering filled the stores.
  if (Object.entries(job.reserved).some(([id, n]) => resourceAmount(home, id) + n > stockLimit(home,id))) return fail('capacity');
  for (const [id, n] of Object.entries(job.reserved)) home[id] = resourceAmount(home, id) + n;
  job.reserved = basket((job.recipe ?? recipesFor(world)[job.recipeId]).inputs, 0); job.status = 'cancelled';
  syncResourceTotals(world.state);
  return { ok: true, messageKey: 'production.cancelled', messageParams: {} };
}
export function updateProduction(world, onEvent = () => {}) {
  const p = world.state.production, home = world.getVillage('home');
  if (!p || p.lastTick >= world.state.time) return;
  p.lastTick = world.state.time;
  const jobs = p.jobs.filter(active), usable = jobs.filter(j => productionReason(world, j) === 'running');
  const workers = Math.min(4, home.labor?.crafting ?? 0) / Math.max(1, usable.length);
  for (const job of usable) {
    // Recheck capacity after each settlement in case multiple orders share output.
    if (productionReason(world, job) !== 'running') continue;
    const recipe = (job.recipe ?? recipesFor(world)[job.recipeId]), facility = workshopFor(world, recipe);
    const usingTools=home.tools>=0.1;
    job.progress = Math.min(recipe.workSeconds, job.progress + workers * (usingTools?1.25:1) * (1 - (facility.damage ?? 0) / 100));
    if (job.progress < recipe.workSeconds) continue;
    if(recipe.equipment){if(!grantEquipment(world,recipe.equipment.definition,recipe.equipment.grade,`${job.id}:${job.completed}`))continue;world.state.hero.equipment.crafted++;}
    const prayerBefore=prayerValues(world.state);
    for (const [id, n] of Object.entries(recipe.inputs)) job.reserved[id] -= n;
    for (const [id, n] of Object.entries(recipe.outputs)) home[id] = resourceAmount(home, id) + n;
    if(usingTools)home.tools=Math.max(0,home.tools-0.1);
    creditPrayer(world.state,job.messageId,prayerBefore);
    job.completed++; job.progress = 0;
    if (job.completed === job.count) {
      job.status = 'complete'; job.finishedAt = world.state.time;
      onEvent({ source: 'world', actor: 'home', action: 'production_complete', time: world.state.time,
        messageKey: 'production.complete', messageParams: { recipe: { messageKey: `production.recipe.${job.recipeId}` }, count: job.count } });
    }
  }
  syncResourceTotals(world.state);
}
// Imported saves cannot forge free output, outstanding inputs or unknown recipes.
export function validProduction(p, time, recipes=RECIPES) {
  if (!p || !Number.isSafeInteger(p.sequence) || p.sequence < 0 || !Number.isSafeInteger(p.lastTick) || p.lastTick < 0 || p.lastTick > time
      || !Array.isArray(p.jobs) || p.jobs.length > MAX_PRODUCTION_HISTORY || p.jobs.filter(active).length > MAX_PRODUCTION_ORDERS) return false;
  const ids = new Set();
  return p.jobs.every(j => {
    const r = j.recipe ?? recipes[j.recipeId], sequence = Number(j.id?.replace(/^production-/u, ''));
    if (!Object.hasOwn(recipes, j.recipeId) || !validRecipeSnapshot(r, recipes[j.recipeId]) || !/^production-\d+$/u.test(j.id) || ids.has(j.id) || !Number.isSafeInteger(sequence) || sequence < 1 || sequence > p.sequence
      || !['working', 'complete', 'cancelled'].includes(j.status) || !Number.isInteger(j.count) || j.count < 1 || j.count > 20
      || !Number.isInteger(j.completed) || j.completed < 0 || j.completed > j.count || !Number.isFinite(j.progress) || j.progress < 0 || j.progress > r.workSeconds
      || !Number.isSafeInteger(j.startedAt) || j.startedAt < 0 || j.startedAt > time || !j.reserved) return false;
    ids.add(j.id);
    if (j.status === 'complete' && j.completed !== j.count || active(j) && j.completed >= j.count) return false;
    const expected = basket(r.inputs, active(j) ? j.count - j.completed : 0);
    return Object.keys(j.reserved).length === Object.keys(expected).length && Object.entries(expected).every(([id, n]) => j.reserved[id] === n);
  });
}

export function validRecipeSnapshot(r, current) {
  return Boolean(r&&current)&&JSON.stringify(r)===JSON.stringify(current);
}

export function useProducedGoods(world,resource) {
  const home=world.getVillage('home'),hero=world.state.hero;
  if(resource==='crafts'){
    if(home.happiness>=100||!spendResources(home,{crafts:2}))return fail('materials');
    home.happiness=Math.min(100,home.happiness+12);home.devotionUntil=Math.max(home.devotionUntil??0,world.state.time+120);
  }else if(resource==='medicine'){
    if(!hero||!['home','recovering'].includes(hero.mode)||hero.hp>=hero.maxHp||!spendResources(home,{medicine:1}))return fail('materials');
    hero.hp=Math.min(hero.maxHp,hero.hp+16);
  }else return fail('invalid');
  syncResourceTotals(world.state);return {ok:true,messageKey:`production.used.${resource}`,messageParams:{}};
}
