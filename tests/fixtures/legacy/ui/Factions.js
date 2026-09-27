export class FactionsPanel {
  constructor(host, state, i18n) {
    this.host = host;
    this.i18n = i18n;
    this.state = state;
    this.signature = '';
    this.unsubscribe = i18n.subscribe(() => { this.signature = ''; this.update(this.state); });
    this.update(state);
  }

  update(state) {
    this.state = state;
    if (!this.host) return;
    const factions = state.factions ?? [];
    const conditions = state.worldConditions ?? {};
    const signature = `${this.i18n.locale}:${conditions.updatedAt}:${state.factionSimulation?.sequence}:${factions.length}`;
    if (signature === this.signature) return;
    this.signature = signature;
    const document = this.host.ownerDocument;
    const node = (tag, text, className) => {
      const element = document.createElement(tag);
      if (text !== undefined) element.textContent = text;
      if (className) element.className = className;
      return element;
    };
    const heading = node('h3', this.i18n.t('faction.panel.title'));
    const description = node('p', this.i18n.t('faction.panel.description'), 'panel-note');
    const counts = node('p', this.i18n.t('faction.panel.counts', {
      total: factions.length, allied: conditions.alliedCount ?? 0,
      hostile: conditions.hostileCount ?? 0, neutral: conditions.neutralCount ?? 0 }), 'faction-counts');
    const pressure = node('p', this.i18n.t('faction.panel.pressure', {
      threat: conditions.threat ?? 0, support: conditions.support ?? 0, trade: conditions.trade ?? 0 }), 'faction-pressure');
    const details = node('details', undefined, 'faction-roster');
    details.append(node('summary', this.i18n.t('faction.panel.roster')));
    const roster = node('ul', undefined, 'faction-list');
    for (const [index, faction] of factions.entries()) {
      const item = node('li');
      const crest = node('img'); crest.src = `assets/ui/faction-crest-${String(index % 24 + 1).padStart(2, '0')}.png`;
      crest.width = 32; crest.height = 32; crest.alt = ''; crest.className = 'faction-crest';
      crest.addEventListener('error', () => { crest.hidden = true; }, { once: true }); item.append(crest);
      item.dataset.factionId = faction.id;
      item.dataset.stance = faction.stance;
      item.append(node('strong', this.i18n.t(faction.nameKey)), node('span', this.i18n.t('faction.panel.record', {
        stance: this.i18n.t(`faction.stance.${faction.stance}`), strength: faction.strength,
        food: faction.resources.food, wood: faction.resources.wood })));
      roster.append(item);
    }
    details.append(roster);
    const recentTitle = node('h4', this.i18n.t('faction.panel.recent'));
    const history = node('ol', undefined, 'faction-history');
    for (const event of (state.factionHistory ?? []).slice(-3).reverse()) {
      history.append(node('li', this.i18n.t('faction.panel.event', {
        tick: { gameTime: event.time }, message: this.i18n.formatMessage(event) })));
    }
    if (!history.children.length) history.append(node('li', this.i18n.t('faction.panel.waiting')));
    this.host.replaceChildren(heading, description, counts, pressure, details, recentTitle, history);
  }

  dispose() { this.unsubscribe(); }
}
