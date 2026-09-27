import { getForecasts } from '../../../../src/game/EventForecast.js';
import { DISASTER_COSTS } from '../../../../src/game/Disasters.js';

export class ForecastPanel {
  constructor(host, state, i18n, onRespond = () => {}) {
    this.host = host;
    this.state = state;
    this.i18n = i18n;
    this.onRespond = onRespond;
    this.signature = '';
    this.timeNodes = [];
    this.unsubscribe = i18n.subscribe(() => { this.signature = ''; this.update(this.state); });
    this.update(state);
  }

  update(state) {
    this.state = state;
    if (!this.host) return;
    const plans = getForecasts(state);
    const home = state.villages.find(village => village.id === 'home');
    const prepared = plan => plan.kind === 'raid'
      ? plan.mitigation.defense || home?.preparedRaidId === plan.id || (home?.defenseUntil ?? 0) >= plan.endAt
      : plan.mitigation.rain || plan.mitigation.protected;
    const signature = JSON.stringify([this.i18n.locale, plans, plans.map(prepared)]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.timeNodes = [];
      const document = this.host.ownerDocument;
      const node = (tag, text, className) => {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        if (className) element.className = className;
        return element;
      };
      const title = node('h3', this.i18n.t('forecast.title'));
      const intro = node('p', this.i18n.t('forecast.description'), 'panel-note');
      const list = node('div', undefined, 'forecast-list');
      for (const plan of plans) {
        const card = node('article', undefined, 'forecast-card');
        card.dataset.kind = plan.kind;
        card.dataset.stage = plan.stage;
        const warning = node('img'); warning.src = ['raid','drought'].includes(plan.kind) ? `assets/ui/warning-${plan.kind}.png` : plan.kind === 'cold' ? 'assets/ui/weather_snow.png' : plan.kind === 'fire' ? 'assets/ui/fire_loop.png' : 'assets/ui/event_flood.png';
          warning.width = 24; warning.height = 24; warning.alt = ''; warning.className = 'forecast-icon';
          if(plan.kind==='fire')warning.classList.add('fire-icon');
        warning.addEventListener('error', () => { warning.hidden = true; }, { once: true }); card.append(warning);
        const timer = node('p', '', 'forecast-time');
        this.timeNodes.push({ node: timer, plan });
        const faction = plan.sourceFactionId
          ? { factionId: plan.sourceFactionId, nameKey: plan.sourceNameKey }
          : { messageKey: 'forecast.raiders', messageParams: {} };
        card.append(node('h4', this.i18n.t(`forecast.kind.${plan.kind}`)), timer,
          node('p', this.i18n.t(`forecast.detail.${plan.kind}`, {
            faction, food: plan.damage.food, people: plan.damage.people, severity: plan.severity,
            percent: Math.round((plan.harvestFactor ?? 1) * 100) })),
          node('p', this.i18n.t(prepared(plan) ? `forecast.prepared.${plan.kind}` : `forecast.advice.${plan.kind}`), 'forecast-advice'));
        if(DISASTER_COSTS[plan.kind])card.append(node('p',this.i18n.t('disaster.bounds',{count:plan.exposure?.length??0,damage:plan.damage.structures??100,costs:{resourceBasket:{...DISASTER_COSTS[plan.kind],faith:6}}})));
        const button = node('button', this.i18n.t('forecast.respond'), 'forecast-respond');
        button.type = 'button';
        button.disabled = prepared(plan);
        button.addEventListener('click', () => this.onRespond(plan.kind,
          this.i18n.t(plan.kind === 'raid' ? 'prompt.defense' : plan.kind === 'drought' ? 'prompt.rain' : `prompt.${plan.kind}`, {
            village: { villageId: 'home', name: home?.name } }), plan.id));
        card.append(button);
        list.append(card);
      }
      if (!plans.length) list.append(node('p', this.i18n.t('forecast.empty')));
      this.host.replaceChildren(title, intro, list);
    }
    // Countdowns update without recreating focused buttons every tick.
    for (const { node, plan } of this.timeNodes) {
      node.textContent = this.i18n.t(plan.stage === 'active' ? 'forecast.remaining' : 'forecast.countdown', {
        ticks: { duration: Math.max(0, (plan.stage === 'active' ? plan.endAt : plan.startAt) - state.time) },
        tick: { gameTime: plan.stage === 'active' ? plan.endAt : plan.startAt } });
    }
  }

  dispose() { this.unsubscribe(); }
}
