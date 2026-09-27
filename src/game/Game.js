import { validOracleOrder } from '../llm/OracleOrders.js';
import { stepWorld } from './WorldStep.js';
import { isQuestion } from '../llm/DialogueAct.js';
import { initializeReligion, prayerValues, creditPrayer } from './Religion.js';
import { ReligionPanel } from '../ui/Religion.js';
import { EquipmentPanel } from '../ui/Equipment.js';
import { ChatCommands, executeChatOrder, validOrder } from './ChatCommands.js';
import { initializeLandscape } from './Landscape.js';
import { ChatFiles } from '../ui/ChatFiles.js';
import { DecisionQueuePanel } from '../ui/DecisionQueue.js';
import { setDecision } from './DecisionQueue.js';
import { initializeStory } from './Story.js';
import { LivingWorld } from './LivingWorld.js';
import { DiplomacySystem } from './Diplomacy.js';
import { WorkSystem } from './Work.js';
import { encodeWorld, worldRandom } from '../state/Persistence.js';
import { createInitialWorld } from './World.js';
import { Renderer } from './Renderer.js';
import { Chat } from '../ui/Chat.js';
import { LocalAI } from '../llm/LocalAI.js';
import { RequestQueue } from '../llm/RequestQueue.js';
import { executeDivineAction } from '../actions/divineActions.js';
import { validateDivineInterpretation } from '../llm/schemas.js';
import { Priest, createPriestResponse } from '../ui/Priest.js';
import { WorldDecisions } from './WorldDecisions.js';
import { createWorldContext, getWorldNeeds } from './WorldNeeds.js';
import { Events } from '../ui/Events.js';
import { interpretOracle } from './PriestInterpretation.js';
import { Emergence } from './Emergence.js';
import { Sound } from '../ui/Sound.js';
import { Theme } from '../ui/Theme.js';
import { I18n } from '../i18n/I18n.js';
import { catalogues } from '../i18n/I18n.js';
import { inspectDivineDestination } from '../llm/divineLLM.js';
import { OracleRitual } from './OracleRitual.js';
import { Factions } from './Factions.js';
import { EventForecast } from './EventForecast.js';
import { BattleSystem } from './Combat.js';
import { HeroSystem, hideHeroEntity } from './Hero.js';
import { MerchantPanel } from '../ui/Merchant.js';
import { HeroPanel } from '../ui/Hero.js';
import { canSpendFaith, quoteDivineCost } from './Faith.js';

export const DIVINE_HISTORY_LIMIT = 50;

export class Game {
  constructor(host, { interpret, decideWorld, random, content, i18n, ritual = Boolean(host), seed, restored, packs = [], systems = true } = {}) {
    this.i18n = i18n ?? new I18n();
    this.world = restored?.world ?? createInitialWorld({ content });
    if (systems) initializeLandscape(this.world);
    this.packs = restored?.packs ?? packs;
    this.world.state.rules ??= structuredClone(this.world.content.rules);
    this.i18n.catalogs=Object.fromEntries(Object.entries(this.i18n.catalogs).map(([locale,catalog])=>[locale,{...catalog,...this.world.content.translations?.[locale]}]));
    this.renderer = new Renderer(host, this.world);
    this.speed = 1;
    this.accumulator = 0;
    this.uiElapsed = 0;
    this.localAI = new LocalAI();
    this.interpret = interpret ?? this.localAI.interpret;
    this.divineQueue = new RequestQueue();
    this.stopped = false;
    this.priestEntity = [...this.world.state.entities.values()].find(entity => entity.type === 'priest');
    this.priestEntity.lastInterpretation ??= null;
    this.priestReplyCount = 0;
    this.divineHistory = [];
    this.nextMessageId = 1;
    this.ritualEnabled = ritual;
    this.ritual = new OracleRitual(this.world, this.priestEntity, { onStage: state => {
      this.renderer.oracleState = state;
      this.priestView?.showRitual?.(state);
    } });
    this.sound = new Sound();
    this.worldDecisions = new WorldDecisions(this.world, { decide: decideWorld ?? this.localAI.decide,
      onEvent: event => {
        this.eventsView?.add(event); this.renderer.showEvent(event); this.sound.play(event);
        if (['production_complete', 'construction_complete', 'storage_wait'].includes(event.action)) this.priestView?.show(event);
      } });
    const onEvent = event => this.worldDecisions.record(event);
    if (systems) initializeStory(this.world);
    if(systems)this.world.state.story.chains ??= this.world.content.storyChains.map(id=>({id,stage:'waiting'}));
    this.work = systems ? new WorkSystem(this.world, { onEvent }) : null;
    this.factions = new Factions(this.world, { seed, onEvent });
    this.diplomacy = systems ? new DiplomacySystem(this.world, { onEvent }) : null;
    this.life = systems ? new LivingWorld(this.world, { onEvent }) : null;
    this.battle = new BattleSystem(this.world, { onEvent, onCamera: event => this.renderer.announceRaid(event) });
    this.hero = new HeroSystem(this.world, { onEvent });
    if(systems)initializeReligion(this.world.state,seed);
    if (host && !restored && systems) {
      this.world.state.hero.arriveAt = this.world.state.time + 30;
      this.world.state.hero.mode = 'awaiting'; hideHeroEntity(this.world);
    }
    this.motionRandom = worldRandom(this.world, 8191, 'motionRandomState');
    const randomSource = random ?? worldRandom(this.world, seed);
    this.forecasts = new EventForecast(this.world, { random: randomSource, onEvent, battle: this.battle });
    this.emergence = new Emergence(this.world, { random: randomSource, onEvent, forecastManaged: true });
    if (restored?.runtime) {
      const migrationEvents=this.worldDecisions.events.filter(e=>e.action==='raid_migrated');
      const runtime = restored.runtime;
      this.divineHistory = runtime.divineHistory ?? [];
      this.worldDecisions.activeNeeds = new Set(runtime.activeNeeds ?? []);
      this.nextMessageId = runtime.nextMessageId ?? 1;
      this.priestReplyCount = runtime.priestReplyCount ?? 0;
      Object.assign(this.worldDecisions, { nextCheck: runtime.nextCheck ?? this.world.state.time,
        interpretations: runtime.interpretations ?? [], events: runtime.events ?? [], nextEventId: runtime.nextEventId ?? 1 });
      for(const event of migrationEvents)this.worldDecisions.events.push({...event,id:this.worldDecisions.nextEventId++});
      this.worldDecisions.events=this.worldDecisions.events.slice(-50);
    }
    this.foreignNames = this.world.state.factions.flatMap(faction => [faction.id, faction.name,
      ...Object.values(catalogues).map(catalog => catalog[faction.nameKey]).filter(Boolean)]);
  }

  async start() {
    await this.renderer.init();
    this.priestView = new Priest(document.querySelector('#priest'), this.priestEntity, this.i18n);
    this.religionPanel=new ReligionPanel(document.querySelector('#priest'),this.i18n);
    this.commands = new ChatCommands(this, {files:new ChatFiles(this)});
    this.chat = new Chat(document.querySelector('#divine-chat'), this.world.state.villages,
      message => this.commands.send(message), this.i18n);
    this.eventsView = new Events(document.querySelector('#world-panel'), null, this.i18n);
    for (const event of this.worldDecisions.events) this.eventsView.add(event);
    this.forecastPanel = new DecisionQueuePanel(document.querySelector('#event-forecast'), this);
    this.equipmentPanel=new EquipmentPanel(document.querySelector('#equipment-panel'),this.i18n);
    this.heroPanel = new HeroPanel(document.querySelector('#hero-panel'), this.world.state, this.i18n);
    this.merchantPanel = new MerchantPanel(document.querySelector('#merchant-visit'), this.world, this.i18n);
    this.theme = new Theme();
    this.renderer.reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    document.body.classList.toggle('reduce-motion',this.renderer.reducedMotion);
    this.localAI.onStatus = () => {};
    void this.localAI.detect();
    this.unsubscribeLocale=this.i18n.subscribe(()=>{this.i18n.applyDOM(document);this.renderer.setMapLabel(this.i18n.t('map.aria'));document.querySelector('#status').textContent=this.i18n.t('app.navigationHint');});
    this.i18n.applyDOM(document);
    this.renderer.setMapLabel(this.i18n.t('map.aria'));
    this.worldDecisions.update();
    this.chat.renderHistory(this.divineHistory);
    this.previousTime = performance.now();
    this.running = true;
    this.frameId = requestAnimationFrame(time => this.frame(time));
    for(const entry of this.divineHistory.filter(e=>e.outcome==='pending'))void this.sendDivineMessage(entry.message,entry.selectedTarget,{planId:entry.planId,order:entry.order,interpretMessage:entry.interpretMessage,decisionId:entry.decisionId,resumeEntry:entry});
  }

  async sendDivineMessage(message, defaultTarget = 'home', { planId, resumeEntry, order, interpretMessage, decisionId } = {}) {
    if(isQuestion(message)){
      if(resumeEntry){this.ritual.finish(resumeEntry.id);resumeEntry.outcome='rejected';resumeEntry.completedTime=this.world.state.time;resumeEntry.replyMessage={messageKey:'religion.query'};}
      return {ok:true,message:this.i18n.t('religion.query')};
    }
    if (this.stopped) return { ok: false, code: 'stopped', messageKey: 'game.stopped', message: 'The world has stopped.' };
    if (typeof message !== 'string' || !message.trim() || message.length > 500) {
      return { ok: false, code: 'invalid_message', messageKey: 'game.invalidMessage', message: 'Enter a message of 1–500 characters.' };
    }
    if(order && !validOrder(order))return {ok:false,code:'invalid',messageKey:'cw.invalid'};
    const entry = resumeEntry ?? { id: this.nextMessageId++, time: this.world.state.time,
      message: message.trim(), selectedTarget: defaultTarget, outcome: 'pending', reply: '', ...(planId?{planId}:{}), ...(order?{order}:{}), ...(interpretMessage?{interpretMessage}:{}), ...(decisionId?{decisionId}:{}) };
    if(!resumeEntry)this.divineHistory.push(entry);
    if (this.divineHistory.length > DIVINE_HISTORY_LIMIT) this.divineHistory.shift();
    this.chat?.renderHistory(this.divineHistory);
    let result, interventionBefore;
    try {
      const destination = inspectDivineDestination(message, { defaultTarget, foreignNames: this.foreignNames });
      if (defaultTarget !== this.world.state.playerSettlementId || (!order && !interpretMessage && destination.unsupported)) {
        const error = new Error('outside_player_control');
        error.code = 'invalid_target'; error.messageKey = 'event.divine.failure.invalid_target';
        throw error;
      }
      const action = await this.divineQueue.enqueue(async signal => {
        const cancel = () => this.ritual.cancel(entry.id, 'ritual_timeout');
        signal.addEventListener('abort', cancel, { once: true });
        try {
          if (this.ritualEnabled) {
            await this.ritual.receive(entry);
            if (signal.aborted || this.stopped) throw new Error('stopped');
            this.worldDecisions.record({ source: 'priest', action: 'oracle_received', actor: defaultTarget,
              messageId: entry.id, time: this.world.state.time, messageKey: 'oracle.record.received',
              messageParams: { id: entry.id }, message: `The Priest received oracle #${entry.id} at the altar.` });
          }
          if(decisionId && !setDecision(this.world.state,decisionId,'receiving').ok)throw Object.assign(new Error('expired'),{code:'expired',messageKey:'cw.expired'});
          if(order)return order;
          entry.processing='interpreting';
          let interpreted = await this.interpret(interpretMessage ?? message, Object.freeze({ defaultTarget,
            situation: structuredClone({ ...createWorldContext(this.world.state), faith: this.world.state.faith,
              hero: this.world.state.hero, factions: this.world.state.factions, forecasts: this.world.state.eventQueue, selectedPlanId: planId }) }));
          if (interpreted?.status === 'unclear' && !interpreted.reason && this.localAI.traces.divine?.provider !== 'local' && this.world.state.diplomacy) {
            const meaning = interpretOracle(message);
            const civic = { faith: 'hold_festival', peace: 'propose_alliance', conflict: 'prepare_defense', remembrance: 'build_temple' }[meaning?.intent];
            if (civic) {
              interpreted = { status: 'understood', action: civic, target: defaultTarget, parameters: {} };
              entry.priestIntent = meaning.intent;
              this.worldDecisions.record({source:'priest',action:'priest_interpretation',actor:defaultTarget,time:this.world.state.time,messageId:entry.id,
                messageKey:`intent.civic.${meaning.intent}`,messageParams:{}});
            }
          }
          entry.interpreter = { ...this.localAI.traces.divine };
          return interpreted;
        } finally {
          signal.removeEventListener('abort', cancel);
          this.ritual.finish(entry.id);
        }
      });
      if (this.stopped) throw new Error('stopped');
      interventionBefore=prayerValues(this.world.state);
      if (order || validOracleOrder(action)) {
        result = executeChatOrder(this.world, {...action,messageId:entry.id}, event=>this.worldDecisions.record(event));
      } else if (!validateDivineInterpretation(action)) {
        result = { ok: false, code: 'invalid_action', messageKey: 'game.invalidAction', message: 'This divine command is not supported.' };
      } else if (action.status === 'unclear') {
        const response = createPriestResponse({ ...this.priestEntity, personality: this.world.state.story?.personality ?? 'careful' }, message, this.priestReplyCount++);
        if(action.reason||this.localAI.traces.divine?.provider==='local')Object.assign(response,{messageKey:'oracle.failed',messageParams:{subject:{messageKey:'oracle.subject.'+(action.subject??'unknown'),messageParams:{}}}});
        const interpretation = action.reason || this.localAI.traces.divine?.provider === 'local' ? null : interpretOracle(message);
        if (interpretation) {
          const cost = quoteDivineCost('interpretation');
          if (this.world.state.faith && !canSpendFaith(this.world.state, cost)) {
            const error = new Error('insufficient_faith');
            error.code = 'insufficient_faith'; error.messageKey = 'event.divine.failure.insufficient_faith';
            error.messageParams = { cost, available: Math.floor(this.world.state.faith.points) };
            throw error;
          }
          const queued = this.worldDecisions.enqueueInterpretation({ messageId: entry.id, actor: defaultTarget,
            intent: interpretation.intent, original: entry.message, interpretation: interpretation.message,
            interpretationMessage: interpretation });
          Object.assign(response, queued ? {
            message: interpretation.message, messageKey: interpretation.messageKey, messageParams: interpretation.messageParams,
          } : { message: 'The Priest cannot send another interpretation to the village yet.', messageKey: 'priest.queueFull', messageParams: {} });
        }
        this.priestEntity.lastInterpretation = { messageId: entry.id, time: this.world.state.time,
          confidence: action.confidence, response: response.message };
        this.priestView?.show(response);
        result = { ok: false, code: 'unclear', message: response.message,
          messageKey: response.messageKey, messageParams: response.messageParams, priestResponse: response };
        entry.priestId = response.entityId;
      } else {
        result = executeDivineAction(this.world, action, { planId });
        if (result.ok) { this.renderer.showEvent(result.event); this.sound.play(result.event); }
        entry.target = action.target;
        if (result.ok) {
          this.renderer.focusVillage(action.target);
        }
      }
    } catch (error) {
      const known = typeof error.messageKey === 'string' && (error.messageKey.startsWith('oracle.ritual.failure.')
        || ['invalid_target', 'insufficient_faith','expired'].includes(error.code));
      result = { ok: false, code: known ? error.code : 'delivery_failed',
        messageKey: known ? error.messageKey : 'game.deliveryFailed', messageParams: error.messageParams ?? {},
        message: known ? this.i18n.formatMessage(error) : 'The message could not be delivered. Please try again.' };
    } finally {
      this.ritual.finish(entry.id);
    }
    if(result.ok&&interventionBefore)creditPrayer(this.world.state,entry.id,interventionBefore);
    if (result.event && this.world.state.story) {
      this.worldDecisions.record({source:'divine',action:'oracle_message',actor:defaultTarget,messageId:entry.id,time:entry.time,messageKey:'event.oracle.original',messageParams:{original:entry.message}});
      result.event.messageId = entry.id; this.worldDecisions.record(result.event);
      const job = this.world.state.work?.jobs.find(job => job.id === result.messageParams?.job);
      if (job) job.messageId = entry.id;
      const production=this.world.state.production?.jobs.find(j=>j.id===result.messageParams?.job);
      if(production)production.messageId=entry.id;
      const proposal = this.world.state.diplomacy?.proposals.find(p => p.id === result.messageParams?.proposal);
      if (proposal) proposal.messageId = entry.id;
    }
    if(decisionId)setDecision(this.world.state,decisionId,result.ok?'responded':'failed');
    entry.outcome = result.ok ? 'applied' : result.code === 'unclear' ? 'unclear' : 'rejected';
    entry.reply = result.message;
    entry.replyMessage = { message: result.message, messageKey: result.messageKey, messageParams: result.messageParams };
    entry.completedTime = this.world.state.time;
    this.chat?.renderHistory(this.divineHistory);
    return result;
  }

  frame(time) {
    if (!this.running) return;
    const frameStarted=performance.now();
    // No offline catch-up in Phase 1; cap stalls to avoid a resume burst.
    const elapsed = Math.max(0, Math.min(time - this.previousTime, 250));
    this.previousTime = time;
    void stepWorld(this,elapsed * this.speed);
    this.renderer.render(elapsed);
    this.heroPanel?.render(this.world.state, this.renderer.reducedMotion);
    this.uiElapsed += elapsed;
    if (this.uiElapsed >= 100) {
      this.updateHud();
      this.forecastPanel?.update(this.world.state);
      this.equipmentPanel?.update(this.world.state);
      this.religionPanel?.update(this.world.state);
      this.heroPanel?.update(this.world.state);
      this.merchantPanel?.update();
      this.uiElapsed %= 100;
    }
    this.frameCosts??=[];this.frameCosts.push(performance.now()-frameStarted);if(this.frameCosts.length>120)this.frameCosts.shift();
    this.frameId = requestAnimationFrame(next => this.frame(next));
  }

  stop() {
    this.stopped = true;
    this.running = false;
    this.divineQueue.stop();
    this.ritual.stop();
    this.localAI.stop();
    this.sound.stop();
    this.worldDecisions.stop();
    this.unsubscribeLocale?.();
    this.chat?.dispose?.();
    this.eventsView?.dispose?.();
    this.priestView?.dispose?.();
    this.forecastPanel?.dispose?.();
    this.heroPanel?.dispose?.();
    this.equipmentPanel?.dispose?.();
    this.religionPanel?.dispose?.();
    this.merchantPanel?.dispose?.();
    this.theme?.dispose();
    globalThis.cancelAnimationFrame?.(this.frameId);
    this.renderer.destroy();
  }

  snapshot() {
    if (this.divineHistory.some(entry => entry.outcome === 'pending'&&entry.processing==='interpreting') || this.worldDecisions.pending) throw Error('busy');
    return encodeWorld(this.world, { divineHistory: this.divineHistory, nextMessageId: this.nextMessageId,
      priestReplyCount: this.priestReplyCount, nextCheck: this.worldDecisions.nextCheck,
      interpretations: this.worldDecisions.interpretations, events: this.worldDecisions.events, activeNeeds: [...this.worldDecisions.activeNeeds],
      nextEventId: this.worldDecisions.nextEventId }, this.packs);
  }

  updateHud() {
    if(!globalThis.document)return;
    const state=this.world.state,t=(k,p)=>this.i18n.t(k,p);
    document.querySelector('#clock').textContent=this.i18n.gameTime(state.time);
    document.querySelector('#faith-counter').textContent=t('faith.title')+' '+Math.floor(state.faith.points);
    document.querySelector('.live-label').textContent=this.speed===0?t('map.paused'):t('map.live')+(this.speed>1?' ×'+this.speed:'');
    const touring=Boolean(this.renderer.cameraTour.current), notice=document.querySelector('#camera-notice');
    notice.hidden=!touring;notice.textContent=t('combat.camera.arrival');
  }
}
