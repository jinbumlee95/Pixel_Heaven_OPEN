import { I18n } from '../i18n/I18n.js';

export class Chat {
  constructor(host, villages, onSend, i18n = new I18n({ locale: 'en', storage: null })) {
    this.i18n = i18n;
    this.villages = villages;
    this.entries = [];
    this.eventRecords = [];
    this.statusRecord = null;
    this.composing = false;
    this.compositionEnter = false;
    this.responsePlanId = undefined;
    this.form = host.querySelector('form');
    this.input = host.querySelector('textarea');
    this.input.disabled = false;
    this.target = host.querySelector('select');
    this.busy = false;
    this.status = host.querySelector('.reply-status') ?? host.querySelector('[role="status"]');
    this.events = document.querySelector('#divine-events');
    this.history = document.querySelector('#divine-history');
    for (const village of villages) {
      const option = document.createElement('option');
      option.value = village.id;
      option.textContent = this.i18n.villageName(village.id, village.name);
      this.target?.append(option);
    }
    this.input.addEventListener('compositionstart', () => { this.composing = true; });
    this.input.addEventListener('compositionend', () => { this.composing = false; });
    this.input.addEventListener('keydown', event => {
      // IME confirmation is not a command submission, including browsers that
      // end composition before dispatching their implicit form submit.
      if(event.key==='Enter' && !event.shiftKey && !this.composing && !event.isComposing && event.keyCode!==229 && !this.compositionEnter){event.preventDefault();this.form.requestSubmit();return;}
      if ((event.key === 'Enter' && (this.composing || event.isComposing)) || event.keyCode === 229) {
        this.compositionEnter = true;
      }
    });
    this.input.addEventListener('keyup', event => {
      if (event.key === 'Enter' || event.keyCode === 229) this.compositionEnter = false;
    });
    this.input.addEventListener('blur', () => { this.compositionEnter = false; this.composing = false; });
    this.input.addEventListener('input', () => { this.responsePlanId = undefined; });
    this.unsubscribe = this.i18n.subscribe(() => this.refreshLocale());
    this.form.addEventListener('submit', async event => {
      event.preventDefault();
      if (this.composing || this.compositionEnter || event.isComposing || this.busy || !this.input.value.trim()) return;
      this.busy = true;
      this.input.disabled = true;
      host.setAttribute('aria-busy', 'true');
      this.setStatus({ messageKey: 'chat.pending' });
      try {
        const result = await onSend(this.input.value, this.villages[0]?.id ?? 'home', { planId: this.responsePlanId });
        this.setStatus(result);
        if (result.ok) {
          this.addEvent(result.event);
        }
        if (result.ok || result.code === 'unclear') {
          this.input.value = '';
          this.responsePlanId = undefined;
        }
      } catch {
        this.setStatus({ messageKey: 'chat.deliveryFailed' });
      } finally {
        this.busy = false;
        this.input.disabled = false;
        host.setAttribute('aria-busy', 'false');
        this.input.focus();
      }
    });
  }

  renderHistory(entries) {
    this.entries = entries.slice(-50);
    const items = this.entries.slice().reverse().map(entry => {
      const item = document.createElement('li');
      const words = document.createElement('p');
      words.textContent = this.i18n.t('chat.historyEntry', { id: entry.id, time: { gameTime: entry.time }, message: entry.message });
      const reply = document.createElement('p');
      const outcome = ['unclear', 'applied', 'pending'].includes(entry.outcome) ? entry.outcome : 'rejected';
      const speaker = this.i18n.t(`chat.speaker.${outcome}`);
      const message = this.i18n.formatMessage(entry.replyMessage ?? { message: entry.reply }) || this.i18n.t('chat.pending');
      reply.textContent = this.i18n.t('chat.reply', { speaker, reply: message });
      item.append(words, reply);
      if (globalThis.pixelHeavenDebug && entry.interpreter?.provider) {
        const trace = document.createElement('small');
        trace.textContent = this.i18n.t(`intent.provider.${entry.interpreter.provider}`) + ' · '
          + this.i18n.t(`intent.reason.${entry.interpreter.reason}`);
        item.append(trace);
      }
      return item;
    });
    this.history.replaceChildren(...items.slice(0, 3));
  }

  prepareResponse(villageId, example, { planId } = {}) {
    if (this.busy) return;
    if (this.target) this.target.value = villageId;
    // Preserve a message the player is already writing; never send automatically.
    if (!this.input.value.trim()) {
      this.input.value = example;
      this.responsePlanId = planId;
    }
    this.input.focus();
    const reduced = document.body.classList.contains('reduce-motion') || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.input.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }

  addEvent(event) {
    if (!event) return;
    this.eventRecords.unshift(event);
    this.eventRecords.length = Math.min(this.eventRecords.length, 50);
    this.renderEvents();
  }

  renderEvents() {
    this.events?.replaceChildren(...this.eventRecords.map(event => {
      const item = document.createElement('li');
      item.textContent = this.i18n.t('world.event', { time: { gameTime: event.time }, message: this.i18n.formatMessage(event) });
      return item;
    }));
  }

  setStatus(record) {
    this.statusRecord = record;
    this.status.textContent = this.i18n.formatMessage(record);
    this.status.scrollTop=0;
  }

  refreshLocale() {
    for (let index = 0; index < this.villages.length; index++) {
      const village = this.villages[index];
      if (this.target) this.target.options[index].textContent = this.i18n.villageName(village.id, village.name);
    }
    this.setStatus(this.statusRecord);
    this.renderHistory(this.entries);
    this.renderEvents();
  }

  dispose() { this.unsubscribe(); }
}
