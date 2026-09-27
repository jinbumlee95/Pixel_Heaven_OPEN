import { defaultContent } from '../content/builtin.js';
import { RESOURCE_TYPES, RESOURCE_RULES, resourceAmount } from './economy.js';
import { createFaithState } from '../game/Faith.js';

export const MAP_WIDTH = 2000;
export const MAP_HEIGHT = 2000;
export const TILE_SIZE = 32;
export const SETTLEMENT_RADIUS = 20;
export const PAWNS_PER_VILLAGE = 3;

// Compatibility for callers inspecting the default world. Runtime placement
// uses world.content, so an injected catalog never disagrees with the renderer.
export const BUILDING_TYPES = Object.freeze(Object.fromEntries(
  defaultContent.list('building').map(definition => [definition.id, definition.footprint])));

// Explicit village fixtures support isolated mechanics tests. The playable
// default is always one small settlement; external factions live separately.
export function createWorldState({ villages } = {}) {
  return {
    ...(!villages ? { playerSettlementId: 'home', faith: createFaithState() } : {}),
    time: 0,
    weather: 'clear',
    resources: Object.fromEntries(RESOURCE_TYPES.map(type => [type, 0])),
    villages: villages ? structuredClone(villages) : [
      { id: 'home', name: 'Worldtree Settlement', anchor: { x: 1000, y: 1000 },
        settlementRadius: SETTLEMENT_RADIUS, population: 8, economyVersion: 2, ...RESOURCE_RULES.starting,
        happiness: 63, religion: 'sky_god', relations: {}, templeCount: 0, defenseUntil: 0, crisis: null },
    ],
    // Ground overrides are separate from occupants. River tiles block movement;
    // paving and marked fords can share cells with buildings/pawns.
    // Unlisted ground is grass; this stays sparse, independent of occupancy.
    groundTiles: new Map(),
    groundRevision: 0,
    // Every occupied footprint cell references the same object.
    occupied: new Map(),
    buildings: new Map(),
    terrain: new Map(),
    entities: new Map(),
    recent_events: [],
  };
}

// Village inventories are authoritative; the global inventory is their summary.
export function syncResourceTotals(state) {
  state.resources ??= {};
  // Labor settlements have finite stores, including refunds and outside aid.
  for (const village of state.villages) if (village.labor) for (const id of RESOURCE_TYPES) village[id] = resourceAmount(village,id);
  for (const resource of RESOURCE_TYPES) state.resources[resource] = state.villages.reduce((sum, village) => sum + resourceAmount(village, resource), 0);
}
