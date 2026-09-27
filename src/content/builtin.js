import { createContentRegistry } from './ContentRegistry.js';

const definition = (id, kind, w, h, path, color, width, height, extra = {}) => ({
  id, kind, labelKey: `content.${id}`, footprint: { w, h },
  visual: { path, color, width, height, anchorX: 0.5, anchorY: 1, ...extra },
});

// Occupancy and draw dimensions are deliberately separate: a roof may extend
// above its foundation. Tile size remains 32px; character art keeps its size.
export const builtinPack = {
  schemaVersion: 1,
  id: 'core',
  definitions: [
    definition('ground', 'ground', 1, 1, 'assets/tiles/landscape/river_15.png', 0x78894e, 32, 32, { ground: true }),
    ...Array.from({ length: 15 }, (_, mask) => definition(`river_${mask}`, 'ground', 1, 1,
      `assets/tiles/landscape/river_${mask}.png`, 0x328f96, 32, 32, { ground: true })),
    ...Array.from({ length: 15 }, (_, mask) => definition(`ford_${mask}`, 'ground', 1, 1,
      `assets/tiles/landscape/river_${mask}.png`, 0x328f96, 32, 32, { ground: true })),
    definition('river_stones', 'ground', 1, 1, 'assets/tiles/landscape/ford.png', 0x89917d, 32, 32, { ground: true }),
    definition('pine', 'terrain', 1, 1, 'assets/tiles/landscape/pine.png', 0x4b6744, 64, 96),
    definition('mountain', 'terrain', 3, 2, 'assets/tiles/landscape/mountain.png', 0x6f7578, 160, 160),
    definition('stone_paving', 'ground', 1, 1, 'assets/tiles/sanctuary-path.png', 0x8a9273, 32, 32, { ground: true }),
    definition('house', 'building', 3, 2, 'assets/tiles/house_v2.png', 0xc29264, 96, 96),
    definition('smelter', 'building', 3, 2, 'assets/tiles/workshops/smelter.png', 0x8e8172, 128, 128, { anchorY: 123 / 128 }),
    definition('weaver', 'building', 3, 2, 'assets/tiles/workshops/weaver.png', 0xaa9474, 128, 128, { anchorY: 115 / 128 }),
    ...Object.entries({smith:121,warehouse:114,sawmill:119,apothecary:120,kitchen:120}).map(([id,pivot])=>definition(id,'building',3,2,`assets/tiles/workshops/${id}.png`,0xaa9474,128,128,{anchorY:pivot/128})),
    definition('town_hall', 'building', 6, 4, 'assets/tiles/town_hall.png', 0x9ca9b7, 192, 192),
    definition('temple', 'building', 6, 4, 'assets/tiles/temple_v2.png', 0xc7bdd8, 192, 192),
    definition('forest', 'terrain', 1, 1, 'assets/tiles/forest_v2.png', 0x427b50, 64, 64),
    definition('farmland', 'terrain', 1, 1, 'assets/tiles/farmland.png', 0xa7974a, 32, 32, { ground: true }),
    definition('world_tree', 'terrain', 6, 4, 'assets/tiles/world-tree-v2.png', 0x52794b, 320, 352),
    definition('altar', 'building', 2, 1, 'assets/tiles/oracle-altar.png', 0xb3b5a0, 64, 48),
    { ...definition('priest', 'entity', 1, 1, 'assets/characters/priest.png', 0xf0da95, 32, 48),
      animation: { path: 'assets/characters/priest/spritesheet/Marin-inspired_sun_pries-Idle.png',
        width: 68, height: 68, duration: 0.12, frames: 6,
        idleColumns: { south: 0, east: 2, north: 4, west: 6 },
        walkRows: { south: 5, east: 6, north: 7, west: 8 } } },
    { ...definition('villager', 'entity', 1, 1, null, 0x78b8c8, 32, 48),
      animation: { path: 'assets/characters/villager_a/walk.png', width: 68, height: 68,
        duration: 0.12, frames: 6, idleColumns: { south: 0, east: 2, north: 4, west: 6 },
        walkRows: { south: 1, east: 2, north: 3, west: 4 } } },
    { ...definition('hero', 'entity', 1, 1, 'assets/characters/hero.png', 0x65758f, 32, 48),
      animation: { path: 'assets/characters/hero_walk.png', width: 68, height: 68,
        duration: 0.12, frames: 6, idleColumns: { south: 0, east: 2, north: 4, west: 6 },
        walkRows: { south: 1, east: 2, north: 3, west: 4 } } },
    { ...definition('merchant', 'entity', 1, 1, 'assets/characters/merchant.png', 0xa99d7c, 32, 48),
      animation: { path: 'assets/characters/merchant/walk.png', width: 68, height: 68, duration: 0.12, frames: 6,
        idleColumns: { south: 0, east: 2, north: 4, west: 6 }, walkRows: { south: 1, east: 2, north: 3, west: 4 } } },
    { ...definition('pack_donkey', 'entity', 1, 1, 'assets/characters/pack_donkey.png', 0xa99d7c, 32, 32),
      animation: { path: 'assets/characters/pack_donkey/walk.png', width: 44, height: 44, duration: 0.12, frames: 6,
        idleColumns: { south: 0, east: 2, north: 4, west: 6 }, walkRows: { south: 1, east: 2, north: 3, west: 4 } } },
    { ...definition('sheep', 'entity', 1, 1, 'assets/characters/sheep.png', 0xa99d7c, 32, 32),
      animation: { path: 'assets/characters/sheep/walk.png', width: 40, height: 40, duration: 0.12, frames: 6,
        idleColumns: { south: 0, east: 2, north: 4, west: 6 }, walkRows: { south: 1, east: 2, north: 3, west: 4 } } },
    { ...definition('wolf', 'entity', 1, 1, 'assets/characters/wolf.png', 0xa99d7c, 32, 32),
      animation: { path: 'assets/characters/wolf/walk.png', width: 40, height: 40, duration: 0.12, frames: 6,
        idleColumns: { south: 0, east: 2, north: 4, west: 6 }, walkRows: { south: 1, east: 2, north: 3, west: 4 } } },
    { ...definition('deer', 'entity', 1, 1, 'assets/characters/deer.png', 0xa99d7c, 32, 32),
      animation: { path: 'assets/characters/deer/walk.png', width: 48, height: 48, duration: 0.12, frames: 6,
        idleColumns: { south: 0, east: 2, north: 4, west: 6 }, walkRows: { south: 1, east: 2, north: 3, west: 4 } } },
    definition('rain_particle', 'effect', 1, 1, 'assets/ui/rain_particle.png', 0xa6d8ee, 8, 8),
  ],
};

export const defaultContent = createContentRegistry([builtinPack]);

// Exported base data is safe to share with callers building a composed catalog.
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
freeze(builtinPack);
