import { RESOURCE_DEFINITIONS } from './resources.js';
import { RECIPES, WORKSHOPS } from './production.js';
// Data-only spatial/presentation definitions. Gameplay rules and action handlers
// remain engine-owned; this registry never imports or executes pack code.
const KINDS = Object.freeze(['building', 'terrain', 'entity', 'effect', 'ground']);
const MAX_PACKS = 16;
const MAX_DEFINITIONS = 512;
const DIRECTIONS = ['south', 'east', 'north', 'west'];
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const fail = (path, message) => { throw new TypeError(`${path}: ${message}`); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

// Unlike JSON.stringify, reject functions, accessors and unusual prototypes
// instead of silently dropping them or invoking a supplied toJSON/getter.
function copyData(value, path, seen = new Set(), budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 32768 || depth > 16) fail(path, 'pack data exceeds its size/depth limit');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 4096) fail(path, 'string is too long');
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || (!Array.isArray(value) && !plain(value))) fail(path, 'expected JSON data');
  if (seen.has(value)) fail(path, 'cyclic data is not supported');
  seen.add(value);
  const result = Array.isArray(value) ? [] : {};
  if (Array.isArray(value) && value.length > 1024) fail(path, 'array is too long');
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || forbiddenKeys.has(key) || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value')) fail(path, 'only ordinary data properties are allowed');
    if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
      fail(path, 'only ordinary array entries are allowed');
    }
    result[key] = copyData(descriptor.value, `${path}.${key}`, seen, budget, depth + 1);
  }
  if (Array.isArray(value) && Object.keys(result).length !== value.length) fail(path, 'sparse arrays are not supported');
  seen.delete(value);
  return result;
}

function keys(value, required, optional, path) {
  if (!plain(value)) fail(path, 'expected a record');
  if (required.some(key => !Object.hasOwn(value, key))) fail(path, `required fields: ${required.join(', ')}`);
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some(key => !allowed.has(key))) fail(path, 'unsupported field');
}

function integer(value, min, max, path) {
  if (!Number.isInteger(value) || value < min || value > max) fail(path, `expected integer ${min}..${max}`);
}

function assetPath(value, path, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length > 240
    || !/^assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(png|webp)$/.test(value)) {
    fail(path, 'expected a local assets/ PNG or WebP path');
  }
}

function label(value, path) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_.:-]{0,127}$/.test(value)) fail(path, 'invalid translation key');
}

function validateVisual(value, path, partial = false) {
  const fields = ['path', 'color', 'width', 'height', 'anchorX', 'anchorY'];
  keys(value, partial ? [] : fields, partial ? [...fields, 'ground', 'plannedPath', 'tint'] : ['ground', 'plannedPath', 'tint'], path);
  if (Object.hasOwn(value, 'path')) assetPath(value.path, `${path}.path`, true);
  if (Object.hasOwn(value, 'plannedPath')) assetPath(value.plannedPath, `${path}.plannedPath`);
  if (Object.hasOwn(value, 'color')) integer(value.color, 0, 0xffffff, `${path}.color`);
  if (Object.hasOwn(value, 'tint')) integer(value.tint, 0, 0xffffff, `${path}.tint`);
  for (const key of ['width', 'height']) if (Object.hasOwn(value, key)) integer(value[key], 1, 512, `${path}.${key}`);
  for (const key of ['anchorX', 'anchorY']) if (Object.hasOwn(value, key)
    && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1)) {
    fail(`${path}.${key}`, 'expected a number between 0 and 1');
  }
  if (Object.hasOwn(value, 'ground') && typeof value.ground !== 'boolean') fail(`${path}.ground`, 'expected boolean');
}

function validateAnimation(value, path) {
  keys(value, ['path', 'width', 'height', 'duration', 'frames', 'idleColumns', 'walkRows'], [], path);
  assetPath(value.path, `${path}.path`);
  integer(value.width, 1, 512, `${path}.width`);
  integer(value.height, 1, 512, `${path}.height`);
  integer(value.frames, 1, 32, `${path}.frames`);
  if (typeof value.duration !== 'number' || !Number.isFinite(value.duration)
    || value.duration < 0.01 || value.duration > 10) fail(`${path}.duration`, 'expected 0.01..10 seconds');
  for (const field of ['idleColumns', 'walkRows']) {
    keys(value[field], DIRECTIONS, [], `${path}.${field}`);
    for (const direction of DIRECTIONS) integer(value[field][direction], 0, 63, `${path}.${field}.${direction}`);
  }
}

function validateDefinition(value, packId, path) {
  keys(value, ['id', 'kind', 'labelKey', 'footprint', 'visual'], ['animation'], path);
  const localId = '[a-z][a-z0-9_-]{0,63}';
  const idPattern = new RegExp(packId === 'core' ? `^${localId}$` : `^${packId}:${localId}$`);
  if (typeof value.id !== 'string' || !idPattern.test(value.id)) fail(`${path}.id`, `definition must belong to ${packId}`);
  if (!KINDS.includes(value.kind)) fail(`${path}.kind`, 'unknown content kind');
  label(value.labelKey, `${path}.labelKey`);
  keys(value.footprint, ['w', 'h'], [], `${path}.footprint`);
  integer(value.footprint.w, 1, 8, `${path}.footprint.w`);
  integer(value.footprint.h, 1, 8, `${path}.footprint.h`);
  if (value.kind === 'entity' && (value.footprint.w !== 1 || value.footprint.h !== 1)) {
    fail(`${path}.footprint`, 'moving entities currently require a 1x1 footprint');
  }
  validateVisual(value.visual, `${path}.visual`);
  if (Object.hasOwn(value, 'animation')) validateAnimation(value.animation, `${path}.animation`);
}

function freezeData(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Build atomically from explicitly supplied packs in order. Include builtinPack
 * first for the base game. Namespaced additions never replace existing IDs;
 * explicit presentation-only patches apply in order, last patch wins.
 */
export function createContentRegistry(packs = []) {
  if (!Array.isArray(packs) || packs.length > MAX_PACKS) fail('packs', `expected at most ${MAX_PACKS} packs`);
  const input = copyData(packs, 'packs');
  const definitions = new Map();
  const resources=structuredClone(RESOURCE_DEFINITIONS), recipes=structuredClone(RECIPES);
  const packIds = new Set();
  const summaries = [];
  const rules = { foodProduction:1, foodConsumption:1, woodProduction:1, faithProduction:1, disasterDamage:1 };
  const translations = {ko:{},en:{},ja:{}};
  const modified = new Set();const chains=[];
  let entryCount = 0;
  for (let index = 0; index < input.length; index++) {
    const path = `packs[${index}]`;
    const pack = input[index];
    keys(pack, ['schemaVersion', 'id'], ['definitions', 'patches','version','requires','translations','modifiers','storyChains','resources','recipes'], path);
    if (pack.schemaVersion !== 1) fail(path, 'unsupported schemaVersion');
    if (typeof pack.id !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(pack.id)) fail(path, 'invalid pack id');
    if (packIds.has(pack.id)) fail(path, `duplicate pack id ${pack.id}`);
    if(pack.version!==undefined && !/^\d+\.\d+\.\d+$/.test(pack.version))fail(path,'expected semantic version');
    for(const field of ['requires','storyChains'])if(Object.hasOwn(pack,field)&&!Array.isArray(pack[field]))fail(path,`${field} must be an array`);
    for(const field of ['modifiers','translations'])if(Object.hasOwn(pack,field)&&!plain(pack[field]))fail(path,`${field} must be a record`);
    for(const dependency of pack.requires??[]){keys(dependency,['id','version'],[],path);if(!summaries.some(p=>p.id===dependency.id&&p.version===dependency.version))fail(path,'missing dependency/version');}
    for(const [id,value]of Object.entries(pack.modifiers??{})){
      if(!Object.hasOwn(rules,id)||modified.has(id)||typeof value!=='number'||value<0.5||value>1.5)fail(path,'unsupported, conflicting or out-of-range modifier');
      modified.add(id);rules[id]=value;
    }
    if(pack.translations){keys(pack.translations,['ko','en','ja'],[],path);for(const locale of ['ko','en','ja'])for(const [key,value]of Object.entries(pack.translations[locale])){
      if(!key.startsWith(`${pack.id}.`)||typeof value!=='string'||!value.trim())fail(path,'translations need a pack namespace and nonempty text');translations[locale][key]=value;
    }for(const locale of ['en','ja'])if(Object.keys(pack.translations.ko).sort().join()!==Object.keys(pack.translations[locale]).sort().join())fail(path,'translation keys must match in ko/en/ja');}
    for(const chain of pack.storyChains??[]){if(chain!=='harvest_relief'||chains.includes(chain))fail(path,'unsupported or duplicate story chain');chains.push(chain);}
    if (pack.id === 'core' && index !== 0) fail(path, 'the reserved core pack must be first');
    packIds.add(pack.id);
    const additions = pack.definitions ?? [];
    const patches = pack.patches ?? [];
    if (!Array.isArray(additions) || !Array.isArray(patches)) fail(path, 'definitions and patches must be arrays');
    entryCount += additions.length + patches.length;
    if (entryCount > MAX_DEFINITIONS) fail(path, `at most ${MAX_DEFINITIONS} definitions and patches are allowed`);
    for (const [offset, definition] of additions.entries()) {
      validateDefinition(definition, pack.id, `${path}.definitions[${offset}]`);
      if (definitions.has(definition.id)) fail(path, `duplicate definition ${definition.id}`);
      definitions.set(definition.id, definition);
    }
    for (const [offset, patch] of patches.entries()) {
      const patchPath = `${path}.patches[${offset}]`;
      keys(patch, ['id'], ['visual', 'labelKey'], patchPath);
      if (typeof patch.id !== 'string' || !definitions.has(patch.id)) fail(patchPath, 'patch target does not exist');
      if (!Object.hasOwn(patch, 'visual') && !Object.hasOwn(patch, 'labelKey')) fail(patchPath, 'empty patch');
      if (Object.hasOwn(patch, 'visual')) validateVisual(patch.visual, `${patchPath}.visual`, true);
      if (Object.hasOwn(patch, 'labelKey')) label(patch.labelKey, `${patchPath}.labelKey`);
      const previous = definitions.get(patch.id);
      // Animated frames preserve their native pixel geometry. Ground tiles and
      // effect pools also use fixed geometry in the renderer in this phase.
      // A path patch is still useful for the static/fallback image; it does not
      // replace an animation sheet or introduce a new effect implementation.
      if (previous.animation || ['ground', 'effect'].includes(previous.kind)) {
        for (const key of ['width', 'height', 'anchorX', 'anchorY']) {
          if (patch.visual && Object.hasOwn(patch.visual, key) && patch.visual[key] !== previous.visual[key]) {
            fail(`${patchPath}.visual.${key}`, 'geometry is fixed for animated content, ground and effects');
          }
        }
      }
      definitions.set(patch.id, { ...previous, ...patch,
        visual: { ...previous.visual, ...patch.visual } });
    }
    for(const field of ['resources','recipes'])if(pack[field]!==undefined&&!Array.isArray(pack[field]))fail(path,`${field} must be an array`);
    for(const r of pack.resources??[]){
      keys(r,['id','labelKey','baseValue','storageClass','stackLimit'],[],path);
      if(!new RegExp(`^${pack.id}:[a-z][a-z0-9_-]{0,40}$`).test(r.id)||Object.hasOwn(resources,r.id)||Object.keys(resources).length>=64)fail(path,'invalid/duplicate resource');
      if(!['materials','provisions'].includes(r.storageClass)||typeof r.baseValue!=='number'||r.baseValue<.1||r.baseValue>100)fail(path,'invalid resource value/class');
      integer(r.stackLimit,10,1000,path);label(r.labelKey,path);
      for(const locale of ['ko','en','ja']){if(!pack.translations?.[locale]?.[r.labelKey])fail(path,'missing resource translation');translations[locale][`resource.${r.id}`]=pack.translations[locale][r.labelKey];}
      resources[r.id]=r;
    }
    for(const r of pack.recipes??[]){
      keys(r,['id','labelKey','buildingTag','inputs','outputs','workSeconds'],[],path);
      if(!new RegExp(`^${pack.id}:[a-z][a-z0-9_-]{0,40}$`).test(r.id)||Object.hasOwn(recipes,r.id)||Object.keys(recipes).length>=128||!Object.hasOwn(WORKSHOPS,r.buildingTag))fail(path,'invalid recipe');
      integer(r.workSeconds,1,3600,path);
      for(const field of ['inputs','outputs']){if(!plain(r[field])||!Object.keys(r[field]).length||Object.keys(r[field]).length>8)fail(path,'invalid basket');for(const [id,n] of Object.entries(r[field])){if(!Object.hasOwn(resources,id))fail(path,'unknown resource');integer(n,1,100,path);}}
      // No profitable zero-cost or one-step conversion cycles in submitted packs.
      const value=b=>Object.entries(b).reduce((sum,[id,n])=>sum+resources[id].baseValue*n,0);
      if(value(r.outputs)>value(r.inputs)*1.5)fail(path,'output value exceeds bounded conversion');
      for(const locale of ['ko','en','ja']){if(!pack.translations?.[locale]?.[r.labelKey])fail(path,'missing recipe translation');translations[locale][`production.recipe.${r.id}`]=pack.translations[locale][r.labelKey];}
      recipes[r.id]=r;
    }
    summaries.push({ id: pack.id, schemaVersion: pack.schemaVersion, version:pack.version??'1.0.0' });
  }
  const graph=new Map();
  for(const r of Object.values(recipes))for(const input of Object.keys(r.inputs))for(const output of Object.keys(r.outputs)){if(!graph.has(input))graph.set(input,new Set());graph.get(input).add(output);}
  const visited=new Set(),visiting=new Set();
  function visit(id){if(visiting.has(id))fail('recipes','cyclic material conversions are not allowed');if(visited.has(id))return;visiting.add(id);for(const next of graph.get(id)??[])visit(next);visiting.delete(id);visited.add(id);}
  for(const id of graph.keys())visit(id);
  const all = freezeData([...definitions.values()]);
  const byKind = new Map(KINDS.map(kind => [kind, Object.freeze(all.filter(value => value.kind === kind))]));
  return Object.freeze({
    get: id => definitions.get(id),
    list: kind => {
      if (kind === undefined) return all;
      if (!byKind.has(kind)) fail('kind', 'unknown content kind');
      return byKind.get(kind);
    },
    resources:freezeData(resources), recipes:freezeData(recipes),
    packs: freezeData(summaries),
    rules: freezeData(rules), translations:freezeData(translations), storyChains:freezeData(chains),
  });
}
