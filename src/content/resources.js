// A single metadata contract for stock, recipes and trade. Silver is currency.
const values = { food: .2, wood: .3, stone: .4, iron: 1, copper: .8, coal: .4, herbs: .5, cloth: .5, silver: 1, gold: 8, iron_ore: .3, fiber: .2, tools: 3, planks: 1, medicine: 3, rations: 1, crafts: 4 };
export const RESOURCE_DEFINITIONS = Object.freeze(Object.fromEntries(Object.entries(values).map(([id, baseValue]) => [id, Object.freeze({
  id, labelKey: `resource.${id}`, baseValue, storageClass: ['food', 'herbs'].includes(id) ? 'provisions' : 'materials', stackLimit: 1000,
})])));
