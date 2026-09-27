export function dungeonSummary(state,i18n) {
  const d=state.hero?.dungeon;if(!d)return '';
  const summary=i18n.t('dungeon.summary',{light:d.light,policy:i18n.t('dungeon.'+d.policy),elite:d.eliteWins,boss:d.bossWins});
  return summary+(d.route?'\n'+i18n.t('dungeon.route',{options:d.route.options.map(k=>i18n.t('dungeon.'+k)).join(' / '),choice:i18n.t('dungeon.'+d.route.choice)}):'');
}
