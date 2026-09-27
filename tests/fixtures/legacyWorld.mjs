// Isolated mechanics fixture from the Phase 9 world. The playable game always
// uses the production single-settlement world; these fixtures expose no player
// authority and are never loaded by the browser.
import { World } from '../../src/game/World.js';
import { createWorldState as createProductionState, syncResourceTotals,
  PAWNS_PER_VILLAGE } from '../../src/state/worldState.js';
import { defaultContent } from '../../src/content/builtin.js';

export function createWorldState({ villages } = {}) {
  const state = createProductionState({ villages: villages ?? [
    { id: 'north', name: 'North village', anchor: { x: 1000, y: 980 }, settlementRadius: 20,
      population: 71, food: 160, wood: 40, happiness: 63, religion: 'sky_god',
      relations: {}, templeCount: 0, defenseUntil: 0, crisis: null },
    { id: 'south', name: 'South village', anchor: { x: 1016, y: 1028 }, settlementRadius: 20,
      population: 112, food: 210, wood: 60, happiness: 31, religion: 'none',
      relations: {}, templeCount: 0, defenseUntil: 0, crisis: null },
  ] });
  delete state.playerSettlementId;
  delete state.sanctuary;
  return state;
}

export function createInitialWorld({ content = defaultContent } = {}) {
  const world = new World(createWorldState(), { content });
  const required = object => {
    if (!object) throw new Error('Legacy mechanics fixture does not fit the content catalog.');
    return object;
  };
  for (const village of world.state.villages) {
    const { x, y } = village.anchor;
    required(world.placeBuilding('town_hall', village.id, { x, y }));
    for (const [dx, dy] of [[-6, -4], [-6, 2], [8, -4], [8, 2]]) {
      required(world.placeBuilding('house', village.id, { x: x + dx, y: y + dy }));
    }
    for (const [dx, dy] of [[-10, -6], [-8, -8], [-11, -3], [10, 7], [12, 5]]) {
      required(world.placeTerrain('forest', village.id, { x: x + dx, y: y + dy }));
    }
    for (let dx = -3; dx <= 1; dx++) required(world.placeTerrain('farmland', village.id, { x: x + dx, y: y + 7 }));
    if (village.id === 'north') required(world.spawnEntity('priest', village.id, 'The High Priest'));
    for (let i = 0; i < PAWNS_PER_VILLAGE; i++) required(world.spawnEntity('villager', village.id));
  }
  syncResourceTotals(world.state);
  return world;
}
