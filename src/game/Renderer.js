import { heroTrainingPose } from './Hero.js';
import { RECIPES } from '../content/production.js';
import { TILE_SIZE, MAP_WIDTH, MAP_HEIGHT } from '../state/worldState.js';
import { cellKey } from './World.js';
import { Camera } from './Camera.js';
import { CameraTour } from './CameraTour.js';
import { COMBAT_PALETTE as BATTLE, COMBAT_VISUALS, DIRECTIONS, DEFENSE_VISUALS,
  EFFECT_VISUALS, defenseFrame, advanceCombatAnimation } from '../content/combatVisuals.js';
import { VILLAGER_VARIANT, SUPPLEMENTAL_IMAGES, SUPPLEMENTAL_SHEETS, villagerVariant } from '../content/productionVisuals.js';
import { daylight, spriteGeometry, spriteDepth, cullingMargin, renderQueryBounds,
  advanceMovement, paddedCharacterGeometry, facingDirection } from './Presentation.js';
import { defaultContent } from '../content/builtin.js';

// Compatibility exports for asset inspection. Runtime rendering uses the
// world's validated content catalog, including definitions added by a pack.
export const APPEARANCE = Object.freeze(Object.fromEntries(defaultContent.list().map(definition => [definition.id, definition.visual])));
export const CHARACTER_ANIMATIONS = Object.freeze(Object.fromEntries(defaultContent.list().filter(definition => definition.animation)
  .map(definition => [definition.id, definition.animation])));

export class Renderer {
  constructor(host, world) {
    this.host = host;
    this.world = world;
    this.content = world.content ?? defaultContent;
    this.definitions = this.content.list();
    this.queryMargin = cullingMargin(this.definitions, TILE_SIZE);
    this.camera = new Camera();
    this.cameraTour = new CameraTour();
    this.combatSprites = new Map();
    this.keys = new Set();
    this.textures = new Map();
    this.sprites = new Map();
    this.groundBounds = '';
    this.loadedArt = new Set();
    this.generatedTextures = new Set();
    this.visualTime = 0;
    this.pulses = [];
    this.reducedMotion = false;
    this.animations = new Map();
    this.sheetFrames = new Map();
    this.croppedTextures = new Set();
    this.effectSprites = new Map();
  }

  async init() {
    const PIXI = globalThis.PIXI;
    if (!PIXI?.tilemap?.CompositeTilemap) throw new Error('Rendering libraries did not load. Check your connection and reload.');
    this.app = new PIXI.Application({ width: this.host.clientWidth, height: this.host.clientHeight,
      backgroundColor: 0xefe6d4, antialias: false, resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true });
    this.app.stop(); // Game owns the single requestAnimationFrame loop.
    this.host.append(this.app.view);
    await Promise.all(this.definitions.map(async ({ id: type, visual: style }) => {
      let texture;
      if (style.path) {
        let timer;
        try {
          texture = await Promise.race([PIXI.Assets.load(style.path),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('asset_timeout')), 5000); })]);
          this.loadedArt.add(type);
        } catch { /* Optional art never prevents starting the game. */ }
        finally { clearTimeout(timer); }
      }
      if (!texture) {
        const graphic = new PIXI.Graphics();
        if (type === 'altar') {
          graphic.beginFill(0x5a665a).drawRect(4, 34, 56, 12).endFill();
          graphic.beginFill(0x9b9f85).drawRect(10, 22, 44, 16).endFill();
          graphic.beginFill(0xd7d2af).drawRect(5, 16, 54, 10).endFill();
          graphic.beginFill(0x677960).drawRect(10, 17, 44, 4).endFill();
          graphic.beginFill(0xf1d795).drawRect(29, 5, 6, 12).endFill();
          this.loadedArt.add(type);
        } else {
          graphic.beginFill(style.color).drawRect(0, 0, TILE_SIZE, TILE_SIZE).endFill();
          graphic.lineStyle(1, 0x101d16, 0.3).drawRect(0, 0, TILE_SIZE, TILE_SIZE);
        }
        texture = this.app.renderer.generateTexture(graphic);
        this.generatedTextures.add(texture);
        graphic.destroy();
      }
      texture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
      this.textures.set(type, texture);
    }));
    await Promise.all([
      ...this.definitions.filter(definition => definition.animation).map(({ id, animation }) => this.loadCharacterAnimation(id, animation)),
      this.loadCharacterAnimation('villager_b', VILLAGER_VARIANT),
      ...Object.entries(SUPPLEMENTAL_IMAGES).map(async ([id, path]) => {
        const texture = await this.loadOptionalTexture(path); if (texture) this.textures.set(id, texture);
      }),
      ...Object.entries(SUPPLEMENTAL_SHEETS).map(([id, config]) => this.loadSheet(id, config)),
      ...Object.entries(DEFENSE_VISUALS).map(([id, config]) => this.loadSheet(`work:${id}`, config)),
      ...Object.entries(EFFECT_VISUALS).map(([id, config]) => this.loadSheet(`effect:${id}`,
        { ...config, rows: config.directional ? 4 : 1 })),
      ...Object.entries(COMBAT_VISUALS).flatMap(([role, config]) => Object.entries(config.sides).flatMap(([side, paths]) => [
        this.loadCharacterAnimation(`${side}:${role}`, { path: paths.walk, width: config.frameWidth, height: config.frameHeight,
          duration: config.frameDurationsMs.walk / 1000, frames: config.frameCounts.walk,
          idleColumns: config.idleColumns, walkRows: config.walkRows }),
        ...['attack', 'hit', 'down'].map(action => this.loadSheet(`${side}:${role}:${action}`, {
          path: paths[action], width: config.frameWidth, height: config.frameHeight,
          frames: config.frameCounts[action], rows: 4, durationMs: config.frameDurationsMs[action] }))
      ]))
    ]);
    this.stage = new PIXI.Container();
    this.tiles = new PIXI.tilemap.CompositeTilemap();
    this.objects = new PIXI.Container();
    this.objects.sortableChildren = true;
    // Ground is batched underneath all depth-sorted buildings and characters.
    this.workLayer = new PIXI.Graphics();
    this.hazardLayer = new PIXI.Container(); this.hazardSprites = new Map();
    this.stage.addChild(this.tiles, this.workLayer, this.objects, this.hazardLayer);
    this.app.stage.addChild(this.stage);
    this.atmosphere = new PIXI.Graphics();
    this.pulseLayer = new PIXI.Graphics();
    this.combatEffects = new PIXI.Graphics();
    this.effectLayer = new PIXI.Container();
    this.receptionSprite = new PIXI.Sprite();
    this.receptionSprite.visible = false;
    this.rainLayer = new PIXI.Container();
    this.raindrops = Array.from({ length: 64 }, () => {
      const drop = new PIXI.Sprite(this.textures.get('rain_particle'));
      drop.width = 8; drop.height = 8; drop.alpha = 0.65; drop.visible = false;
      this.rainLayer.addChild(drop); return drop;
    });
    this.app.stage.addChild(this.atmosphere, this.rainLayer, this.receptionSprite, this.pulseLayer, this.combatEffects, this.effectLayer);
    this.resize();
    this.focusVillage(this.world.state.villages[0]?.id);
    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
  }

  async loadOptionalTexture(path) {
    let timer;
    try {
      const texture = await Promise.race([globalThis.PIXI.Assets.load(path),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('asset_timeout')), 5000); })]);
      texture.baseTexture.scaleMode = globalThis.PIXI.SCALE_MODES.NEAREST;
      return texture;
    } catch { return null; } finally { clearTimeout(timer); }
  }

  crop(sheet, column, row, width, height) {
    const frame = new globalThis.PIXI.Texture(sheet.baseTexture,
      new globalThis.PIXI.Rectangle(column * width, row * height, width, height));
    this.croppedTextures.add(frame);
    return frame;
  }

  async loadCharacterAnimation(id, config) {
    const sheet = await this.loadOptionalTexture(config.path);
    if (!sheet) return;
    try {
      const directions = Object.fromEntries(DIRECTIONS.map(direction => [direction, {
        idle: this.crop(sheet, config.idleColumns[direction], 0, config.width, config.height),
        walk: Array.from({ length: config.frames }, (_, frame) =>
          this.crop(sheet, frame, config.walkRows[direction], config.width, config.height))
      }]));
      this.animations.set(id, { config, directions });
    } catch { /* A malformed optional sheet falls back without blocking play. */ }
  }

  async loadSheet(id, config) {
    const sheet = await this.loadOptionalTexture(config.path);
    if (!sheet) return;
    try {
      const rows = Array.from({ length: config.rows ?? 1 }, (_, row) => Array.from({ length: config.frames }, (_, column) =>
        this.crop(sheet, column, row, config.width, config.height)));
      this.sheetFrames.set(id, { config, rows });
    } catch { /* Keep a readable procedural fallback for missing/bad sheets. */ }
  }

  resize() {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.app.renderer.resize(width, height);
    this.camera.resize(width, height);
  }

  focusVillage(id) {
    this.cameraTour.cancel();
    const village = this.world.getVillage(id);
    if (village) this.camera.center(village.anchor);
  }

  announceRaid(event) {
    const home = this.world.getVillage('home');
    if (home) this.cameraTour.start(event.id, event.position, home.anchor, this.camera,
      { reducedMotion: this.reducedMotion });
  }

  focusBattle() {
    this.cameraTour.cancel();
    const battle = this.world.state.combat;
    if (!battle?.entry) return;
    const living = battle.units.filter(unit => unit.hp > 0);
    // Follow the current clash, including enemies that have crossed the front.
    const center = living.length ? living.reduce((sum, unit) =>
      ({ x: sum.x + unit.position.x / living.length, y: sum.y + unit.position.y / living.length }), { x: 0, y: 0 })
      : battle.front ?? battle.entry;
    this.camera.center(center);
  }

  setMapLabel(label) { this.app?.view?.setAttribute('aria-label', label); }

  bindInput() {
    const signal = (this.inputAbort = new AbortController()).signal;
    const view = this.app.view;
    view.tabIndex = 0;
    view.setAttribute('aria-label', 'Village map. Drag to pan, or use arrow keys and WASD.');
    const handled = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'];
    view.addEventListener('keydown', event => {
      const key = event.key.toLowerCase();
      if (handled.includes(key)) { event.preventDefault(); this.cameraTour.cancel(); this.keys.add(key); }
    }, { signal });
    view.addEventListener('keyup', event => this.keys.delete(event.key.toLowerCase()), { signal });
    view.addEventListener('blur', () => this.keys.clear(), { signal });
    window.addEventListener('blur', () => { this.keys.clear(); this.drag = null; }, { signal });
    view.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      this.cameraTour.cancel();
      view.focus();
      view.setPointerCapture(event.pointerId);
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }, { signal });
    view.addEventListener('pointermove', event => {
      if (!this.drag || this.drag.id !== event.pointerId) return;
      this.camera.pan((this.drag.x - event.clientX) / TILE_SIZE, (this.drag.y - event.clientY) / TILE_SIZE);
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }, { signal });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      view.addEventListener(event, () => { this.drag = null; }, { signal });
    }
  }

  render(elapsedMs) {
    this.visualTime += elapsedMs / 1000;
    if (this.reducedMotion || this.keys.size || this.drag) this.cameraTour.cancel();
    this.cameraTour.update(elapsedMs, this.camera);
    const speed = elapsedMs * 0.015;
    this.camera.pan(speed * (Number(this.keys.has('arrowright') || this.keys.has('d'))
      - Number(this.keys.has('arrowleft') || this.keys.has('a'))),
    speed * (Number(this.keys.has('arrowdown') || this.keys.has('s'))
      - Number(this.keys.has('arrowup') || this.keys.has('w'))));
    const { left, top, right, bottom } = this.camera.bounds;
    const signature = `${left},${top},${right},${bottom},${this.world.state.groundRevision ?? 0}`;
    // Only viewport cells are queried, even when ground tiles cover more world.
    if (signature !== this.groundBounds) {
      this.tiles.clear();
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        this.tiles.tile(this.textures.get('ground'), (x - left) * TILE_SIZE, (y - top) * TILE_SIZE);
        const ground = this.world.state.groundTiles?.get(cellKey(x, y));
        const texture = ground && this.textures.get(ground.type);
        if (texture) this.tiles.tile(texture, (x - left) * TILE_SIZE, (y - top) * TILE_SIZE);
        if (ground?.type.startsWith('ford_') && this.textures.get('river_stones'))
          this.tiles.tile(this.textures.get('river_stones'), (x - left) * TILE_SIZE, (y - top) * TILE_SIZE);
      }
      this.groundBounds = signature;
    }
    this.stage.position.set((left - this.camera.x) * TILE_SIZE, (top - this.camera.y) * TILE_SIZE);
    const visible = new Set();
    // Query visible cells, not the building/entity collections or the full world.
    // Catalog-derived margins include roofs, tree crowns and animated frames.
    const query = renderQueryBounds(this.camera.bounds, this.queryMargin, MAP_WIDTH, MAP_HEIGHT);
    for (let y = query.top; y < query.bottom; y++) for (let x = query.left; x < query.right; x++) {
      const object = this.world.state.occupied.get(cellKey(x, y));
      if (!object || object.hidden || visible.has(object.id)) continue;
      const definition = this.content.get(object.type);
      if (!definition) continue;
      visible.add(object.id);
      let sprite = this.sprites.get(object.id);
      if (!sprite) {
        sprite = new globalThis.PIXI.Sprite(this.textures.get(object.type));
        this.sprites.set(object.id, sprite);
        this.objects.addChild(sprite);
      }
      const pawn = definition.kind === 'entity';
      if (pawn) sprite.motion = advanceMovement(sprite.motion, object.position, elapsedMs,
        { cellMs: object.moveDurationMs ?? 450, reducedMotion: this.reducedMotion });
      sprite.visualPosition = pawn ? sprite.motion.position : object.position;
      let box = spriteGeometry(object, this.loadedArt.has(object.type), definition);
      const animation = this.animations.get(villagerVariant(object)) ?? this.animations.get(object.type);
      sprite.texture = object.type === 'farmland' && this.world.getVillage(object.villageId)?.weather === 'drought'
        ? this.textures.get('farmlandDry') ?? this.textures.get(object.type) : this.textures.get(object.type);
      if (object.type === 'farmland' && this.world.getVillage(object.villageId)?.weather === 'cold') sprite.texture = this.textures.get('farmlandSnow') ?? sprite.texture;
      if (object.damage > 0) sprite.texture = this.textures.get(`damage:${object.type}:${object.damage >= 100 ? 'ruins' : 'damaged'}`) ?? sprite.texture;
      if (animation) {
        sprite.facing = sprite.motion?.facing ?? 'south';
        if (object.activity === 'oracle' && object.facing && !sprite.motion?.moving) sprite.facing = object.facing;
        const direction = animation.directions[sprite.facing];
        sprite.texture = !this.reducedMotion && sprite.motion?.moving
          ? direction.walk[Math.floor(sprite.motion.walkElapsedMs / (animation.config.duration * 1000)) % animation.config.frames]
          : direction.idle;
        box = paddedCharacterGeometry(animation.config.width, animation.config.height, spriteGeometry(object, true, definition));
        const receiving = object.type === 'priest' && !sprite.motion?.moving
          && ['receiving', 'interpreting'].includes(this.oracleState?.stage);
        const receive = this.sheetFrames.get('receive');
        if (receiving && receive) {
          sprite.receiveStart ??= this.visualTime;
          const index = this.reducedMotion ? 0 : Math.min(receive.config.frames - 1,
            Math.floor((this.visualTime - sprite.receiveStart) * 1000 / receive.config.durationMs));
          sprite.texture = receive.rows[0][index];
        } else delete sprite.receiveStart;
      }
      if (object.type === 'hero' && !this.reducedMotion && !sprite.motion?.moving) {
        const pose = heroTrainingPose(this.world.state.hero);
        const clip = this.sheetFrames.get({guard:'heroGuard', slash:'heroAttack', thrust:'heroThrust'}[pose.action]);
        if (clip) sprite.texture = clip.rows[0][Math.min(clip.config.frames - 1, Math.floor(pose.elapsedMs / clip.config.durationMs))];
      }
      const bob = pawn && !animation && !this.reducedMotion && sprite.motion.moving
        ? Math.sin(sprite.motion.walkElapsedMs / 100) : 0;
      sprite.position.set(Math.round((sprite.visualPosition.x - left) * TILE_SIZE + box.dx),
        Math.round((sprite.visualPosition.y - top) * TILE_SIZE + box.dy + bob));
      sprite.width = box.width;
      sprite.height = box.height;
      sprite.zIndex = spriteDepth(object, sprite.visualPosition, definition);
      sprite.tint = definition.visual.tint ?? 0xffffff;
    }
    for (const [id, sprite] of this.sprites) {
      if (!visible.has(id)) { sprite.destroy(); this.sprites.delete(id); }
    }
    this.visibleCellCount = (right - left) * (bottom - top);
    this.renderCombat(left, top, elapsedMs);
    this.renderRegions(left, top, right, bottom);
    this.renderAtmosphere();
    this.app.renderer.render(this.app.stage);
  }

  renderRegions(left, top, right, bottom) {
    if (!this.workLayer) return;
    const graphics = this.workLayer; graphics.clear(); const visible = new Set();
    const inView = p => p.x >= left - 6 && p.x < right && p.y >= top - 6 && p.y < bottom;
    for (const job of this.world.state.production?.jobs ?? []) {
      if (job.status !== 'working') continue;
      const recipe = job.recipe ?? this.world.content?.recipes?.[job.recipeId] ?? RECIPES[job.recipeId];
      if(!recipe)continue;
      const workshop = [...this.world.state.buildings.values()].find(b => b.type === recipe.buildingTag && (b.damage ?? 0) < 100);
      if (!workshop || !inView(workshop.position)) continue;
      const x = (workshop.position.x - left) * TILE_SIZE, y = (workshop.position.y - top + workshop.footprint.h) * TILE_SIZE;
      const width = workshop.footprint.w * TILE_SIZE;
      graphics.lineStyle(0).beginFill(0x252b33, .95).drawRect(x, y + 3, width, 6).endFill();
      graphics.beginFill(0xe2bb76).drawRect(x, y + 3, width * (job.completed + job.progress / recipe.workSeconds) / job.count, 6).endFill();
    }
    for (const job of this.world.state.work?.jobs ?? []) if (job.status === 'working' && inView(job.position)) {
      const x = (job.position.x - left) * TILE_SIZE, y = (job.position.y - top) * TILE_SIZE;
      graphics.lineStyle(2, 0xe2bb76).beginFill(0xb89657, .16).drawRect(x, y, job.footprint.w * TILE_SIZE, job.footprint.h * TILE_SIZE).endFill();
      graphics.lineStyle(0).beginFill(0xe2bb76).drawRect(x, y, job.footprint.w * TILE_SIZE * job.progress / job.required, 4).endFill();
    }
    for (const plan of this.world.state.eventQueue ?? []) {
      if (!['fire','flood','cold'].includes(plan.kind) || !['forecast','active'].includes(plan.stage)) continue;
      const color = plan.kind === 'fire' ? 0xec9954 : plan.kind === 'flood' ? 0x72b4d3 : 0xc4dae5;
      for (const item of (plan.exposure ?? []).slice(0,24)) {
        if (!inView(item.position)) continue;
        const object = this.world.state.buildings.get(item.id) ?? this.world.state.terrain.get(item.id);
        if (!object) continue;
        const x = (item.position.x-left)*TILE_SIZE, y=(item.position.y-top)*TILE_SIZE;
        graphics.lineStyle(1,color,.7).beginFill(color,plan.stage==='active'?.22:.06).drawRect(x,y,object.footprint.w*TILE_SIZE,object.footprint.h*TILE_SIZE).endFill();
        if (plan.stage !== 'active') continue;
        const sheet = this.sheetFrames.get(plan.kind === 'fire' ? 'hazardFire' : plan.kind === 'flood' ? 'hazardFlood' : '');
        if (!sheet || (plan.kind === 'fire' && plan.burningIds && !plan.burningIds.includes(item.id))) continue;
        const id = `${plan.id}:${item.id}`; visible.add(id);
        let sprite = this.hazardSprites.get(id);
        if (!sprite) { sprite = new globalThis.PIXI.Sprite(); this.hazardSprites.set(id,sprite); this.hazardLayer.addChild(sprite); }
        sprite.texture = sheet.rows[0][this.reducedMotion ? 0 : Math.floor(this.visualTime*1000/sheet.config.durationMs)%sheet.config.frames];
        sprite.position.set(x,y); sprite.width=32;sprite.height=32;
      }
    }
    for (const [id,sprite] of this.hazardSprites) if (!visible.has(id)) { sprite.destroy();this.hazardSprites.delete(id); }
  }

  renderCombat(left, top, elapsedMs) {
    if (!this.combatEffects) return;
    const combat = this.world.state.combat;
    const visible = new Set();
    // Dedicated encounter lists are capped at 12 actors / 12 works, independent
    // of population and world size. Ordinary decorative pawns never join them.
    for (const item of [...(combat?.works ?? []), ...(combat?.units ?? [])]) {
      if (item.hidden) continue;
      const { x, y } = item.position;
      if (x < left - 2 || y < top - 1 || x > left + this.camera.width + 2 || y > top + this.camera.height + 2) continue;
      visible.add(item.id);
      let graphic = this.combatSprites.get(item.id);
      if (!graphic) {
        graphic = new globalThis.PIXI.Graphics();
        this.combatSprites.set(item.id, graphic);
        this.objects.addChild(graphic);
      }
      graphic.clear();
      if (item.role) graphic.motion = advanceMovement(graphic.motion, item.position, elapsedMs,
        { cellMs: item.moveDurationMs ?? 900, reducedMotion: this.reducedMotion || item.hp <= 0 });
      graphic.visualPosition = item.role ? graphic.motion.position : item.position;
      graphic.position.set(Math.round((graphic.visualPosition.x - left) * TILE_SIZE),
        Math.round((graphic.visualPosition.y - top) * TILE_SIZE));
      graphic.zIndex = item.type === 'trap' ? -0.5 : graphic.visualPosition.y + 1;
      if (item.role) {
        graphic.actionTrack = advanceCombatAnimation(graphic.actionTrack, item, elapsedMs);
        if (!this.drawCombatArt(graphic, item, combat)) this.drawCombatant(graphic, item);
      } else if (!this.drawDefenseArt(graphic, item)) this.drawDefenseWork(graphic, item);
    }
    for (const [id, graphic] of this.combatSprites) if (!visible.has(id)) {
      graphic.destroy({ children: true }); this.combatSprites.delete(id);
    }
    const effect = this.combatEffects.clear();
    const effectIds = new Set();
    for (const event of combat?.effects ?? []) {
      if (event.expiresAt <= this.world.state.time) continue;
      const x = (event.from.x - this.camera.x) * TILE_SIZE + 16;
      const y = (event.from.y - this.camera.y) * TILE_SIZE + 6;
      const tx = (event.to.x - this.camera.x) * TILE_SIZE + 16;
      const ty = (event.to.y - this.camera.y) * TILE_SIZE + 6;
      if (Math.max(x, tx) < -64 || Math.min(x, tx) > this.app.screen.width + 64
        || Math.max(y, ty) < -64 || Math.min(y, ty) > this.app.screen.height + 64) continue;
      effectIds.add(event.id);
      if (this.drawEffectArt(event, { x, y, tx, ty }, elapsedMs)) continue;
      const progress = this.reducedMotion ? 1 : Math.min(1, Math.max(0,
        (this.world.state.time - event.createdAt + (this.visualTime % 1)) / Math.max(1, event.expiresAt - event.createdAt)));
      if (event.type === 'arrow') {
        const px = x + (tx - x) * progress, py = y + (ty - y) * progress;
        const angle = Math.atan2(ty - y, tx - x);
        effect.lineStyle(2, BATTLE.linen, 0.95).moveTo(px - Math.cos(angle) * 12, py - Math.sin(angle) * 12).lineTo(px, py);
        effect.beginFill(BATTLE.ink).drawCircle(px, py, 2).endFill();
      } else if (event.type === 'spell') {
        effect.lineStyle(2, BATTLE.magic, 0.8).moveTo(x, y).lineTo(tx, ty);
        effect.lineStyle(3, BATTLE.linen, 0.9).drawCircle(tx, ty, 8 + progress * 16);
        effect.beginFill(BATTLE.magic, 0.22).drawCircle(tx, ty, 24).endFill();
      } else if (event.type === 'slash') {
        effect.lineStyle(3, BATTLE.linen, 0.9).moveTo(tx - 10, ty + 8).lineTo(tx + 12, ty - 12);
      } else {
        effect.lineStyle(2, BATTLE.enemy, 0.9).drawCircle(tx, ty, 7 + progress * 10);
        effect.lineStyle(2, BATTLE.gold).moveTo(tx - 9, ty - 9).lineTo(tx + 9, ty + 9)
          .moveTo(tx + 9, ty - 9).lineTo(tx - 9, ty + 9);
      }
    }
    for (const [id, sprite] of this.effectSprites) if (!effectIds.has(id)) {
      sprite.destroy(); this.effectSprites.delete(id);
    }
  }

  artChild(graphic, texture, property = 'artSprite') {
    if (!graphic[property]) {
      graphic[property] = new globalThis.PIXI.Sprite(texture);
      graphic.addChild(graphic[property]);
    }
    graphic[property].texture = texture;
    graphic[property].visible = true;
    return graphic[property];
  }

  drawCombatArt(graphic, unit, combat) {
    const key = unit.isHero ? 'hero' : `${unit.side === 'enemy' ? 'enemy' : 'home'}:${unit.role}`;
    const animation = this.animations.get(key);
    if (!animation) return false;
    const config = COMBAT_VISUALS[unit.role];
    const target = combat.units.find(candidate => candidate.id === unit.targetId);
    let facing = unit.hp <= 0 ? graphic.facing ?? graphic.motion?.facing ?? 'south' : graphic.motion?.facing ?? 'south';
    if (unit.hp > 0 && !graphic.motion?.moving && target) facing = facingDirection(unit.position, target.position, facing);
    graphic.facing = facing;
    const direction = animation.directions[facing];
    let texture = !this.reducedMotion && graphic.motion?.moving
      ? direction.walk[Math.floor(graphic.motion.walkElapsedMs / (animation.config.duration * 1000)) % animation.config.frames]
      : direction.idle;
    const action = graphic.actionTrack.action;
    const clip = this.sheetFrames.get(unit.isHero ? action === 'attack' ? 'heroAttack' : action === 'hit' ? 'heroGuard' : '' : `${key}:${action}`);
    if (clip && (!this.reducedMotion || action === 'down')) {
      const index = this.reducedMotion ? clip.config.frames - 1 : Math.min(clip.config.frames - 1,
        Math.floor(graphic.actionTrack.elapsedMs / clip.config.durationMs));
      texture = clip.rows[DIRECTIONS.indexOf(facing)][index];
    }
    const sprite = this.artChild(graphic, texture);
    sprite.position.set(16 - config.pivot.x, 32 - config.pivot.y);
    sprite.width = config.frameWidth; sprite.height = config.frameHeight;
    sprite.alpha = unit.hp <= 0 && unit.isHero ? 0.5 : 1;
    // The badge is outside the silhouette so cloaks/weapons cannot hide side.
    const badge = this.sheetFrames.get('badges');
    if (badge) {
      const symbol = this.artChild(graphic, badge.rows[0][unit.side === 'enemy' ? 1 : unit.side === 'ally' ? 2 : 0], 'badgeSprite');
      symbol.position.set(8, -38); symbol.width = 16; symbol.height = 16;
      symbol.visible = unit.hp > 0;
    }
    if (unit.hp > 0) {
      graphic.beginFill(BATTLE.ink).drawRect(3, -21, 26, 4).endFill();
      graphic.beginFill(BATTLE[unit.side] ?? BATTLE.home).drawRect(4, -20, 24 * unit.hp / unit.maxHp, 2).endFill();
      if (unit.status === 'stunned') graphic.lineStyle(2, BATTLE.gold).drawCircle(16, -27, 5);
    }
    return true;
  }

  drawDefenseArt(graphic, work) {
    const sheet = this.sheetFrames.get(`work:${work.type}`);
    if (!sheet) return false;
    const sprite = this.artChild(graphic, sheet.rows[0][defenseFrame(work)]);
    sprite.position.set(16 - sheet.config.pivot.x, 32 - sheet.config.pivot.y);
    sprite.width = sheet.config.width; sprite.height = sheet.config.height;
    return true;
  }

  drawEffectArt(event, points, elapsedMs) {
    const sheet = this.sheetFrames.get(`effect:${event.type}`);
    if (!sheet || !this.effectLayer) return false;
    let sprite = this.effectSprites.get(event.id);
    if (!sprite) {
      sprite = new globalThis.PIXI.Sprite(); sprite.ageMs = 0;
      this.effectSprites.set(event.id, sprite); this.effectLayer.addChild(sprite);
    } else sprite.ageMs += Math.max(0, Math.min(250, elapsedMs));
    const { config } = sheet;
    const projectile = event.type === 'arrow' || event.type === 'spell';
    const age = Math.max(0, sprite.ageMs - (projectile ? 250 : 0));
    const duration = projectile ? 550 : config.frames * config.durationMs;
    sprite.visible = !this.reducedMotion && sprite.ageMs >= (projectile ? 250 : 0) && age < duration;
    const row = config.directional ? DIRECTIONS.indexOf(facingDirection(event.from, event.to)) : 0;
    const frame = Math.floor(age / config.durationMs);
    sprite.texture = sheet.rows[row][config.loop ? frame % config.frames : Math.min(frame, config.frames - 1)];
    const progress = Math.min(1, age / duration);
    const x = projectile ? points.x + (points.tx - points.x) * progress : points.tx;
    const y = projectile ? points.y + (points.ty - points.y) * progress : points.ty;
    sprite.position.set(Math.round(x - config.pivot.x), Math.round(y - config.pivot.y));
    sprite.width = config.width; sprite.height = config.height;
    return true;
  }

  drawCombatant(g, unit) {
    if (!COMBAT_VISUALS[unit.role]) return;
    const accent = BATTLE[unit.side] ?? BATTLE.home;
    g.beginFill(BATTLE.ink, 0.25).drawEllipse(16, 30, 13, 5).endFill();
    if (unit.hp <= 0) {
      g.beginFill(accent, 0.7).drawRoundedRect(4, 21, 24, 8, 2).endFill();
      g.beginFill(BATTLE.skin).drawRect(24, 20, 7, 8).endFill();
      return;
    }
    const walking = g.motion?.moving && !this.reducedMotion;
    const step = walking ? Math.round(Math.sin(g.motion.walkElapsedMs / 110) * 3) : 0;
    g.beginFill(BATTLE.ink).drawRect(9, 20, 5, 10 + step).drawRect(19, 20, 5, 10 - step).endFill();
    g.beginFill(accent).drawRoundedRect(7, 0, 20, 23, 3).endFill();
    g.beginFill(BATTLE.skin).drawRect(11, -11, 12, 12).endFill();
    g.beginFill(BATTLE.ink).drawRect(12, -5, 2, 2).drawRect(20, -5, 2, 2).endFill();
    const strike = unit.status === 'attacking' ? 4 : 0;
    if (unit.role === 'swordsman') {
      g.beginFill(BATTLE.steel).drawRect(9, -16, 16, 7).drawRect(7, -10, 4, 9).endFill();
      g.beginFill(BATTLE.steel).drawRect(28, -6 - strike, 3, 27).endFill();
      g.beginFill(BATTLE.gold).drawRect(25, 15 - strike, 9, 3).endFill();
      g.lineStyle(2, BATTLE.steel).beginFill(accent).drawRoundedRect(0, 7, 11, 16, 3).endFill();
    } else if (unit.role === 'archer') {
      g.beginFill(BATTLE.ink).drawRect(10, -15, 14, 5).endFill();
      g.lineStyle(3, BATTLE.wood).moveTo(28, -2).lineTo(33 + strike, 10).lineTo(28, 24);
      g.lineStyle(1, BATTLE.linen).moveTo(28, -2).lineTo(26 - strike, 10).lineTo(28, 24);
      g.lineStyle(2, BATTLE.linen).moveTo(19, 11).lineTo(36, 11);
    } else if (unit.role === 'mage') {
      g.lineStyle(0).beginFill(BATTLE.magic).drawPolygon([6, 1, 26, 1, 30, 26, 3, 26]).endFill();
      g.beginFill(BATTLE.magic).drawPolygon([5, -10, 17, -24, 29, -10]).endFill();
      g.lineStyle(3, BATTLE.wood).moveTo(31, 27).lineTo(31, -9);
      g.lineStyle(1, BATTLE.linen).beginFill(BATTLE.magic).drawCircle(31, -11, 5).endFill();
    } else {
      g.lineStyle(0).beginFill(BATTLE.ink).drawRoundedRect(8, -17, 18, 11, 3).drawRect(10, -3, 15, 5).endFill();
      g.lineStyle(3, BATTLE.steel).moveTo(2, 18).lineTo(-2 - strike, 6).moveTo(30, 18).lineTo(35 + strike, 6);
    }
    // Side is represented by shape as well as color, over the unit's tunic.
    g.lineStyle(1, BATTLE.ink).beginFill(BATTLE.linen);
    if (unit.side === 'enemy') g.drawPolygon([12, 9, 16, 13, 20, 9, 20, 13, 16, 17, 12, 13]);
    else if (unit.side === 'ally') g.drawPolygon([16, 7, 21, 12, 16, 17, 11, 12]);
    else g.drawCircle(16, 12, 3);
    g.endFill().lineStyle(0).beginFill(BATTLE.ink).drawRect(3, -30, 26, 4).endFill();
    g.beginFill(accent).drawRect(4, -29, 24 * unit.hp / unit.maxHp, 2).endFill();
    if (unit.status === 'stunned') g.lineStyle(2, BATTLE.gold).drawCircle(16, -20, 6);
  }

  drawDefenseWork(g, work) {
    if (work.type === 'trap') {
      g.lineStyle(2, work.triggered || work.disarmed ? BATTLE.stone : BATTLE.wood)
        .beginFill(BATTLE.ink, 0.25).drawEllipse(16, 23, 12, 6).endFill();
      if (!work.disarmed) for (let i = 0; i < 3; i++) g.beginFill(BATTLE.steel)
        .drawPolygon([6 + i * 7, 24, 9 + i * 7, work.triggered ? 9 : 19, 12 + i * 7, 24]).endFill();
      return;
    }
    if (work.hp <= 0) {
      g.beginFill(BATTLE.wood).drawRect(2, 23, 11, 5).drawRect(18, 26, 12, 4).endFill(); return;
    }
    if (work.type === 'cover') {
      g.lineStyle(1, BATTLE.wood).beginFill(BATTLE.linen);
      for (let i = 0; i < 3; i++) g.drawRoundedRect(1 + i * 10, 17, 10, 11, 3);
      g.drawRoundedRect(6, 9, 11, 9, 3).drawRoundedRect(17, 9, 11, 9, 3).endFill();
    } else {
      g.lineStyle(2, BATTLE.ink).beginFill(BATTLE.wood);
      for (let i = 0; i < 3; i++) g.drawPolygon([2 + i * 11, 29, 2 + i * 11, 3, 6 + i * 11, -2, 10 + i * 11, 3, 10 + i * 11, 29]);
      g.endFill().lineStyle(3, BATTLE.gold).moveTo(0, 11).lineTo(32, 11).moveTo(0, 22).lineTo(32, 22);
    }
    if (work.hp < work.maxHp) g.lineStyle(2, BATTLE.ink).moveTo(15, 7).lineTo(11, 15).lineTo(18, 21);
  }

  showEvent(event) {
    const village = this.world.getVillage(event.target ?? event.actor);
    if (!village || !['create_rain', 'create_forest', 'increase_food', 'bless_village', 'curse_village',
      'prepare_defense', 'build_temple', 'build_house', 'farm', 'raid', 'drought', 'form_alliance'].includes(event.action)) return;
    this.pulses.push({ position: { ...(event.position ?? village.anchor) }, start: this.visualTime,
      color: ['raid', 'curse_village', 'drought'].includes(event.action) ? 0xeaa875 : 0xf0d68f });
    if (this.pulses.length > 12) this.pulses.shift();
  }

  renderAtmosphere() {
    const width = this.app.screen.width; const height = this.app.screen.height;
    this.atmosphere.clear().beginFill(0x11172e, daylight(this.visualTime).darkness).drawRect(0, 0, width, height).endFill();
    const villages = this.world.state.villages;
    const snow= villages.some(v=>v.weather==='cold');
    // Fixed particle count, independent of map area and population.
    this.raindrops.forEach((drop, i) => {
      const x = (i * 137.5 + this.visualTime * 24) % width;
      const y = (i * 83.7 + this.visualTime * (snow?35:170)) % height;
      const gx = this.camera.x + x / TILE_SIZE; const gy = this.camera.y + y / TILE_SIZE;
      drop.texture=snow?(this.sheetFrames.get('snow')?.rows[0][0]??this.textures.get('rain_particle')):this.textures.get('rain_particle');
      drop.visible = !this.reducedMotion && villages.some(v => ['rain','cold'].includes(v.weather ?? this.world.state.weather)
        && (gx - v.anchor.x) ** 2 + (gy - v.anchor.y) ** 2 <= v.settlementRadius ** 2);
      drop.position.set(Math.round(x), Math.round(y));
    });
    this.pulseLayer.clear();
    const ritual = this.oracleState;
    if (this.receptionSprite) this.receptionSprite.visible = false;
    if (ritual && ritual.stage !== 'idle' && ritual.target) {
      const x = (ritual.target.x - this.camera.x) * TILE_SIZE + 16;
      const y = (ritual.target.y - this.camera.y) * TILE_SIZE + 16;
      const receiving = ritual.stage === 'receiving' || ritual.stage === 'interpreting';
      const reception = this.sheetFrames.get('reception');
      if (receiving && reception && this.receptionSprite) {
        this.receptionStart ??= this.visualTime;
        const frame = this.reducedMotion ? 0 : Math.min(reception.config.frames - 1,
          Math.floor((this.visualTime - this.receptionStart) * 1000 / reception.config.durationMs));
        this.receptionSprite.texture = reception.rows[0][frame];
        this.receptionSprite.position.set(Math.round(x - 32), Math.round(y - 40));
        this.receptionSprite.width = 64; this.receptionSprite.height = 64;
        this.receptionSprite.visible = true;
      } else this.receptionStart = null;
      this.pulseLayer.lineStyle(receiving ? 3 : 2, 0xffe4a4, 0.9)
        .drawCircle(x, y, receiving ? 25 : 19);
      if (receiving && !reception && !this.reducedMotion) {
        for (let i = 0; i < 8; i++) {
          const angle = i * Math.PI / 4 + this.visualTime;
          this.pulseLayer.beginFill(0xffe4a4, 0.7).drawRect(x + Math.cos(angle) * 28, y - 12 + Math.sin(angle) * 16, 3, 3).endFill();
        }
      }
    } else this.receptionStart = null;
    for (const village of villages) {
      const x = (village.anchor.x - this.camera.x) * TILE_SIZE;
      const y = (village.anchor.y - this.camera.y) * TILE_SIZE;
      if (x < -64 || y < -64 || x > width + 64 || y > height + 64) continue;
      if (village.crisis || (village.defenseUntil ?? 0) >= this.world.state.time && village.defenseUntil > 0) {
        this.pulseLayer.lineStyle(2, village.crisis ? 0xeaa875 : 0xa8d8cf, 0.8).drawCircle(x + 16, y + 16, 28);
      }
    }
    this.pulses = this.pulses.filter(pulse => this.visualTime - pulse.start < 1.5);
    if (!this.reducedMotion) for (const pulse of this.pulses) {
      const age = this.visualTime - pulse.start;
      const x = (pulse.position.x - this.camera.x) * TILE_SIZE + 16;
      const y = (pulse.position.y - this.camera.y) * TILE_SIZE + 16;
      this.pulseLayer.lineStyle(2, pulse.color, 1 - age / 1.5).drawCircle(x, y, 10 + age * 32);
    }
  }

  destroy() {
    this.inputAbort?.abort();
    this.resizeObserver?.disconnect();
    this.app?.destroy(true, { children: true, texture: false, baseTexture: false });
    for (const texture of this.croppedTextures) texture.destroy(false);
    // Loaded textures belong to Pixi's shared asset cache; only dispose our fallbacks.
    for (const texture of this.generatedTextures) texture.destroy(true);
  }
}
