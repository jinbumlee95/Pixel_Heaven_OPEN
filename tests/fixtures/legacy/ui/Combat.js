import { PREPARATION_COSTS, PREPARATION_SUPPLIES } from '../../../../src/game/Combat.js';
import { canAffordResources } from '../../../../src/state/economy.js';
import { quoteDivineCost, canSpendFaith } from '../../../../src/game/Faith.js';

export class CombatPanel {
  constructor(host, state, i18n, onPrepare = () => {}) {
    this.host = host;
    this.state = state;
    this.i18n = i18n;
    this.onPrepare = onPrepare;
    this.labels = [];
    if (!host) return;
    const node = (tag, key, className) => {
      const element = host.ownerDocument.createElement(tag);
      if (key) this.labels.push({ element, key });
      if (className) element.className = className;
      return element;
    };
    this.title = node('h3', 'combat.title');
    this.status = node('p', null, 'battle-status');
    this.plan = node('p', null, 'panel-note');
    this.scouted = node('p', null, 'panel-note');
    this.counts = node('p', null, 'battle-summary');
    this.roster = node('p', null, 'battle-roster');
    this.works = node('p', null, 'battle-summary');
    const intro = node('p', 'combat.description', 'panel-note');
    const actions = node('div', null, 'battle-actions');
    this.buttons = Object.entries(PREPARATION_COSTS).map(([kind, wood]) => {
      const button = node('button');
      button.type = 'button';
      button.dataset.preparation = kind;
      button.addEventListener('click', () => {
        if (this.planId) onPrepare(kind, this.planId);
      });
      actions.append(button);
      return { button, kind, wood };
    });
    const rules = node('details');
    rules.append(node('summary', 'combat.rulesTitle'), node('p', 'combat.legend'), node('p', 'combat.rules'),
      node('p', 'combat.roleRules'), node('p', 'combat.placeholder', 'panel-note'));
    host.replaceChildren(this.title, this.status, this.plan, this.scouted, this.counts, this.roster, this.works, intro, actions, rules);
    this.unsubscribe = i18n.subscribe(() => this.update(this.state));
    this.update(state);
  }

  update(state) {
    this.state = state;
    if (!this.host) return;
    const plan = (state.eventQueue ?? []).filter(event => event.kind === 'raid'
      && ['forecast', 'active'].includes(event.stage)).sort((a, b) => a.startAt - b.startAt)[0];
    // The renderer may retain the previous battle's bodies. This panel instead
    // describes one selected forecast, so its roster must belong to that plan.
    const combat = plan && state.combat?.planId === plan.id
      && ['preparing', 'approaching', 'fighting'].includes(state.combat.stage) ? state.combat : null;
    this.planId = plan?.id;
    for (const { element, key } of this.labels) element.textContent = this.i18n.t(key);
    this.status.textContent = this.i18n.t(`combat.stage.${combat?.stage ?? 'idle'}`);
    this.plan.textContent = plan ? this.i18n.t('combat.plan', { time: { gameTime: plan.startAt },
      direction: this.i18n.t(`combat.direction.${plan.entryDirection ?? 'north'}`) }) : this.i18n.t('combat.empty');
    const roles = new Map();
    for (const role of plan?.enemyComposition ?? []) roles.set(role, (roles.get(role) ?? 0) + 1);
    this.scouted.textContent = roles.size ? this.i18n.t('combat.scouted', { roles: [...roles].map(([role, count]) =>
      `${this.i18n.t(`combat.role.${role}`)} ${this.i18n.formatValue(count)}`).join(' · ') }) : '';
    const units = combat?.units ?? [];
    const live = units.filter(unit => unit.hp > 0);
    this.counts.textContent = this.i18n.t('combat.squad', Object.fromEntries([
      ['home', 'home'], ['allies', 'ally'], ['enemies', 'enemy'],
    ].map(([label, side]) => [label, live.filter(unit => unit.side === side).length])));
    this.roster.textContent = units.filter(unit => unit.side === 'home').map(unit =>
      this.i18n.t('combat.health', { role: this.i18n.t(`combat.role.${unit.isHero ? 'hero' : unit.role}`), hp: unit.hp, max: unit.maxHp })).join(' · ');
    const works = combat?.works ?? plan?.battlePreparation?.works ?? [];
    this.works.textContent = this.i18n.t('combat.works', Object.fromEntries(['cover', 'barricade', 'trap'].map(type =>
      [type, works.filter(work => work.type === type && work.hp > 0 && !work.triggered && !work.disarmed).length])));
    const home = state.villages.find(village => village.id === 'home');
    for (const { button, kind, wood } of this.buttons) {
      const supplies = home?.economyVersion === 2 ? PREPARATION_SUPPLIES[kind] : { wood };
      const cost = quoteDivineCost({ action: 'prepare_defense', parameters: { preparation: kind } });
      button.textContent = `${this.i18n.t(`combat.preparation.${kind}`)} · ${this.i18n.t('faith.title')} ${cost} · `
        + Object.entries(supplies).map(([id, amount]) => `${this.i18n.t(`resource.${id}`)} ${amount}`).join(' / ');
      button.disabled = !plan || plan.battlePreparation?.kinds.includes(kind)
        || !home || !canAffordResources(home, supplies) || Boolean(state.faith && !canSpendFaith(state, cost));
    }
  }

  dispose() { this.unsubscribe?.(); }
}
