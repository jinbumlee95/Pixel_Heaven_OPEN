import { LivingPanel } from './LivingWorld.js';
import { WorkPanel } from './Work.js';
import { decodeWorld, parsePacks } from '../../../../src/state/Persistence.js';

const words = {
  title: ['마을의 기록과 운영', 'Settlement journal', '集落の記録と運営'],
  export: ['저장 파일 내보내기','Export save file','セーブを書き出す'],
  import: ['저장 파일 가져오기','Import save file','セーブを読み込む'],
  advanced: ['콘텐츠 제작·데이터 모드','Content creation and data mods','コンテンツ制作・データMOD'],
  active: ['현재 세계의 팩','Packs in this world','現在の世界のパック'],
  metrics: ['최근 120프레임 평균 처리 {ms}ms · 지도 표시 {cells}셀 · 대표 개체 {entities} · 사건 {events}', 'Last 120 frames: {ms}ms mean work · {cells} visible cells · {entities} representatives · {events} events', '直近120フレーム：平均処理{ms}ms · 表示{cells}セル · 代表{entities} · 事件{events}'],
  save: ['현재 세계 저장', 'Save world', '世界を保存'], load: ['저장한 세계 불러오기', 'Load saved world', '保存した世界を開く'],
  saved: ['세계를 저장했습니다.', 'World saved.', '世界を保存しました。'],
  busy: ['신탁 처리가 끝난 뒤 저장할 수 있습니다.', 'Wait for the oracle to finish before saving.', '神託の処理後に保存できます。'],
  missing: ['저장한 세계가 없습니다.', 'No saved world.', '保存データがありません。'],
  error: ['처리하지 못했습니다: ', 'Could not complete: ', '処理できませんでした：'],
  mod: ['데이터 모드 JSON', 'Data mod JSON', 'データMOD JSON'],
  install: ['모드 검증·다음 새 세계에 적용', 'Validate mod for the next new world', 'MODを検証して次の新世界に適用'],
  clear: ['다음 새 세계의 모드 해제', 'Disable mods for the next new world', '次の新世界のMODを無効化'],
  modDone: ['검증 완료. 현재 세계는 유지하며 새로 시작할 때 적용합니다.', 'Validated. Applied on a new world; current world preserved.', '検証完了。新しい世界で適用します。現在の世界は維持されます。'],
};
export function journalText(i18n, id) { return words[id]?.[{ ko: 0, en: 1, ja: 2 }[i18n.locale] ?? 1] ?? id; }
export class ChroniclePanel {
  constructor(host, game) {
    this.host = host; this.game = game; this.labels = [];
    if (!host) return;
    const text = id => journalText(game.i18n, id);
    const title = document.createElement('h2'); this.labels.push([title, 'title']); host.append(title);
    this.status = document.createElement('p'); this.status.setAttribute('role', 'status');
    const button = (id, act) => {
      const node = document.createElement('button'); node.type = 'button'; this.labels.push([node, id]);
      node.addEventListener('click', () => { try { act(); } catch (error) { this.status.textContent = error.message === 'busy' ? text('busy') : text('error') + error.message; } });
      host.append(node); return node;
    };
    button('save', () => { localStorage.setItem('pixelHeaven.save', game.snapshot()); this.status.textContent = text('saved'); });
    button('load', () => {
      const saved = localStorage.getItem('pixelHeaven.save');
      if (!saved) { this.status.textContent = text('missing'); return; }
      decodeWorld(saved); // Invalid files never replace the running world.
      sessionStorage.setItem('pixelHeaven.load', saved); location.reload();
    });
    button('export',()=>{const blob=new Blob([game.snapshot()],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='pixel-heaven-save.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    const file=document.createElement('input');file.type='file';file.accept='.json,application/json';file.hidden=true;host.append(file);
    button('import',()=>file.click());
    file.addEventListener('change',async()=>{try{const selected=file.files[0];if(!selected)return;if(selected.size>8_000_000)throw Error('save_too_large');const saved=await selected.text();decodeWorld(saved);sessionStorage.setItem('pixelHeaven.load',saved);location.reload();}catch(error){this.status.textContent=text('error')+error.message;}finally{file.value='';}});
    const management=document.createElement('div');management.className='management-grid';host.append(management);
    const labor = document.createElement('section'); management.append(labor); this.work = new WorkPanel(labor, game);
    const living = document.createElement('section'); management.append(living); this.living = new LivingPanel(living,game);
    const advanced=document.createElement('details'),summary=document.createElement('summary');this.labels.push([summary,'advanced']);advanced.append(summary);host.append(advanced);
    this.active=document.createElement('p');this.active.id='active-packs';advanced.append(this.active);
    const label = document.createElement('label'); label.htmlFor = 'mod-source'; this.labels.push([label, 'mod']);
    this.source = document.createElement('textarea'); this.source.id = 'mod-source'; this.source.rows = 3;
    advanced.append(label, this.source);
    advanced.append(button('install', () => { const packs = parsePacks(this.source.value); localStorage.setItem('pixelHeaven.packs', JSON.stringify(packs)); this.status.textContent = text('modDone')+` (${packs.map(p=>p.id).join(', ')})`; }));
    advanced.append(button('clear', () => { localStorage.setItem('pixelHeaven.packs', '[]'); this.status.textContent = text('modDone'); }));
    this.metrics=document.createElement('output');this.metrics.id='runtime-metrics';advanced.append(this.metrics);
    host.append(this.status);
    this.unsubscribe = game.i18n.subscribe(() => this.refresh()); this.refresh();
  }
  refresh() { for (const [node, id] of this.labels) node.textContent = journalText(this.game.i18n, id);if(this.active)this.active.textContent=journalText(this.game.i18n,'active')+': '+this.game.world.content.packs.map(p=>`${p.id} ${p.version}`).join(' · '); }
  update() { this.work?.update(); this.living?.update();if(this.metrics){const values=this.game.frameCosts??[];const params={ms:(values.reduce((a,b)=>a+b,0)/Math.max(1,values.length)).toFixed(2),cells:this.game.renderer.visibleCellCount??0,entities:this.game.world.state.entities.size,events:this.game.world.state.eventQueue.length};this.metrics.textContent=journalText(this.game.i18n,'metrics').replace(/\{(\w+)\}/g,(_,key)=>params[key]);} }
  dispose() { this.unsubscribe?.(); }
}
