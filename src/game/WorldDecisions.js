import { recordEvent, subscribeEvents } from './EventJournal.js';
import { ECONOMY } from '../state/economy.js';
import { RequestQueue } from '../llm/RequestQueue.js';
import { INTERPRETATION_REASON, INTENT_ACTIONS } from '../state/society.js';
import { createWorldContext, getWorldNeeds } from './WorldNeeds.js';
import { decideWorldAction } from '../llm/worldLLM.js';
import { executeWorldAction, validateWorldAction } from '../actions/worldActions.js';
import { quoteDivineCost, spendFaith, refundFaith } from './Faith.js';

export class WorldDecisions {
  constructor(world, { decide = decideWorldAction, onEvent = () => {} } = {}) {
    this.world = world;
    this.decide = decide;
    this.queue = new RequestQueue();
    this.onEvent = onEvent;
    this.nextCheck = world.state.time + ECONOMY.decisionInterval;
    this.pending = null;
    this.stopped = false;
    this.lastResult = null;
    this.activeNeeds = new Set();
    this.events = [];
    this.nextEventId = 1;
    this.interpretations = [];
    this.unsubscribeEvents=subscribeEvents(world.state,event=>{
      const existing=this.events.find(e=>e.journalId===event.journalId);
      if(existing){Object.assign(existing,event);return;}
      const entry={...event,id:this.nextEventId++};this.events.push(entry);
      this.events=this.events.slice(-50);this.onEvent(entry);
    });
  }

  enqueueInterpretation(entry) {
    if (this.stopped || this.interpretations.length >= 8
      || !this.world.getVillage(entry.actor) || !INTENT_ACTIONS[entry.intent]) return false;
    const faithCost = this.world.state.faith ? quoteDivineCost('interpretation') : 0;
    if (faithCost && !spendFaith(this.world.state, faithCost)) return false;
    const request = { ...entry, time: this.world.state.time, faithCost };
    this.interpretations.push(request);
    this.record({ source: 'divine', action: 'oracle_message', actor: entry.actor,
      messageId: entry.messageId, time: request.time, message: `You: ${entry.original}`,
      messageKey: 'event.oracle.original', messageParams: { original: entry.original } });
    this.record({ source: 'priest', action: 'priest_interpretation', actor: entry.actor,
      messageId: entry.messageId, time: request.time, message: entry.interpretation,
      messageKey: entry.interpretationMessage?.messageKey ?? `event.oracle.interpretation.${entry.intent}`,
      messageParams: structuredClone(entry.interpretationMessage?.messageParams ?? {}) });
    return true;
  }

  record(event) {
    return recordEvent(this.world.state,event);
  }

  updateNeeds() {
    const needs = getWorldNeeds(this.world.state);
    const current = new Set(needs.map(n => `${n.villageId}:${n.type}`));
    for (const need of needs) {
      const key = `${need.villageId}:${need.type}`;
      if (!this.activeNeeds.has(key)) this.record({ source: 'world', action: 'need',
        actor: need.villageId, time: this.world.state.time, message: need.message,
        messageKey: need.messageKey, messageParams: structuredClone(need.messageParams) });
    }
    for (const key of this.activeNeeds) {
      if (!current.has(key)) {
        const [actor, type] = key.split(':');
        this.record({ source: 'world', action: 'resolved', actor, time: this.world.state.time,
          messageKey: `event.resolved.${type}`, messageParams: { village: {
            villageId: actor, name: this.world.getVillage(actor)?.name ?? actor } },
          message: `${this.world.getVillage(actor)?.name ?? actor}: ${type === 'food_shortage' ? 'food supply is stable again' : type === 'housing_shortage' ? 'everyone has room to live' : `${type.replaceAll('_', ' ')} is resolved`}.` });
      }
    }
    this.activeNeeds = current;
    return needs;
  }

  update() {
    if (this.stopped) return null;
    const needs = this.updateNeeds();
    if (this.pending || this.world.state.time < this.nextCheck) return this.pending;
    this.nextCheck = this.world.state.time + ECONOMY.decisionInterval;
    const oracle = this.interpretations[0];
    if (!needs.length && !oracle) return null;
    const context = createWorldContext(this.world.state);
    context.interpretations = oracle ? [structuredClone(oracle)] : [];
    // One in-flight decision per interval, with bounded waiting and cancellation.
    let applied = false;
    this.pending = this.queue.enqueue(() => this.decide(context)).then(action => {
      if (this.stopped) return;
      const validation = validateWorldAction(this.world, action);
      const stillNeeded = oracle ? this.world.state.time - oracle.time <= 60
        && (action?.action === 'none' || (action?.actor === oracle.actor
          && action.reason === INTERPRETATION_REASON && action.action === INTENT_ACTIONS[oracle.intent]
          && (oracle.intent !== 'faith' || action.parameters?.religion === 'sky_god')))
        : action?.action === 'none' || getWorldNeeds(this.world.state)
          .some(n => n.villageId === action?.actor && n.type === action?.reason);
      const reserved=oracle?.faithCost??0;
      if(oracle&&validation.ok&&stillNeeded&&action.action!=='none')oracle.faithCost=0;
      this.lastResult = !validation.ok ? validation : !stillNeeded ? { ok: false, code: 'stale_decision',
        messageKey: 'event.world.failure.stale_decision', messageParams: {} }
        : executeWorldAction(this.world, action);
      if (oracle && this.lastResult.event) this.lastResult.event.messageId = oracle.messageId;
      applied = Boolean(this.lastResult.ok && this.lastResult.event);
      if(oracle&&!applied&&!oracle.faithCost)oracle.faithCost=reserved;
      if (oracle && applied) oracle.faithCost = 0;
      if (this.lastResult.event) this.record(this.lastResult.event);
      else if (oracle) this.record({ source: 'world', action: 'interpretation_not_applied', actor: oracle.actor,
        time: this.world.state.time, messageId: oracle.messageId,
        messageKey: this.lastResult.ok ? 'event.oracle.no_action'
          : this.world.state.time - oracle.time > 60 ? 'event.oracle.expired'
            : this.lastResult.code === 'stale_decision' ? 'event.oracle.stale'
              : this.lastResult.code === 'insufficient_wood' ? 'event.oracle.insufficient_wood'
                : this.lastResult.code === 'no_space' ? 'event.oracle.no_space' : 'event.oracle.not_applied',
        messageParams: {},
        message: this.lastResult.ok ? 'The village chose not to act on this interpretation.'
          : this.lastResult.code === 'insufficient_wood' ? 'The village lacks wood to carry out this interpretation.'
            : this.lastResult.code === 'no_space' ? 'The village has no space for this interpretation.'
              : 'The village could not carry out this interpretation under its current conditions.' });
      this.updateNeeds();
    }).catch(() => {
      this.lastResult = { ok: false, code: 'decision_failed',
        messageKey: 'event.world.failure.decision_failed', messageParams: {} };
      if (oracle && !this.stopped) this.record({ source: 'world', action: 'interpretation_not_applied', actor: oracle.actor,
        messageId: oracle.messageId, time: this.world.state.time, message: 'The village could not reach a decision on this interpretation.',
        messageKey: 'event.oracle.decision_failed', messageParams: {} });
    }).finally(() => {
      if (oracle) {
        if (!applied && oracle.faithCost) refundFaith(this.world.state, oracle.faithCost);
        oracle.faithCost = 0;
      }
      if (oracle) this.interpretations = this.interpretations.filter(entry => entry !== oracle);
      this.pending = null;
      this.nextCheck = this.world.state.time + ECONOMY.decisionInterval;
    });
    return this.pending;
  }

  stop() {
    this.unsubscribeEvents?.();
    this.stopped = true;
    for (const entry of this.interpretations) {
      if (entry.faithCost) refundFaith(this.world.state, entry.faithCost);
      entry.faithCost = 0;
    }
    this.interpretations = []; this.queue.stop();
  }
}
