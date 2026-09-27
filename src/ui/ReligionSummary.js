import { COMMANDMENTS, RITES } from '../content/religion.js';
import { commandmentSlots, ritePreview, needValue } from '../game/Religion.js';
export function prayerLine(state,p,i18n) {
  const t=(k,v)=>i18n.t('religion.'+k,v);
  return t(p.acceptedAt===undefined?'unaccepted':'inProgress')+' · '+t('prayer.'+p.kind)+' '+Math.floor(needValue(state,p.kind))+'/'+Math.ceil(p.target)+' · '+i18n.duration(Math.max(0,p.expiresAt-state.time));
}
export function religionSections(state,i18n) {
  const r=state.religion,t=(k,p)=>i18n.t('religion.'+k,p);if(!r)return [];
  const h=state.villages.find(v=>v.id==='home'),level=Math.min(3,(r.treeLevel??0)+1);
  const prayers=r.prayers.filter(p=>p.status==='open');
  return [
    [t('faithLife'),[t('summary',{points:Math.floor(state.faith.points),capacity:state.faith.capacity,slots:commandmentSlots(state),answered:r.answered}),
      t('worship',{amount:r.worship??0,level:r.treeLevel??0}),t('praiseHelp'),
      r.treeLevel>=3?t('treeComplete'):t('offeringHelp',{worship:20*level,wood:20*level,stone:10*level,crafts:2*level})]],
    [t('title'),prayers.length?prayers.flatMap(p=>[prayerLine(state,p,i18n),t('hint.'+p.kind,p.kind==='temple'?{silver:Math.floor(h.silver)}:{})]):[t('none')]],
    [t('active'),r.commandments.length?r.commandments.map(id=>t('rule.'+id)):[t('none')]],
    [t('rituals'),Object.entries(RITES).map(([id,d])=>t('rite.'+id)+' · '+Object.entries(d.cost).map(([k,v])=>i18n.t('resource.'+k)+' '+v).join(', ')+' · '+i18n.t('faith.title')+' '+d.faith+' · '+t('quality.'+ritePreview(state,id).quality)+' · '+i18n.duration(Math.max(0,(r.cooldowns[id]??0)-state.time)))],
    [t('recent'),r.history.slice(-3).map(e=>i18n.formatMessage(e))],
    [t('choices'),Object.keys(COMMANDMENTS).map(id=>t('rule.'+id)).concat(t('help'))],
  ];
}
export function religionSummary(state,i18n) {
  return religionSections(state,i18n).map(([title,lines])=>title+'\n'+lines.join('\n')).join('\n\n');
}
