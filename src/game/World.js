import { MAP_WIDTH, MAP_HEIGHT, PAWNS_PER_VILLAGE, TILE_SIZE,
  createWorldState, syncResourceTotals } from '../state/worldState.js';
import { DIRECTIONS, matchesDirection } from '../state/directions.js';
import { defaultContent } from '../content/builtin.js';
import { waterBlocked } from './Landscape.js';

export const cellKey = (x, y) => `${x},${y}`;

export function isInSettlement(village, x, y) {
  return Number.isInteger(x) && Number.isInteger(y)
    && x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT
    && (x - village.anchor.x) ** 2 + (y - village.anchor.y) ** 2
      <= village.settlementRadius ** 2;
}

export class World {
  constructor(state = createWorldState(), { content = defaultContent } = {}) {
    this.state = state;
    this.content = content;
    this.nextId = 1;
  }

  getVillage(id) { return this.state.villages.find(v => v.id === id); }

  // A ground tile is not an occupant: it can sit underneath a building or pawn.
  setGround(type, villageId, position) {
    const definition = this.content.get(type);
    const village = this.getVillage(villageId);
    if (definition?.kind !== 'ground' || definition.footprint.w !== 1 || definition.footprint.h !== 1
      || !village || !position || !isInSettlement(village, position.x, position.y)) return null;
    const tile = { type, villageId, position: { ...position } };
    const key = cellKey(position.x, position.y);
    this.state.groundTiles ??= new Map();
    const previous = this.state.groundTiles.get(key)?.type ?? 'ground';
    if (previous !== type) {
      if (type === 'ground') this.state.groundTiles.delete(key);
      else this.state.groundTiles.set(key, tile);
      this.state.groundRevision = (this.state.groundRevision ?? 0) + 1;
    }
    return tile;
  }

  isAreaEmpty(village, position, footprint, { forMovement = false } = {}) {
    if (!village || !position || !Number.isInteger(position.x) || !Number.isInteger(position.y)
      || !footprint || !Number.isInteger(footprint.w)
      || !Number.isInteger(footprint.h) || footprint.w < 1 || footprint.h < 1
      || footprint.w > village.settlementRadius * 2 + 1
      || footprint.h > village.settlementRadius * 2 + 1) return false;
    for (let y = position.y; y < position.y + footprint.h; y++) {
      for (let x = position.x; x < position.x + footprint.w; x++) {
        if (this.state.work?.jobs.some(job => job.status === 'working' && !job.repairId && x >= job.position.x && x < job.position.x + job.footprint.w && y >= job.position.y && y < job.position.y + job.footprint.h)) return false;
        if (!isInSettlement(village, x, y) || this.state.occupied.has(cellKey(x, y)) || waterBlocked(this.state, x, y)) return false;
        if (!forMovement && this.state.sanctuary?.reservedCells?.some(cell => cell.x === x && cell.y === y)) return false;
        const combat = this.state.combat;
        if (combat && ['preparing', 'approaching', 'fighting'].includes(combat.stage)) {
          if (combat.units.some(unit => unit.hp > 0 && unit.position.x === x && unit.position.y === y)) return false;
          if (combat.works.some(work => work.hp > 0 && work.position.x === x && work.position.y === y
            && (!forMovement || work.type === 'barricade'))) return false;
        }
      }
    }
    return true;
  }

  // Search bounded rings around the anchor, never the global map.
  findEmptyArea(village, footprint, direction) {
    if (!village || (direction !== undefined && !DIRECTIONS.includes(direction))) return null;
    if (!footprint || !Number.isInteger(footprint.w) || !Number.isInteger(footprint.h)
      || footprint.w < 1 || footprint.h < 1) return null;
    if (direction) {
      const preferred = this.searchArea(village, footprint, direction);
      if (preferred) return preferred;
    }
    return this.searchArea(village, footprint) ?? this.searchArea(village,footprint,undefined,true);
  }

  searchArea(village, footprint, direction, allowCanopy = false) {
    const { x: cx, y: cy } = village.anchor;
    const tree=this.state.terrain.get(this.state.sanctuary?.treeId);
    const treeArt=tree?this.content.get(tree.type)?.visual:null;
    // Automatic building sites keep the readable canopy clear. This is a
    // placement preference, not collision: pawns and existing saves stay valid.
    const canopy=treeArt&&footprint.w>=3&&!allowCanopy?{
      left:tree.position.x+tree.footprint.w/2-treeArt.width/TILE_SIZE/2-1,
      right:tree.position.x+tree.footprint.w/2+treeArt.width/TILE_SIZE/2+1,
      top:tree.position.y+tree.footprint.h-treeArt.height/TILE_SIZE-1,
      bottom:tree.position.y+tree.footprint.h+1,
    }:null;
    for (let r = 0; r <= village.settlementRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        // On inner rows visit only the two edge cells of this ring.
        const stride = Math.abs(dy) === r ? 1 : 2 * r;
        for (let dx = -r; dx <= r; dx += stride) {
          const position = { x: cx + dx, y: cy + dy };
          if(canopy&&position.x+footprint.w>canopy.left&&position.x<canopy.right&&position.y+footprint.h>canopy.top&&position.y<canopy.bottom)continue;
          if ((!direction || matchesDirection(village.anchor, position, footprint, direction))
            && this.isAreaEmpty(village, position, footprint)) return position;
        }
      }
    }
    return null;
  }

  occupy(object) {
    for (let y = object.position.y; y < object.position.y + object.footprint.h; y++) {
      for (let x = object.position.x; x < object.position.x + object.footprint.w; x++) {
        this.state.occupied.set(cellKey(x, y), object);
      }
    }
  }

  placeBuilding(type, villageId, position) {
    const definition = this.content.get(type);
    if (definition?.kind !== 'building') return null;
    const footprint = definition.footprint;
    const village = this.getVillage(villageId);
    const target = position ?? this.findEmptyArea(village, footprint);
    if (!this.isAreaEmpty(village, target, footprint)) return null;
    const building = { id: `building_${this.nextId++}`, type, villageId,
      position: { ...target }, footprint };
    this.state.buildings.set(building.id, building);
    this.occupy(building);
    if (type === 'house') village.houseCount = (village.houseCount ?? 0) + 1;
    if (type === 'temple') village.templeCount = (village.templeCount ?? 0) + 1;
    return building;
  }

  placeTerrain(type, villageId, position) {
    const definition = this.content.get(type);
    if (definition?.kind !== 'terrain') return null;
    const footprint = definition.footprint;
    if (!this.isAreaEmpty(this.getVillage(villageId), position, footprint)) return null;
    const terrain = { id: `terrain_${this.nextId++}`, type, villageId,
      position: { ...position }, footprint };
    this.state.terrain.set(terrain.id, terrain);
    this.occupy(terrain);
    if (type === 'farmland') {
      const village = this.getVillage(villageId);
      village.farmCount = (village.farmCount ?? 0) + 1;
    }
    return terrain;
  }

  spawnEntity(type, villageId, name = null) {
    const definition = this.content.get(type);
    if (definition?.kind !== 'entity') return null;
    const footprint = definition.footprint;
    const position = this.findEmptyArea(this.getVillage(villageId), footprint);
    if (!position) return null;
    const entity = { id: `entity_${this.nextId++}`, type, villageId, name,
      position, footprint, wanderElapsed: 0 };
    this.state.entities.set(entity.id, entity);
    this.occupy(entity);
    return entity;
  }

  moveEntity(entity, position) {
    if (this.state.entities.get(entity.id) !== entity
      || !this.isAreaEmpty(this.getVillage(entity.villageId), position, entity.footprint, { forMovement: true })) return false;
    this.state.occupied.delete(cellKey(entity.position.x, entity.position.y));
    entity.position = { ...position };
    this.occupy(entity);
    return true;
  }
}

export function createInitialWorld({ content = defaultContent } = {}) {
  const world = new World(createWorldState(), { content });
  // A single tiny settlement grows around the sanctuary. No outside faction
  // gets buildings, occupied map cells or a separately controllable village.
  const required = object => {
    if (!object) throw new Error('Initial settlement layout does not fit the content catalog.');
    return object;
  };
  const village = world.state.villages[0];
  const { x, y } = village.anchor;
  const tree = required(world.placeTerrain('world_tree', village.id, { x: x - 3, y }));
  const altar = required(world.placeBuilding('altar', village.id, { x: x - 1, y: y + 5 }));
  // A continuous, centered 4×4 stone court includes the altar's own footprint.
  // Reservations protect the approach; they are not a visual floor mask.
  const court = [-2, -1, 0, 1].flatMap(dx => [4, 5, 6, 7].map(dy => ({ x: x + dx, y: y + dy })));
  for (const cell of court) required(world.setGround('stone_paving', village.id, cell));
  world.state.sanctuary = { treeId: tree.id, altarId: altar.id,
    reception: { x, y: y + 6 },
    reservedCells: court.filter(cell => !world.state.occupied.has(cellKey(cell.x, cell.y))) };
  required(world.placeBuilding('house', village.id, { x: x - 8, y: y + 4 }));
  required(world.placeTerrain('farmland', village.id, { x: x + 6, y: y + 5 }));
  for (const [dx, dy] of [[-11, -8], [10, -4], [-10, 8], [10, 8]]) {
    required(world.placeTerrain('forest', village.id, { x: x + dx, y: y + dy }));
  }
  const priest = required(world.spawnEntity('priest', village.id, 'The High Priest'));
  if (!world.moveEntity(priest, { x: x - 5, y: y + 5 })) throw new Error('Priest arrival path does not fit.');
  for (let i = 0; i < PAWNS_PER_VILLAGE; i++) required(world.spawnEntity('villager', village.id));
  syncResourceTotals(world.state);
  return world;
}
