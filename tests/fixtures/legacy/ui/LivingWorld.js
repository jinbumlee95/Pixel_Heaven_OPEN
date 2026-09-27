import { GOODS, tradeWithCaravan, hunt, protectHerd } from '../../../../src/game/LivingWorld.js';
import { setStoryProfile, STORY_PROFILES } from '../../../../src/game/Story.js';
import { respondCounteroffer } from '../../../../src/game/Diplomacy.js';

export class LivingPanel {
  constructor(host,game) {
    this.host=host;this.game=game;this.labels=[];this.buttons=[];
    const el=(tag,key)=>{const node=document.createElement(tag);if(key)this.labels.push([node,key]);host.append(node);return node;};
    el('h3','life.title');this.summary=el('p');this.stock=el('p');this.status=el('p');this.status.setAttribute('role','status');
    const button=(key,act)=>{const b=el('button',key);b.type='button';b.addEventListener('click',()=>{const r=act();this.status.textContent=r?.ok===false?game.i18n.formatMessage(r):'';this.update();});this.buttons.push(b);return b;};
    this.tradeButtons=new Map();
    for(const id of Object.keys(GOODS))this.tradeButtons.set(id,button(`life.buy.${id}`,()=>tradeWithCaravan(game.world,id)));
    button('life.hunt',()=>hunt(game.world));button('life.protect',()=>protectHerd(game.world));
    el('h3','diplomacy.title');this.faction=el('select');this.faction.setAttribute('aria-label','Faction');
    for(const f of game.world.state.factions){const option=document.createElement('option');option.value=f.id;this.faction.append(option);}
    button('diplomacy.alliance',()=>game.chat.prepareResponse('home',game.i18n.t('prompt.proposal.alliance',{faction:this.faction.value})));
    button('diplomacy.truce',()=>game.chat.prepareResponse('home',game.i18n.t('prompt.proposal.truce',{faction:this.faction.value})));
    this.proposals=el('p');
    this.counteroffers=el('div');
    el('h3','story.title');this.profile=el('select');this.profile.setAttribute('aria-label','Storyteller');
    for(const id of Object.keys(STORY_PROFILES)){const option=document.createElement('option');option.value=id;this.profile.append(option);}
    this.profile.addEventListener('change',()=>{setStoryProfile(game.world,this.profile.value);this.update();});
    this.personality=el('select');this.personality.setAttribute('aria-label','Priest personality');
    for(const id of ['careful','hopeful']){const option=document.createElement('option');option.value=id;this.personality.append(option);}
    this.personality.addEventListener('change',()=>{game.world.state.story.personality=this.personality.value;this.update();});
    this.speed=el('select');this.speed.setAttribute('aria-label','Time speed');
    for(const n of [0,1,4,12]){const option=document.createElement('option');option.value=String(n);option.textContent=`×${n}`;this.speed.append(option);}
    this.speed.value='1';this.speed.addEventListener('change',()=>{game.speed=Number(this.speed.value);});
    el('p','story.help');this.memories=el('ol');this.update();
  }
  update() {
    const {world,i18n}=this.game, state=world.state, life=state.life;if(!life)return;
    const live=this.host.ownerDocument.querySelector('.live-label');if(live)live.textContent=this.game.speed===0?i18n.t('map.paused'):i18n.t('map.live')+(this.game.speed>1?` ×${this.game.speed}`:'');
    for(const [node,key]of this.labels)node.textContent=i18n.t(key);
    const visit=life.caravan;
    this.summary.textContent=i18n.t('life.summary',{sheep:life.sheep,deer:life.deer,hunger:life.hunger})+' · '+i18n.t(`life.visit.${visit?.stage??'absent'}`)
      +(visit?' · '+i18n.duration(Math.max(0,(visit.stage==='forecast'?visit.arriveAt:visit.departAt)-state.time)):'');
    if(life.wolves)this.summary.textContent+=' · '+i18n.t('life.wolves_forecast',{time:{gameTime:life.wolves.startAt}});
    this.stock.textContent=visit?Object.entries(visit.stock).map(([id,n])=>`${i18n.t(id==='sheep'?'life.sheep':`resource.${id}`)} ${n}`).join(' / '):'';
    for(const [id,button]of this.tradeButtons)button.disabled=visit?.stage!=='visiting'||visit.stock[id]<GOODS[id].quantity;
    for(let i=0;i<this.faction.options.length;i++){const f=state.factions[i];this.faction.options[i].textContent=i18n.t(f.nameKey)+' · '+i18n.t(`faction.stance.${f.stance}`);}
    this.proposals.textContent=state.diplomacy.proposals.slice(-4).map(p=>`${i18n.t(`diplomacy.${p.kind}`)} · ${i18n.t(`life.proposal.${p.status}`)}`).join(' / ');
    const offers=state.diplomacy.proposals.filter(p=>p.status==='counteroffer');
    const offerSig=i18n.locale+offers.map(p=>p.id).join();
    if(offerSig!==this.offerSig){this.offerSig=offerSig;this.counteroffers.replaceChildren();for(const offer of offers){
      const row=document.createElement('p');row.textContent=i18n.t('diplomacy.counteroffer',{costs:{resourceBasket:offer.extraCost}})+' ';
      for(const accept of [true,false]){const b=document.createElement('button');b.textContent=i18n.t(accept?'diplomacy.accept':'diplomacy.decline');b.addEventListener('click',()=>{const r=respondCounteroffer(world,offer.id,accept,e=>this.game.worldDecisions.record(e));this.status.textContent=r.ok?'':i18n.formatMessage(r);this.update();});row.append(b);}this.counteroffers.append(row);
    }}
    for(const option of this.profile.options)option.textContent=i18n.t(`story.${option.value}`);
    for(const option of this.personality.options)option.textContent=i18n.t(`story.${option.value}`);
    this.profile.value=state.story.profile;this.personality.value=state.story.personality;
    this.faction.setAttribute('aria-label',i18n.t('diplomacy.title'));this.profile.setAttribute('aria-label',i18n.t('story.title'));
    this.personality.setAttribute('aria-label',i18n.t('story.personality'));this.speed.setAttribute('aria-label',i18n.t('story.speed'));
    const sig=`${i18n.locale}:${state.story.nextSequence}`;
    if(sig!==this.signature){this.signature=sig;this.memories.replaceChildren();for(const event of [...state.story.memories].sort((a,b)=>b.time-a.time||b.memoryId-a.memoryId).slice(0,8)){
      const li=document.createElement('li');li.textContent=`${i18n.gameTime(event.time)} · ${event.messageId?`#${event.messageId} · `:''}${i18n.formatMessage(event)}`;this.memories.append(li);}}
  }
}
