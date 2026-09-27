import { RESOURCE_TYPES } from '../../../../src/state/economy.js';
import { quoteDivineCost, faithGenerationPerDay } from '../../../../src/game/Faith.js';
import { interpretDivineMessage } from '../../../../src/llm/divineLLM.js';
import { interpretOracle } from '../../../../src/game/PriestInterpretation.js';

export class EconomyPanel {
  constructor(host, state, i18n) {
    this.host = host; this.state = state; this.i18n = i18n; this.rows = new Map();
    if (!host) return;
    this.title = document.createElement('h3'); this.grid = document.createElement('dl'); this.grid.className = 'resource-grid';
    for (const id of RESOURCE_TYPES) {
      const group = document.createElement('div'); const term = document.createElement('dt'); const value = document.createElement('dd');
      group.append(term, value); this.grid.append(group); this.rows.set(id, { term, value });
    }
    this.help = document.createElement('p'); this.help.className = 'muted'; host.append(this.title, this.grid, this.help);
    this.faith = document.querySelector('#faith-counter'); this.draft = document.querySelector('#faith-preview');
    this.input = document.querySelector('#divine-message');
    this.unsubscribe = i18n.subscribe(() => this.update(this.state)); this.update(state);
  }
  update(state) {
    this.state = state; if (!this.host) return;
    this.title.textContent = this.i18n.t('economy.title'); this.help.textContent = this.i18n.t('economy.processes');
    for (const [id, row] of this.rows) {
      row.term.textContent = this.i18n.t(`resource.${id}`);
      row.value.textContent = this.i18n.formatValue(Math.floor(state.resources[id] ?? 0));
    }
    const faith = state.faith;
    if (this.faith && faith) {
      this.faith.textContent = this.i18n.t('faith.balance', { points: Math.floor(faith.points), capacity: faith.capacity,
        income: Math.round(faithGenerationPerDay(state) * 10) / 10 });
      this.faith.title = this.i18n.t('faith.explain');
    }
    const message = this.input?.value.trim() ?? '';
    if (message !== this.lastDraft) {
      this.lastDraft = message; this.draftCost = null;
      void interpretDivineMessage(message, { defaultTarget: 'home' }).then(action => {
        if (this.lastDraft !== message) return;
        this.draftCost = action?.status === 'understood' ? quoteDivineCost(action)
          : interpretOracle(message) ? quoteDivineCost('interpretation') : null;
        this.showQuote();
      });
    }
    this.showQuote();
  }
  showQuote() {
    if (!this.draft) return;
    const available = Math.floor(this.state.faith?.points ?? 0);
    this.draft.textContent = this.draftCost === null ? this.i18n.t('faith.unknown')
      : this.i18n.t('faith.cost', { cost: this.draftCost, available });
    this.draft.dataset.affordable = String(this.draftCost === null || available >= this.draftCost);
  }
  dispose() { this.unsubscribe?.(); this.lastDraft = null; }
}
