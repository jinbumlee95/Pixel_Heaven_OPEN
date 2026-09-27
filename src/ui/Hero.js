import { dungeonRoom } from '../game/Dungeon.js';
import { dungeonSummary } from './Dungeon.js';
import { AWAY_MODES, bagSize } from '../game/Expedition.js';
import { heroTrainingPose } from '../game/Hero.js';
import { quoteDivineCost } from '../game/Faith.js';

const make = (tag, className = '') => { const node = document.createElement(tag); node.className = className; return node; };
// A bounded DOM sprite strip observes domain phase time. No animation callback
// grants rewards, advances encounters or changes the hero's authoritative state.
export class HeroPanel {
  constructor(host, state, i18n, onOrder) {
    this.monsterAssets = new Map();
    this.host = host; this.state = state; this.i18n = i18n;
    if (!host) return;
    const heading = make('div', 'section-heading');
    this.title = make('h2'); this.mode = make('span', 'hero-mode'); heading.append(this.title, this.mode);
    this.stats = make('p', 'hero-stats');
    this.scene = make('div', 'hero-scene'); this.scene.setAttribute('role', 'img');
    this.ground = make('div', 'hero-ground');
    this.pawn = make('div', 'hero-strip-pawn'); this.pawn.setAttribute('aria-hidden', 'true');
    this.monster = make('div', 'dungeon-monster'); this.monster.setAttribute('aria-hidden', 'true');
    this.scene.append(this.ground, this.pawn, this.monster, make('div','dungeon-shade'));
    this.progress = make('progress'); this.progress.max = 1;
    this.room = make('p', 'hero-room'); this.hint = make('p', 'dungeon-summary');
    this.placeholder = make('p', 'hero-art-note'); this.supplies = make('p', 'expedition-status');
    host.append(heading, this.stats, this.room);
    document.querySelector('#hero-journey').append(this.hint, this.scene, this.progress, this.supplies, this.placeholder);
    if (typeof Image !== 'undefined') for (const id of ['slime', 'cave_bat', 'stone_guardian']) for (const clip of ['idle', 'walk', 'attack', 'hit', 'down']) {
      const img = new Image(); const key = `${id}/${clip}`;
      img.onload = () => this.monsterAssets.set(key, true);
      img.onerror = () => this.monsterAssets.set(key, false);
      img.src = `assets/characters/dungeon/${key}.png`;
    }
    this.unsubscribe = i18n.subscribe(() => this.update(this.state));
    this.update(state);
  }

  update(state) {
    this.state = state; if (!this.host) return;
    const hero = state.hero; const t = (key, params) => this.i18n.t(key, params);
    const mode = hero?.mode ?? 'unavailable';
    this.title.textContent = t('hero.title'); this.mode.textContent = t(mode === 'home' ? `cw.training.${heroTrainingPose(hero).action}` : `hero.mode.${mode}`);
    this.stats.textContent = hero ? t('hero.stats', { level: hero.level, xp: hero.xp, hp: Math.ceil(hero.hp), maxHp: hero.maxHp }) : '';
    const away = AWAY_MODES.includes(mode);
    this.scene.hidden = !away; this.progress.hidden = !away; this.placeholder.hidden = !away;
    this.scene.setAttribute('aria-label', this.mode.textContent);
    this.progress.setAttribute('aria-label', this.mode.textContent);
    const scene = hero?.scene;
    this.room.textContent = scene?.monsterId && away ? t('hero.room', { room: scene.room, total: scene.totalRooms,
      monster: t(`hero.monster.${scene.monsterId}`) }) : t('hero.cleared', { count: hero?.dungeonsCleared ?? 0 });
    const roomKind=mode==='exploring'?dungeonRoom(hero):hero?.encounter?.kind;
    if(['exploring','fighting','victory'].includes(mode)&&roomKind&&roomKind!=='normal')this.room.textContent+=' · '+t('dungeon.'+roomKind);
    if (hero?.waitReason && !away) this.room.textContent += ` · ${t(`exp.wait.${hero.waitReason}`)}`;
    if (hero?.recallRequested) this.room.textContent += ` · ${t('hero.recalling')}`;
    this.hint.textContent = t(away ? 'hero.rewardHelp' : 'hero.homeHelp');
    this.placeholder.textContent = t('hero.placeholder');
    this.supplies.textContent = hero ? t('exp.summary',{cycle:hero.cycleId??1,depth:hero.depth??1,next:hero.nextDepth??1,supplies:hero.supplies??0,bag:bagSize(hero)})
      + ' · ' + Object.entries(hero.bag??{}).map(([id,n])=>`${t(`resource.${id}`)} ${n}`).join(' · ')
      + (hero.waitReason?' · '+t(`exp.wait.${hero.waitReason}`):'') : '';
    this.hint.textContent = away ? dungeonSummary(state,this.i18n) : t('hero.homeHelp');
    document.querySelector('#hero-journey').hidden = !away;
  }

  render(state, reducedMotion = false) {
    if (!this.host || !state.hero?.scene) return;
    const { mode, scene } = state.hero;
    const elapsed = scene.elapsedMs ?? 0;
    const progress = Math.max(0, Math.min(1, elapsed / Math.max(1, scene.durationMs)));
    this.progress.value = progress;
    const fighting = mode === 'fighting' && Boolean(scene.monsterId);
    const returning = mode === 'returning';
    const walking = ['outbound', 'exploring', 'returning'].includes(mode);
    const frame = reducedMotion ? 0 : Math.floor(elapsed / 120) % (fighting ? 8 : 6);
    const path = fighting && !reducedMotion ? `assets/characters/hero-production/${Math.floor(elapsed / 960) % 2 ? 'thrust' : 'slash'}.png` : 'assets/characters/hero_walk.png';
    const row = fighting && !reducedMotion ? 1 : walking && !reducedMotion ? (returning ? 4 : 2) : 0;
    const column = row ? frame : returning ? 6 : 2;
    this.pawn.style.backgroundImage = `url("${path}")`;
    this.pawn.style.backgroundPosition = `${-column * 68}px ${-row * 68}px`;
    this.pawn.style.left = `${reducedMotion ? 40 : returning ? 45 - progress * 25 : mode === 'outbound' ? 15 + progress * 25 : 40}%`;
    const roomKind=mode==='exploring'?dungeonRoom(state.hero):state.hero.encounter?.kind??'normal';
    this.monster.hidden = ['spring','mystery'].includes(roomKind) || !scene.monsterId || !['exploring', 'fighting', 'victory'].includes(mode);
    this.scene.dataset.room=roomKind;
    this.scene.style.setProperty('--dungeon-darkness',String((100-(state.hero.dungeon?.light??100))/180));
    this.monster.dataset.kind = scene.monsterId ?? 'slime';
    const clip = reducedMotion ? 'idle' : mode === 'victory' ? 'down' : fighting
      ? (Math.floor(elapsed / 120) % 8 === 3 ? 'hit' : 'attack') : 'walk';
    const key = `${this.monster.dataset.kind}/${clip}`;
    const loaded = this.monsterAssets.get(key) === true;
    this.monster.classList.toggle('has-sprite', loaded);
    this.placeholder.hidden = loaded || this.scene.hidden || !scene.monsterId;
    const counts = { idle: 1, walk: 6, attack: 8, hit: 3, down: 6 };
    const columnMonster = clip === 'down' ? Math.min(5, Math.floor(elapsed / 140))
      : Math.floor(elapsed / (clip === 'hit' ? 100 : 120)) % counts[clip];
    this.monster.style.backgroundImage = loaded ? `url("assets/characters/dungeon/${key}.png")` : '';
    this.monster.style.backgroundPosition = loaded ? `${-columnMonster * 68}px 0px` : '';
    this.monster.dataset.down = String(mode === 'victory');
    // End the approach beside the sword, regardless of the strip's width.
    const approach = !reducedMotion && mode === 'exploring' ? progress : 1;
    this.monster.style.left = `calc(${94 - approach * 54}% + ${approach * 58}px)`;
    this.monster.style.transform = !reducedMotion && fighting ? `translateY(${Math.floor(elapsed / 180) % 2 ? -2 : 0}px)` : 'none';
    this.ground.style.backgroundPositionX = `${reducedMotion || !walking ? 0 : -Math.floor(elapsed / 30) % 32}px`;
  }

  dispose() { this.unsubscribe?.(); }
}
