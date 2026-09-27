import { daylight } from '../../../../src/game/Presentation.js';
import { I18n } from '../../../../src/i18n/I18n.js';

export class Counters {
  constructor(host, state, onFocus, i18n = new I18n({ locale: 'en', storage: null })) {
    this.i18n = i18n;
    this.rows = new Map();
    for (const village of state.villages) {
      const card = document.createElement('section');
      card.className = 'village';
      const button = document.createElement('button');
      button.textContent = this.i18n.villageName(village.id, village.name);
      button.addEventListener('click', () => onFocus(village.id));
      const stats = document.createElement('p'); stats.className = 'village-stats';
      const buildings = document.createElement('p');
      const beliefs = document.createElement('p');
      const weather = document.createElement('p'); weather.className = 'weather-label';
      const icon = document.createElement('img'); icon.width = 24; icon.height = 24; icon.alt = '';
      icon.addEventListener('error', () => { icon.hidden = true; });
      const weatherText = document.createElement('span');
      weather.append(icon, weatherText);
      const morale = document.createElement('meter');
      morale.min = 0; morale.max = 100;
      const happiness = document.createElement('p');
      card.append(button, stats, buildings, beliefs, weather, happiness, morale);
      host.append(card);
      this.rows.set(village.id, { button, stats, buildings, beliefs, icon, weatherText, morale, happiness });
    }
    this.summary = document.querySelector('#summary');
    this.summary.removeAttribute('data-i18n');
    this.summary.replaceChildren();
    this.resources = {};
    for (const name of ['food', 'wood']) {
      const group = document.createElement('span'); group.className = 'resource';
      const icon = document.createElement('img');
      icon.src = `assets/ui/icon_${name}.png`; icon.width = 16; icon.height = 16; icon.alt = '';
      icon.addEventListener('error', () => { icon.hidden = true; });
      const value = document.createElement('span');
      group.append(icon, value); this.summary.append(group); this.resources[name] = value;
    }
    this.clock = document.querySelector('#clock');
    this.coordinates = document.querySelector('#coordinates');
    this.unsubscribe = this.i18n.subscribe(() => { if (this.state) this.update(this.state, this.camera); });
  }

  update(state, camera) {
    this.state = state;
    this.camera = camera;
    const t = (key, params) => this.i18n.t(key, params);
    for (const village of state.villages) {
      const row = this.rows.get(village.id);
      const relations = Object.entries(village.relations ?? {}).map(([id, status]) => {
        const other = state.villages.find(candidate => candidate.id === id);
        return t('counter.relation', { village: { villageId: id, name: other?.name }, relation: t(`relation.${status}`) });
      }).join(' · ') || t('relation.neutral');
      row.button.textContent = this.i18n.villageName(village.id, village.name);
      row.stats.textContent = t('counter.stats', { population: village.population, food: Math.floor(village.food), wood: Math.floor(village.wood) });
      row.buildings.textContent = t('counter.buildings', { houses: village.houseCount ?? 0, fields: village.farmCount ?? 0, temples: village.templeCount ?? 0 });
      row.beliefs.textContent = t(state.villages.length === 1 ? 'counter.faith' : 'counter.beliefs', {
        religion: { religionId: village.religion }, relations,
      });
      const weather = village.weather ?? state.weather;
      const path = `assets/ui/weather_${weather === 'rain' ? 'rain' : weather === 'cold' ? 'snow' : weather === 'drought' ? 'drought' : 'clear'}.png`;
      if (row.icon.getAttribute('src') !== path) { row.icon.hidden = false; row.icon.src = path; }
      const preparedRaid = (state.eventQueue ?? []).some(event => (event.mitigation?.defense || event.id === village.preparedRaidId)
        && ['forecast', 'active'].includes(event.stage));
      row.weatherText.textContent = (village.defenseUntil ?? 0) > state.time || preparedRaid
        ? t('weather.defended', { weather: t(`weather.${weather}`) }) : t(`weather.${weather}`);
      row.morale.value = village.happiness;
      row.morale.setAttribute('aria-label', t('counter.happinessAria', { village: { villageId: village.id, name: village.name } }));
      row.happiness.textContent = t('counter.happiness', { value: village.happiness });
    }
    this.resources.food.textContent = t('counter.food', { value: Math.floor(state.resources.food) });
    this.resources.wood.textContent = t('counter.wood', { value: Math.floor(state.resources.wood) });
    const sky = daylight(state.time);
    this.clock.textContent = t('counter.clock', { day: sky.day, sky: t(`sky.${sky.label}`), time: { gameTime: state.time } });
    this.clock.setAttribute('title', t('time.mapping'));
    this.clock.setAttribute('data-time-help', t('time.mapping'));
    this.coordinates.textContent = t('map.coordinates', { x: Math.floor(camera.x), y: Math.floor(camera.y) });
  }

  dispose() { this.unsubscribe(); }
}
