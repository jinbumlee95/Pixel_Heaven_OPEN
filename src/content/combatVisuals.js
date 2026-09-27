// Runtime adapters for the delivered PixelLab sheets. Source manifests remain
// unchanged; tests compare these frame contracts to the delivered metadata.
export const COMBAT_PALETTE = Object.freeze({ ink: 0x2e342f, linen: 0xe9ddc6,
  steel: 0xbac4c1, home: 0x7f9b86, enemy: 0xb46f55, ally: 0xdec58b,
  magic: 0x9285a7, gold: 0xaf9254, wood: 0x896849, stone: 0x9a9b88, skin: 0xd1a382 });
export const DIRECTIONS = Object.freeze(['south', 'east', 'north', 'west']);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export const COMBAT_VISUALS = freeze(Object.fromEntries(['swordsman', 'archer', 'mage', 'rogue'].map(role => [role, {
  width: 32, height: 48, frameWidth: 68, frameHeight: 68, pivot: { x: 34, y: 58 },
  manifest: `assets/characters/combat-v2/${role}/frames.json`,
  idleColumns: { south: 0, east: 2, north: 4, west: 6 }, walkRows: { south: 1, east: 2, north: 3, west: 4 },
  frameCounts: { walk: 6, attack: 8, hit: 4, down: 6 },
  frameDurationsMs: { walk: 120, attack: role === 'rogue' ? 90 : role === 'mage' ? 120 : 100, hit: 100, down: 140 },
  sides: Object.fromEntries(['home', 'enemy'].map(side => [side, Object.fromEntries(
    ['walk', 'attack', 'hit', 'down'].map(action => [action,
      `assets/characters/combat-v2/${role}/${action === 'walk' ? 'idle_walk' : action}.png`]))]))
}])));

export const DEFENSE_VISUALS = freeze(Object.fromEntries(['cover', 'barricade', 'trap'].map(type => [type, {
  path: `assets/tiles/combat-v2/${type}_states.png`, width: 48, height: 48,
  frames: 3, pivot: { x: 24, y: 42 }
}])));
export const EFFECT_VISUALS = freeze({
  arrow: { path: 'assets/ui/combat/arrow.png', width: 16, height: 16, frames: 2, durationMs: 80, directional: true, loop: true, pivot: { x: 8, y: 8 } },
  spell: { path: 'assets/ui/combat/spell.png', width: 32, height: 32, frames: 6, durationMs: 90, loop: true, pivot: { x: 16, y: 16 } },
  slash: { path: 'assets/ui/combat/slash.png', width: 32, height: 32, frames: 4, durationMs: 70, pivot: { x: 16, y: 16 } },
  trap: { path: 'assets/ui/combat/trap.png', width: 32, height: 32, frames: 4, durationMs: 80, pivot: { x: 16, y: 16 } },
  breach: { path: 'assets/ui/combat/breach.png', width: 48, height: 48, frames: 5, durationMs: 90, pivot: { x: 24, y: 48 } },
});

export function defenseFrame(work) {
  return work.type === 'trap' ? work.disarmed ? 2 : work.triggered ? 1 : 0
    : work.hp <= 0 ? 2 : work.hp < work.maxHp ? 1 : 0;
}

// Only presentation history lives here. Simulation HP, attack clocks and grid
// positions are read-only; an attack clip is played once per committed attack.
export function advanceCombatAnimation(previous, unit, elapsedMs) {
  const next = { action: previous?.action ?? 'idle', elapsedMs: (previous?.elapsedMs ?? 0)
    + Math.max(0, Math.min(250, Number(elapsedMs) || 0)), hp: unit.hp, attackStamp: unit.nextAttackAt };
  if (unit.hp <= 0) {
    if (previous?.action !== 'down') { next.action = 'down'; next.elapsedMs = 0; }
  } else if (previous && unit.hp < previous.hp) {
    next.action = 'hit'; next.elapsedMs = 0;
  } else if (unit.status === 'attacking' && (!previous || previous.attackStamp !== unit.nextAttackAt)) {
    next.action = 'attack'; next.elapsedMs = 0;
  }
  const config = COMBAT_VISUALS[unit.role];
  const duration = unit.isHero && next.action === 'attack' ? 8 * 120
    : (config?.frameCounts[next.action] ?? 0) * (config?.frameDurationsMs[next.action] ?? 0);
  if (next.action !== 'down' && next.elapsedMs >= duration) next.action = 'idle';
  return next;
}
