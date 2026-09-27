import { EQUIPMENT } from '../content/equipment.js';
import { equipmentSize, deriveHeroStats } from '../game/Equipment.js';

export class EquipmentPanel {
  constructor(host,i18n){this.host=host;this.i18n=i18n;this.key='';}
  update(state){
    const e=state.hero?.equipment;this.host.hidden=!e?.visible;if(this.host.hidden)return;
    const key=JSON.stringify([e,this.i18n.locale,state.hero.level]);if(key===this.key)return;this.key=key;
    const t=(k,p)=>this.i18n.t(k,p),make=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
    const title=make('h2','',t('gear.title')),stats=make('p','',t('gear.stats',deriveHeroStats(state.hero)));
    const grid=make('div','equipment-grid');grid.style.setProperty('--cols',e.width);grid.style.setProperty('--rows',e.height);grid.setAttribute('role','group');
    grid.setAttribute('aria-label',t('gear.title')+` ${e.width} × ${e.height}`);
    for(let y=0;y<e.height;y++)for(let x=0;x<e.width;x++){const cell=make('span','equipment-cell',`${String.fromCharCode(65+x)}${y+1}`);cell.style.gridColumn=x+1;cell.style.gridRow=y+1;grid.append(cell);}
    for(const i of e.items.filter(i=>i.location==='grid')){const size=equipmentSize(i),label=`${i.id} ${t('gear.'+i.definition)} · ${t('gear.grade.'+i.grade)} · ${i.durability}% · ${t(i.active?'gear.active':'gear.cargo')}${i.locked?' 🔒':''}`;
      const tile=make('div',`equipment-tile grade-${i.grade}${i.active?'':' inactive'}`,`${i.id}\n${t('gear.'+i.definition)}\n${t('gear.grade.'+i.grade)}${i.locked?' 🔒':''}`);tile.title=label+' · '+t('gear.effect.'+(EQUIPMENT[i.definition].effect??'none'));tile.setAttribute('aria-label',tile.title+' '+String.fromCharCode(65+i.x)+(i.y+1));const icon=make('img','equipment-icon');icon.src=EQUIPMENT[i.definition].icon;icon.alt='';tile.prepend(icon);tile.style.gridColumn=`${i.x+1} / span ${size.w}`;tile.style.gridRow=`${i.y+1} / span ${size.h}`;grid.append(tile);}
    const stock=make('p','equipment-stock',e.items.filter(i=>i.location!=='grid').map(i=>`${i.id} ${t('gear.'+i.definition)} [${t('gear.grade.'+i.grade)}] · ${t('gear.location.'+i.location)}`).join(' / '));
    this.host.replaceChildren(title,stats,grid,stock,make('p','',t('gear.goals',{elite:state.hero.dungeon?.eliteWins??0,boss:state.hero.dungeon?.bossWins??0,crafted:e.crafted})),make('p','muted',t('gear.help')));
  }
}
