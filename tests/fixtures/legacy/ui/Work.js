import { JOBS, assignLabor, cancelConstruction, queueConstruction } from '../../../../src/game/Work.js';
export class WorkPanel {
  constructor(host, game) {
    this.host = host; this.game = game; this.rows = new Map(); this.jobRows = new Map();
    const title = document.createElement('h3'); this.title = title; host.append(title);
    this.free = document.createElement('p'); host.append(this.free);
    this.conditions=document.createElement('p');host.append(this.conditions);
    for (const role of JOBS) {
      const row = document.createElement('div'); row.className = 'labor-row';
      const label = document.createElement('span'), value = document.createElement('output');
      row.append(label, value);
      for (const delta of [-1,1]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = delta < 0 ? '−' : '+';
        button.addEventListener('click', () => {
          const result = assignLabor(game.world, role, game.world.getVillage('home').labor[role] + delta);
          this.status.textContent = result.ok ? '' : game.i18n.formatMessage(result); this.update();
        }); row.append(button);
      }
      host.append(row); this.rows.set(role, { row, label, value });
    }
    this.status = document.createElement('p'); this.status.setAttribute('role','status');
    this.ledger = document.createElement('p'); this.jobs = document.createElement('div'); this.repairs = document.createElement('div');
    host.append(this.status, this.ledger, this.jobs, this.repairs); this.update();
  }
  update() {
    const { world, i18n } = this.game, home = world.getVillage('home'); if (!home.labor) return;
    this.title.textContent = i18n.t('work.title'); this.title.title = i18n.t('work.defenseHelp');
    this.free.textContent = i18n.t('work.free', { count: home.population - JOBS.reduce((sum,role) => sum + home.labor[role],0) });
    this.conditions.textContent=i18n.t('work.conditions',{crop:Math.round((home.harvestCondition??1)*100),forest:(home.forestCapacity??4).toFixed(1)});
    for (const [role, { row,label,value }] of this.rows) {
      label.textContent = i18n.t(`work.${role}`); value.textContent = home.labor[role];
      for (const button of row.querySelectorAll('button')) button.setAttribute('aria-label', `${label.textContent} ${button.textContent}`);
    }
    const ledger = world.state.work.ledger.at(-1);
    this.ledger.textContent = ledger ? i18n.t('work.ledger', { changes: Object.entries(ledger.changes).filter(([,n])=>n).map(([id,n]) => `${i18n.t(`resource.${id}`)} ${n>0?'+':''}${n}`).join(' / ') }) : '';
    const signature = JSON.stringify([i18n.locale,world.state.work.jobs.map(job=>[job.id,job.status]), [...world.state.buildings.values(),...world.state.terrain.values()].filter(b=>b.damage>0).map(b=>b.id)]);
    if (signature !== this.signature) {
      this.signature = signature; this.jobs.replaceChildren(); this.repairs.replaceChildren(); this.jobRows.clear();
      for (const job of world.state.work.jobs.slice(-6)) {
        const row = document.createElement('p'), progress = document.createElement('span'); row.append(progress);
        if(job.status === 'working') { const button = document.createElement('button'); button.textContent = i18n.t('work.cancel');
          button.addEventListener('click',()=>{cancelConstruction(world,job.id); this.update();});row.append(button); }
        this.jobRows.set(job.id,progress); this.jobs.append(row);
      }
      for(const building of [...world.state.buildings.values(),...world.state.terrain.values()].filter(o=>['house','temple','farmland','forest'].includes(o.type))) if(building.damage>0) {
        const button=document.createElement('button');button.textContent=`${i18n.t('work.repair')} · ${i18n.t(`work.type.${building.type}`)} ${building.id}`;
        button.addEventListener('click',()=>{ const r=queueConstruction(world,{action:'repair'},{repairId:building.id});this.status.textContent=r.ok?'':i18n.formatMessage(r); });this.repairs.append(button);
      }
    }
    for(const job of world.state.work.jobs) { const row=this.jobRows.get(job.id); if(row) row.textContent=`${job.id} · ${i18n.t(`work.type.${job.type}`)} · ${i18n.t(`work.status.${job.status}`)} ${Math.floor(job.progress/job.required*100)}% `; }
  }
}
