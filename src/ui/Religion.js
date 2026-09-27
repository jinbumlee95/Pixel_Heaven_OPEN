import { religionSections, prayerLine } from './ReligionSummary.js';
export class ReligionPanel {
  constructor(host,i18n) {
    this.i18n=i18n;this.host=document.createElement('section');this.host.className='prayer-panel';host.append(this.host);
    this.details=document.createElement('section');this.details.id='religion-details';this.details.className='panel';this.details.hidden=true;
    document.querySelector('.map-stage').append(this.details);
  }
  show(visible){this.details.hidden=!visible;}
  update(state) {
    const r=state.religion;this.host.hidden=!r;if(!r)return;
    const t=(k,p)=>this.i18n.t('religion.'+k,p),prayers=r.prayers.filter(p=>p.status==='open');
    const recent=r.history.findLast(e=>e.action==='celebrated'||e.action==='offered');
    const compact=[[t('title'),...(prayers.length?prayers.map(p=>prayerLine(state,p,this.i18n)):[t('none')])],
      [t('active'),r.commandments.map(id=>t('rule.'+id)).join('\n')||t('none')],
      ...(recent?[[t('recent'),this.i18n.formatMessage(recent)]]:[])];
    const hint=state.faith.points>=state.faith.capacity?t('praiseHint'):t('panelHelp');
    const compactSignature=JSON.stringify(compact)+hint;
    if(this.compactSignature!==compactSignature){
      const scroll=this.host.scrollTop;this.compactSignature=compactSignature;this.host.replaceChildren();
      for(const [title,...lines] of compact){const heading=document.createElement('h4');heading.textContent=title;this.host.append(heading);
        for(const line of lines){const p=document.createElement('p');p.textContent=line;this.host.append(p);}}
      const p=document.createElement('p');p.textContent=hint;this.host.append(p);this.host.scrollTop=scroll;
    }
    if(this.details.hidden)return;
    const sections=religionSections(state,this.i18n),signature=JSON.stringify(sections)+this.i18n.locale;
    if(signature===this.signature)return;this.signature=signature;
    const scroll=this.details.scrollTop;this.details.replaceChildren();
    const closeHint=document.createElement('p');closeHint.textContent=t('closeHelp');this.details.append(closeHint);
    for(const [title,lines] of sections) {
      const section=document.createElement('section'),heading=document.createElement('h3');heading.textContent=title;section.append(heading);
      for(const line of lines){const p=document.createElement('p');p.textContent=line;section.append(p);}this.details.append(section);
    }
    this.details.scrollTop=scroll;
  }
}
