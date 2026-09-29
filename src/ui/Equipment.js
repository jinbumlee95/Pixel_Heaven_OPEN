import { EQUIPMENT, GRADES } from '../content/equipment.js';
import { equipmentSize, deriveHeroStats } from '../game/Equipment.js';

const cellName = (x, y) => `${String.fromCharCode(65 + x)}${y + 1}`;
// First top-left cell where the item fits, so "Place" always suggests a valid spot.
export function firstFreeCell(equipment, item) {
  const used = new Set();
  for (const other of equipment.items.filter(i => i.location === 'grid' && i.id !== item.id)) {
    const s = equipmentSize(other);
    for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) used.add(`${other.x + dx},${other.y + dy}`);
  }
  const size = equipmentSize({ ...item, rotated: false });
  for (let y = 0; y + size.h <= equipment.height; y++) for (let x = 0; x + size.w <= equipment.width; x++) {
    let fits = true;
    for (let dy = 0; dy < size.h && fits; dy++) for (let dx = 0; dx < size.w; dx++) if (used.has(`${x + dx},${y + dy}`)) { fits = false; break; }
    if (fits) return cellName(x, y);
  }
  return null;
}

// Commands are shown on each button. A click only fills the message box;
// the player still presses Enter, so selling or salvaging is never accidental.
export function itemCommands(equipment, item) {
  const commands = [];
  const cell = firstFreeCell(equipment, item);
  if (item.location !== 'grid' && cell) commands.push(`place ${item.id} ${cell}`);
  if (item.location === 'grid') commands.push(`remove ${item.id}`);
  commands.push(`compare ${item.id}`, `${item.locked ? 'unlock' : 'lock'} ${item.id}`);
  if (item.durability < 100) commands.push(`repair ${item.id}`);
  if (!item.locked) commands.push(`sell ${item.id}`, `salvage ${item.id}`);
  return commands;
}

export class EquipmentPanel {
  constructor(host, i18n, { onCommand = () => {}, onSend = onCommand } = {}) {
    this.host = host; this.i18n = i18n; this.key = ''; this.selected = null; this.onCommand = onCommand; this.onSend = onSend;
    this.dragging = null;
    // Drag and drop sends place/remove at once (both are harmless and reversible).
    host?.addEventListener('dragstart', event => {
      const item = event.target.closest?.('[data-item]')?.dataset.item;
      if (!item) return;
      this.dragging = item;
      event.dataTransfer?.setData('text/plain', item);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      host.querySelector('.equipment-grid')?.classList.add('dragging');
    });
    host?.addEventListener('dragover', event => {
      const zone = this.dragging && event.target.closest?.('.equipment-cell,.gear-cards');
      if (!zone) return;
      event.preventDefault();
      for (const node of host.querySelectorAll('.drop')) if (node !== zone) node.classList.remove('drop');
      zone.classList.add('drop');
    });
    host?.addEventListener('drop', event => {
      const zone = event.target.closest?.('.equipment-cell,.gear-cards'), item = this.dragging;
      if (!zone || !item) return;
      event.preventDefault();
      const command = zone.dataset.dropCell ? `place ${item} ${zone.dataset.dropCell}` : zone.dataset.dropStorage === 'true' ? `remove ${item}` : null;
      this.endDrag();
      if (command) this.onSend(command);
    });
    host?.addEventListener('dragend', () => this.endDrag());
    // One delegated listener survives the frequent re-renders.
    host?.addEventListener('click', event => {
      const target = event.target.closest('[data-command],[data-item],[data-cell]');
      if (!target) return;
      if (target.dataset.command) this.onCommand(target.dataset.command);
      else if (target.dataset.item) { this.selected = this.selected === target.dataset.item ? null : target.dataset.item; this.key = ''; }
      else if (target.dataset.cell && this.selected) this.onCommand(`place ${this.selected} ${target.dataset.cell}`);
    });
  }

  endDrag() {
    this.dragging = null;
    this.host?.querySelector('.equipment-grid')?.classList.remove('dragging');
    for (const node of this.host?.querySelectorAll('.drop') ?? []) node.classList.remove('drop');
  }

  update(state) {
    // Re-rendering mid-drag would drop the dragged node; wait until it ends.
    if (this.dragging) return;
    const e = state.hero?.equipment; this.host.hidden = !e?.visible; if (this.host.hidden) return;
    if (this.selected && !e.items.some(i => i.id === this.selected)) this.selected = null;
    const key = JSON.stringify([e, this.i18n.locale, state.hero.level, this.selected]); if (key === this.key) return; this.key = key;
    const t = (k, p) => this.i18n.t(k, p), make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
    const icon = (item, cls) => { const img = make('img', cls); img.src = EQUIPMENT[item.definition].icon; img.alt = ''; return img; };
    const button = command => { const b = make('button', 'gear-command', command); b.type = 'button'; b.dataset.command = command; b.title = t('gear.ui.clickHint'); return b; };
    const describe = i => `${i.id} ${t('gear.' + i.definition)} · ${t('gear.grade.' + i.grade)} · ${i.durability}%${i.locked ? ' 🔒' : ''}`;

    const title = make('h2', '', t('gear.title')), stats = make('p', 'gear-stats', t('gear.stats', deriveHeroStats(state.hero)));
    const grid = make('div', 'equipment-grid'); grid.style.setProperty('--cols', e.width); grid.style.setProperty('--rows', e.height);
    grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', t('gear.title') + ` ${e.width} × ${e.height}`);
    for (let y = 0; y < e.height; y++) for (let x = 0; x < e.width; x++) {
      const cell = make('span', 'equipment-cell', cellName(x, y)); cell.style.gridColumn = x + 1; cell.style.gridRow = y + 1;
      cell.dataset.dropCell = cellName(x, y);
      if (this.selected) { cell.dataset.cell = cellName(x, y); cell.title = `place ${this.selected} ${cellName(x, y)}`; cell.classList.add('target'); }
      grid.append(cell);
    }
    for (const i of e.items.filter(i => i.location === 'grid')) {
      const size = equipmentSize(i);
      const tile = make('button', `equipment-tile grade-${i.grade}${i.active ? '' : ' inactive'}${i.id === this.selected ? ' selected' : ''}`);
      tile.type = 'button'; tile.dataset.item = i.id; tile.draggable = true;
      tile.title = describe(i) + ' · ' + t('gear.effect.' + (EQUIPMENT[i.definition].effect ?? 'none'));
      tile.setAttribute('aria-label', tile.title + ' ' + cellName(i.x, i.y));
      tile.append(icon(i, 'equipment-icon'), make('span', 'equipment-badge', `${i.id}${i.locked ? ' 🔒' : ''}`));
      tile.style.gridColumn = `${i.x + 1} / span ${size.w}`; tile.style.gridRow = `${i.y + 1} / span ${size.h}`;
      grid.append(tile);
    }

    // Stored and looted items as picture cards.
    const others = e.items.filter(i => i.location !== 'grid');
    const storage = make('div', 'gear-storage');
    storage.append(make('h3', '', t('gear.ui.storage', { count: others.length })));
    const cards = make('div', 'gear-cards'); cards.dataset.dropStorage = String(e.items.some(i => i.location === 'grid'));
    for (const i of others) {
      const card = make('button', `gear-card grade-${i.grade}${i.id === this.selected ? ' selected' : ''}`); card.type = 'button'; card.dataset.item = i.id; card.draggable = true;
      card.append(icon(i, 'gear-card-icon'), make('span', '', `${i.id}\n${t('gear.' + i.definition)}\n${t('gear.grade.' + i.grade)} · ${t('gear.location.' + i.location)}`));
      card.title = describe(i);
      cards.append(card);
    }
    if (!others.length) cards.append(make('p', 'muted', t('gear.ui.empty')));
    storage.append(cards);

    // Selected item: large picture, real stats and every command it supports.
    const detail = make('div', 'gear-detail');
    const item = e.items.find(i => i.id === this.selected);
    if (item) {
      const d = EQUIPMENT[item.definition], g = GRADES[item.grade], n = v => Math.floor(v * g);
      const info = make('div', 'gear-detail-info');
      info.append(make('strong', '', describe(item)),
        make('p', '', t('gear.ui.itemStats', { damage: n(d.damage), armor: n(d.armor), hp: n(d.hp), speed: Math.round(d.speed * 100) / 100, w: d.w, h: d.h })),
        make('p', 'muted', t('gear.effect.' + (d.effect ?? 'none')) + (item.affix ? ' · ' + t('gear.affix.' + item.affix) : '')));
      const actions = make('div', 'gear-commands'); for (const c of itemCommands(e, item)) actions.append(button(c));
      detail.append(icon(item, 'gear-detail-icon'), info, actions, make('p', 'muted', t('gear.ui.placeHint', { id: item.id })));
    } else detail.append(make('p', 'muted', t('gear.ui.selectHint')));

    const quick = make('div', 'gear-commands');
    for (const c of ['auto attack', 'auto survival', 'auto expedition', 'expand grid', 'equipment goals', 'close grid']) quick.append(button(c));
    this.host.replaceChildren(title, stats, grid, detail, storage, make('h3', '', t('gear.ui.quick')), quick,
      make('p', 'muted', t('gear.goals', { elite: state.hero.dungeon?.eliteWins ?? 0, boss: state.hero.dungeon?.bossWins ?? 0, crafted: e.crafted })),
      make('p', 'muted', t('gear.ui.clickHint')));
  }
}
