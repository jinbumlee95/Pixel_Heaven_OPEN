import { RECIPES, WORKSHOPS } from '../content/production.js';
import { productionReason, recipesFor } from './Production.js';

export const facilityNames = { 대장간:'smith',smith:'smith',鍛冶場:'smith',창고:'warehouse',warehouse:'warehouse',倉庫:'warehouse',제재소:'sawmill',sawmill:'sawmill',製材所:'sawmill',조제소:'apothecary',apothecary:'apothecary',調剤所:'apothecary',주방:'kitchen',kitchen:'kitchen',厨房:'kitchen', 제련소: 'smelter', smelter: 'smelter', 製錬所: 'smelter', 직조소: 'weaver', weaver: 'weaver', 織物工房: 'weaver' };
const recipeNames = { 판재:'planks',planks:'planks',板材:'planks',공구:'tools',tools:'tools',工具:'tools',약품:'medicine',medicine:'medicine',薬品:'medicine',보존식:'rations',rations:'rations',保存食:'rations',공예품:'crafts',crafts:'crafts',工芸品:'crafts', 제련: 'smelt', smelt: 'smelt', 製錬: 'smelt', 직조: 'weave', weave: 'weave', 織布: 'weave' };
export function parseProductionCommand(s) {
  s = s.replace(/[.!?。！？]+$/u, '').trim();
  if (/^(?:생산(?: 현황| 상태| 알려줘| 보여줘)?|작업장 현황|왜 (?:생산|제작)이? 멈췄어|production(?: status)?|why is production stopped|生産状況|生産が止まった理由)$/u.test(s)) return { type: 'meta', name: 'production' };
  if (/^(?:제작법|생산 비용|레시피|recipes|production costs|レシピ|生産費用)$/u.test(s)) return { type: 'meta', name: 'recipes' };
  if(/^(공예품으로 축제 열어|celebrate with crafts|工芸品で祭り)$/u.test(s))return {type:'order',name:'useGoods',resource:'crafts'};
  if(/^(약품으로 영웅 치료해|heal hero with medicine|薬品で勇者を治療)$/u.test(s))return {type:'order',name:'useGoods',resource:'medicine'};
  let custom=s.match(/^(?:생산|produce|生産) ([a-z][a-z0-9_:-]+) (\d+)$/u);
  if(custom)return {type:'order',name:'produce',recipeId:custom[1],count:Number(custom[2])};
  custom=s.match(/^(?:생산취소|cancel production|生産取消) ([a-z][a-z0-9_:-]+)$/u);
  if(custom)return {type:'order',name:'cancelProduction',recipeId:custom[1]};
  let m = s.match(/^(제련소|직조소|대장간|창고|제재소|조제소|주방)(?:를)?\s*(?:지어|건설)(?:줘|해|해줘)?$/u)
    ?? s.match(/^build (?:a )?(smelter|weaver|smith|warehouse|sawmill|apothecary|kitchen)$/u) ?? s.match(/^(製錬所|織物工房|鍛冶場|倉庫|製材所|調剤所|厨房)を(?:建てて|建設)$/u);
  if (m) return { type: 'order', name: 'workshop', facility: facilityNames[m[1]] };
  m = s.match(/^(제련|직조|판재|공구|약품|보존식|공예품|smelt|weave|planks|tools|medicine|rations|crafts|製錬|織布|板材|工具|薬品|保存食|工芸品)\s*(\d+)(?:회| batches|回)?(?: 해줘)?$/u);
  if (m) return { type: 'order', name: 'produce', recipeId: recipeNames[m[1]], count: Number(m[2]) };
  m = s.match(/^(제련|직조)\s*취소(?:해줘)?$/u) ?? s.match(/^cancel (smelt|weave)$/u) ?? s.match(/^(製錬|織布)取消$/u);
  if (m) return { type: 'order', name: 'cancelProduction', recipeId: recipeNames[m[1]] };
  // Negations/conditions and partially recognized requests must never fall
  // through to a different divine action. Ask for the intended batch instead.
  if (/제련|직조|製錬|織布|織物工房|\b(?:smelt|smelter|weaver|smith|warehouse|sawmill|apothecary|kitchen|weave)\b/u.test(s)) return { type: 'invalid' };
  return null;
}
export function validProductionOrder(o) {
  if (o.name === 'workshop') return Object.hasOwn(WORKSHOPS, o.facility);
  if (o.name === 'cancelProduction') return (typeof o.recipeId==='string' && /^[a-z][a-z0-9_:-]{0,100}$/.test(o.recipeId));
  return o.name === 'produce' && (typeof o.recipeId==='string' && /^[a-z][a-z0-9_:-]{0,100}$/.test(o.recipeId)) && Number.isSafeInteger(o.count) && o.count >= 1 && o.count <= 20;
}
export function productionSummary(world, i18n, costs = false) {
  const t = (k, p) => i18n.t(k, p), basket = items => Object.entries(items).map(([id, n]) => `${t(`resource.${id}`)} ${n}`).join(' + ');
  if (costs) return Object.entries(WORKSHOPS).map(([id, w]) => `${t(`work.type.${id}`)}: ${basket(w.cost)} · ${t('production.work', { seconds: w.workSeconds })}`).join('\n')
    + '\n' + Object.values(recipesFor(world)).map(r => `${t(`production.recipe.${r.id}`)}: ${basket(r.inputs)} → ${r.equipment?t('gear.'+r.equipment.definition)+' ['+t('gear.grade.'+r.equipment.grade)+']':basket(r.outputs)} · ${t('work.type.' + r.buildingTag)} · ${t('production.work', { seconds: r.workSeconds })}`).join('\n') + '\n' + t('production.help');
  const p = world.state.production, home = world.getVillage('home');
  const intro = t('production.intro', { ore: Math.floor(home.iron_ore ?? 0), fiber: Math.floor(home.fiber ?? 0), workers: home.labor?.crafting ?? 0 });
  const all = p?.jobs ?? [], active = all.filter(j => j.status === 'working');
  const jobs = [...active, ...all.filter(j => j.status !== 'working').slice(-(8 - active.length))].map(j => {
    const reason = j.status === 'working' ? productionReason(world, j) : j.status;
    return t('production.row', { recipe: t(`production.recipe.${j.recipeId}`), completed: j.completed, count: j.count, state: t(`production.reason.${reason}`),
      reserved: basket(j.reserved), seconds: Math.ceil(((j.recipe??recipesFor(world)[j.recipeId]).workSeconds - j.progress) / Math.max(1, home.labor?.crafting ?? 0)) });
  });
  return [intro, ...(jobs.length ? jobs : [t('production.empty')]), t('production.help')].join('\n');
}
