import { CRAFT_GEAR } from './equipment.js';
// Declarative, bounded catalog. Executors own reservation and settlement.
export const WORKSHOPS = Object.freeze({
  smith: { cost: { wood: 20, stone: 15, iron: 4 }, workSeconds: 50 },
  warehouse: { cost: { wood: 20, stone: 10, planks: 4 }, workSeconds: 45 },
  sawmill: { cost: { wood: 16, stone: 8, iron: 2 }, workSeconds: 40 },
  apothecary: { cost: { wood: 18, stone: 8, cloth: 3 }, workSeconds: 40 },
  kitchen: { cost: { wood: 12, stone: 12 }, workSeconds: 35 },
  smelter: Object.freeze({ cost: Object.freeze({ wood: 18, stone: 16, copper: 2 }), workSeconds: 45 }),
  weaver: Object.freeze({ cost: Object.freeze({ wood: 16, stone: 6, iron: 2 }), workSeconds: 40 }),
});
export const RECIPES = Object.freeze({
  ...Object.fromEntries(Object.entries(CRAFT_GEAR).flatMap(([id,r])=>['common','rare'].map(grade=>[`gear_${id}_${grade}`,{id:`gear_${id}_${grade}`,buildingTag:'smith',inputs:Object.fromEntries(Object.entries(r.inputs).map(([k,n])=>[k,n*(grade==='rare'?2:1)])),outputs:{},equipment:{definition:id,grade},workSeconds:r.workSeconds*(grade==='rare'?2:1),unlock:grade==='rare'?3:0}]))),
  planks: { id:'planks',buildingTag:'sawmill',inputs:{wood:4},outputs:{planks:2},workSeconds:12 },
  tools: { id:'tools',buildingTag:'smith',inputs:{iron:2,wood:2},outputs:{tools:1},workSeconds:15 },
  medicine: { id:'medicine',buildingTag:'apothecary',inputs:{herbs:3,cloth:1},outputs:{medicine:1},workSeconds:12 },
  rations: { id:'rations',buildingTag:'kitchen',inputs:{food:6,wood:1},outputs:{rations:2},workSeconds:10 },
  crafts: { id:'crafts',buildingTag:'smith',inputs:{copper:2,silver:1},outputs:{crafts:1},workSeconds:18 },
  smelt: Object.freeze({ id: 'smelt', buildingTag: 'smelter', inputs: Object.freeze({ iron_ore: 2, coal: 1 }), outputs: Object.freeze({ iron: 1 }), workSeconds: 12 }),
  weave: Object.freeze({ id: 'weave', buildingTag: 'weaver', inputs: Object.freeze({ fiber: 3 }), outputs: Object.freeze({ cloth: 2 }), workSeconds: 10 }),
});
export const MAX_PRODUCTION_ORDERS = 4;
export const MAX_PRODUCTION_HISTORY = 24;
