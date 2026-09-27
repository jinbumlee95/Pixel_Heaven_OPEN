// Additional presentation only: these never introduce simulation entities.
export const VILLAGER_VARIANT = Object.freeze({ path: 'assets/characters/villager_b/walk.png',
  width: 68, height: 68, duration: 0.12, frames: 6,
  idleColumns: Object.freeze({ south: 0, east: 2, north: 4, west: 6 }),
  walkRows: Object.freeze({ south: 1, east: 2, north: 3, west: 4 }) });
export const SUPPLEMENTAL_SHEETS = Object.freeze({
  snow: Object.freeze({path:'assets/ui/snow_particle.png',width:8,height:8,frames:1,durationMs:100}),
  hazardFire: Object.freeze({ path: 'assets/ui/fire_loop.png', width: 32, height: 32, frames: 6, durationMs: 120 }),
  hazardFlood: Object.freeze({ path: 'assets/tiles/flood_edge.png', width: 32, height: 32, frames: 8, durationMs: 100 }),
  receive: Object.freeze({ path: 'assets/characters/priest_receive-production/receive.png', width: 68, height: 68, frames: 6, durationMs: 120 }),
  heroThrust: Object.freeze({ path: 'assets/characters/hero-production/thrust.png', width: 68, height: 68, frames: 8, rows: 4, durationMs: 120 }),
  heroGuard: Object.freeze({ path: 'assets/characters/hero-production/guard.png', width: 68, height: 68, frames: 8, rows: 4, durationMs: 120 }),
  heroAttack: Object.freeze({ path: 'assets/characters/hero-production/slash.png', width: 68, height: 68, frames: 8, rows: 4, durationMs: 120 }),
  badges: Object.freeze({ path: 'assets/ui/combat/side_badges.png', width: 16, height: 16, frames: 3 }),
  reception: Object.freeze({ path: 'assets/ui/worldtree-reception.png', width: 64, height: 64, frames: 6, durationMs: 140 }),
});
export const SUPPLEMENTAL_IMAGES = Object.freeze({
  'damage:house:damaged': 'assets/tiles/house_v2_damaged.png',
  'damage:house:ruins': 'assets/tiles/house_v2_ruins.png',
  'damage:temple:damaged': 'assets/tiles/temple_v2_damaged.png',
  'damage:temple:ruins': 'assets/tiles/temple_v2_ruins.png',
  farmlandSnow: 'assets/tiles/farmland_snow.png',
  farmlandDry: 'assets/tiles/farmland_dry.png',
});

export function villagerVariant(object) {
  if (object.type !== 'villager') return object.type;
  if (object.visualVariant === 'a' || object.visualVariant === 'b') return object.visualVariant === 'a' ? 'villager' : 'villager_b';
  const hash = Array.from(String(object.id)).reduce((sum, char) => (sum + char.charCodeAt(0)) % 2, 0);
  return hash ? 'villager_b' : 'villager';
}
