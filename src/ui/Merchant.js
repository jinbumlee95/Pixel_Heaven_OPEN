import { tradePrice, tradeValues } from '../game/Trading.js';
export function tradeSummary(world,visit,i18n){
  const t=(k,p)=>i18n.t(k,p);if(!visit)return t('trade.empty');
  const source=world.state.factions.find(f=>f.id===visit.source);
  const lines=[`${t('trade.title')} · ${source?t(source.nameKey):visit.source} · ${visit.id}`,
    visit.closedAt!==undefined?t('trade.closed'):t('trade.depart',{time:i18n.duration(Math.max(0,visit.departAt-world.state.time))})];
  if(visit.policy)lines.push(t(visit.policy.enabled?'trade.auto':'trade.stopped',{budget:visit.policy.budget,spent:visit.policy.spent}),
    t('trade.reserves',{items:Object.entries(visit.policy.reserves).map(([id,n])=>`${t(`resource.${id}`)} ${n}`).join(' · ')}),
    t('trade.forbidden',{items:visit.policy.forbidden.map(id=>t(`resource.${id}`)).join(' · ')}));
  lines.push(t('trade.specialty',{item:t(`resource.${visit.specialty??'cloth'}`)}),visit.policy?.enabled&&visit.autoCount<3?t('trade.next',{time:i18n.duration(Math.max(0,(visit.nextTradeAt??0)-world.state.time))}):t('trade.noNext'),t('trade.available',{items:[...Object.keys(tradeValues(world.content.resources)).filter(id=>id!=='sheep'),'silver'].map(id=>`${t(`resource.${id}`)} ${Math.floor(world.getVillage('home')[id]??0)}`).join(' · ')}));
  lines.push(t('trade.cash',{amount:Math.round((visit.cash??0)*100)/100}));
  for(const entry of (visit.ledger??[]).slice(-3))lines.push(`${t(entry.automatic?'trade.automatic':'trade.manual')} · ${entry.lines.map(l=>`${t(l.resource==='sheep'?'life.sheep':`resource.${l.resource}`)} ${l.side==='buy'?'+':'−'}${l.amount}`).join(' · ')} · ${t('resource.silver')} ${entry.silver>=0?'+':''}${entry.silver}`);
  for(const [id,n]of Object.entries(visit.stock))if(n>0&&Object.hasOwn(tradeValues(world.content.resources),id))lines.push(`${t(id==='sheep'?'life.sheep':`resource.${id}`)} ×${n} · ${t('trade.prices',{buy:tradePrice(id,'buy',visit,world.content.resources),sell:id==='sheep'?'—':tradePrice(id,'sell',visit,world.content.resources)})}`);
  return lines.join('\n');
}
export class MerchantPanel{
  constructor(host,world,i18n){this.host=host;this.world=world;this.i18n=i18n;if(!host)return;
    this.title=document.createElement('h2');this.scene=document.createElement('div');this.scene.className='merchant-scene';
    for(const [src,cls]of [['assets/characters/merchant.png','merchant-pawn'],['assets/characters/pack_donkey.png','merchant-donkey']]){const img=document.createElement('img');img.src=src;img.alt='';img.className=cls;this.scene.append(img);}
    this.text=document.createElement('p');this.text.className='merchant-details';this.hint=document.createElement('p');this.hint.className='muted';host.append(this.title,this.scene,this.text,this.hint);this.update();}
  update(){if(!this.host)return;const state=this.world.state;const visit=state.life?.caravan?.stage==='visiting'?state.life.caravan:state.life?.lastTrade;
    this.host.hidden=!visit||(visit.closedAt!==undefined&&state.time>=visit.closedAt+12);if(this.host.hidden)return;
    this.title.textContent=this.i18n.t('trade.title');const summary=[this.i18n.t(this.world.state.factions.find(f=>f.id===visit.source)?.nameKey??'trade.title'), this.i18n.t('trade.depart',{time:this.i18n.duration(Math.max(0,visit.departAt-state.time))}), this.i18n.t('trade.specialty',{item:this.i18n.t(`resource.${visit.specialty??'cloth'}`)})].join(' · ');if(this.text.textContent!==summary)this.text.textContent=summary;this.hint.textContent=this.i18n.t('production.merchantHint');}
}
