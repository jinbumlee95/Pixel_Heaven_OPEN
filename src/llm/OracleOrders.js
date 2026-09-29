import { validOrder } from '../game/ChatCommands.js';
import { COMMANDMENTS, RITES, PRAYERS } from '../content/religion.js';
import { WORKSHOPS, RECIPES } from '../content/production.js';
const enumeration=values=>({enum:values});
const definitions=[
 ['religion',{operation:enumeration(['praise','offering'])}],
 ['religion',{operation:enumeration(['enact','revoke']),id:enumeration(Object.keys(COMMANDMENTS))}],
 ['religion',{operation:{const:'rite'},id:enumeration(Object.keys(RITES))}],
 ['religion',{operation:{const:'accept'},id:enumeration(['next',...PRAYERS])}],
 ['dungeon',{operation:{const:'policy'},value:enumeration(['safe','treasure','hunt'])}],
 ['dungeon',{operation:{const:'route'},value:enumeration(['normal','elite','spring','mystery'])}],
 ['dungeon',{operation:{const:'light'},value:enumeration(['faith','coal'])}],
 ['equipment',{operation:{const:'lootPolicy'},value:{type:'boolean'}}],
 ['expedition',{operation:enumeration(['deeper','supply'])}],
 ['workshop',{facility:enumeration(Object.keys(WORKSHOPS))}],
 ['produce',{recipeId:enumeration(Object.keys(RECIPES)),count:{type:'integer',minimum:1,maximum:20}}],
 ['useGoods',{resource:enumeration(['medicine','crafts'])}],
 ['smite',{}],
];
export const ORACLE_ORDER_SCHEMAS=definitions.map(([name,fields])=>({type:'object',additionalProperties:false,
 required:['type','name',...Object.keys(fields)],properties:{type:{const:'order'},name:{const:name},...fields}}));
export function validOracleOrder(o) {
 return validOrder(o)&&ORACLE_ORDER_SCHEMAS.some(s=>s.required.every(k=>Object.hasOwn(o,k))&&Object.keys(o).every(k=>Object.hasOwn(s.properties,k))
  &&Object.entries(s.properties).every(([k,p])=>p.const!==undefined?o[k]===p.const:p.enum?p.enum.includes(o[k]):p.type==='boolean'?typeof o[k]==='boolean':Number.isInteger(o[k])&&o[k]>=p.minimum&&o[k]<=p.maximum));
}
export const ORACLE_ORDER_HELP='Alternatively return one supported structured order matching these schemas. Preserve explicit quantities; never convert a question, negation or multiple actions into an order: '+JSON.stringify(ORACLE_ORDER_SCHEMAS);
