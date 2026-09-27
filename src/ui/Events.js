export class Events {
  constructor(host,onRespond,i18n){this.host=host;this.i18n=i18n;this.records=[];this.unsubscribe=i18n.subscribe(()=>this.renderEvents());}
  add(event){this.records.unshift(event);this.records.length=Math.min(this.records.length,50);this.renderEvents();}
  renderEvents(){
    const event=this.records.find(e=>e.source==='factions');
    const node=this.host.querySelector('#world-events');
    node.textContent=event?this.i18n.gameTime(event.time)+' · '+this.i18n.formatMessage(event):this.i18n.t('cw.empty');
  }
  updateNeeds(){}
  dispose(){this.unsubscribe();}
}
