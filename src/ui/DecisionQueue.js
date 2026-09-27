import { decisionQueue } from '../game/DecisionQueue.js';

export class DecisionQueuePanel {
  constructor(host,game){this.host=host;this.game=game;this.signature='';}
  update(){
    const {world,i18n}=this.game,s=world.state,cards=decisionQueue(s),t=(key,p)=>i18n.t(key,p);
    const sig=JSON.stringify([i18n.locale,cards,Math.floor(s.time)]);if(sig===this.signature)return;this.signature=sig;
    const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
    const heading=node('h3',t('cw.title'));const hint=node('p',t('cw.queueHint'));hint.className='queue-hint';
    const list=node('div','');list.className='decision-cards';
    for(const c of cards){
      const card=node('article','');card.className='decision-card';card.dataset.kind=c.kind;card.dataset.stage=c.stage;
      const prepared=c.object.mitigation?.defense||c.object.mitigation?.rain||c.object.mitigation?.protected||c.object.protected;
      const title=t(['raid','drought','fire','flood','cold'].includes(c.kind)?`forecast.kind.${c.kind}`:`cw.${c.kind}`);
      card.append(node('h4',title),node('small',c.id),node('p',t(`cw.stage.${c.stage}`)+' · '+i18n.duration(Math.max(0,c.at-s.time))),node('p',t(`cw.${prepared?'prepared':c.object.playerDecision??'undecided'}`)));
      if(c.kind==='raid')card.append(node('p',t('forecast.detail.raid',{faction:{factionId:c.object.sourceFactionId,nameKey:c.object.sourceNameKey},food:c.object.damage.food,people:c.object.damage.people})));
      if(c.kind==='caravan')card.append(node('p',Object.entries(c.object.stock).map(([id,n])=>`${t(id==='sheep'?'life.sheep':`resource.${id}`)} ${n}`).join(' · ')));
      if(c.kind==='proposal')card.append(node('p',t(s.factions.find(f=>f.id===c.object.factionId)?.nameKey)+' · '+t(`diplomacy.${c.object.kind}`)));
      if(c.stage==='counteroffer')card.append(node('p',t('diplomacy.counteroffer',{costs:{resourceBasket:c.object.extraCost}})));
      list.append(card);
    }
    if(!cards.length)list.append(node('p',t('cw.empty')));
    this.host.replaceChildren(heading,hint,list);
  }
}
