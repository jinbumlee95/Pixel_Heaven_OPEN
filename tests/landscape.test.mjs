import assert from 'node:assert/strict';
import { createInitialWorld } from '../src/game/World.js';
import { initializeLandscape, waterBlocked } from '../src/game/Landscape.js';
import { encodeWorld, decodeWorld } from '../src/state/Persistence.js';
import { BattleSystem, prepareBattle } from '../src/game/Combat.js';
import { Factions } from '../src/game/Factions.js';
import { EventForecast } from '../src/game/EventForecast.js';
import { Renderer, APPEARANCE } from '../src/game/Renderer.js';

const world = createInitialWorld();
const original = [...world.state.occupied.keys()];
assert.equal(initializeLandscape(world), true);
assert.ok(world.state.groundTiles.size > 250 && world.state.groundTiles.size < 1000);
assert.ok(world.state.terrain.size > 100 && world.state.terrain.size < 500);
for (const cell of original) { const [x,y] = cell.split(',').map(Number); assert.equal(waterBlocked(world.state,x,y), false); }
const home = world.getVillage('home');
const water = [...world.state.groundTiles.values()].find(t => t.type === 'river_0' && Math.hypot(t.position.x-1000,t.position.y-1000)<20);
assert.ok(water);
assert.equal(world.isAreaEmpty(home, water.position, {w:1,h:1}, {forMovement:true}), false);
assert.equal(world.placeBuilding('house','home',water.position), null);
for (let x = 977; x <= 994; x++) assert.equal(waterBlocked(world.state,x,1000),false,'central ford is continuous');
const maskAt=(x,y)=>{const type=world.state.groundTiles.get(`${x},${y}`)?.type;return /^(river|ford)_\d+$/.test(type)?Number(type.split('_')[1]):15;};
for(const tile of world.state.groundTiles.values()){
  if(!/^(river|ford)_\d+$/.test(tile.type))continue;
  const {x,y}=tile.position,a=maskAt(x,y),right=maskAt(x+1,y),bottom=maskAt(x,y+1);
  assert.equal((a>>1)&1,right&1,'east NW corner continues');
  assert.equal((a>>3)&1,(right>>2)&1,'east SW corner continues');
  assert.equal((a>>2)&1,bottom&1,'south NW corner continues');
  assert.equal((a>>3)&1,(bottom>>1)&1,'south NE corner continues');
}
const encoded = encodeWorld(world);
assert.equal(initializeLandscape(world), false);
assert.equal(encodeWorld(world), encoded);
const loaded = decodeWorld(encoded).world;
assert.equal(initializeLandscape(loaded), false);
assert.equal(encodeWorld(loaded), encoded);
const again = createInitialWorld(); initializeLandscape(again);
assert.equal(encodeWorld(again),encoded,'deterministic generation');
const sceneBattle = new BattleSystem(world);
const pine = [...world.state.terrain.values()].find(o => o.type === 'pine');
assert.ok(sceneBattle.covered({position:{x:pine.position.x+1,y:pine.position.y}}));
const crag = [...world.state.terrain.values()].find(o => o.type === 'mountain');
assert.equal(sceneBattle.lineClear({x:crag.position.x-1,y:crag.position.y},{x:crag.position.x+4,y:crag.position.y}),false);
assert.equal(world.isAreaEmpty(home,crag.position,{w:1,h:1},{forMovement:true}),false);

// A loaded settlement's infrastructure and reserved construction survive.
const old = createInitialWorld();
const house = old.placeBuilding('house','home',{x:984,y:993});
assert.ok(house);
old.state.work={jobs:[{status:'working',position:{x:985,y:1008},footprint:{w:3,h:2}}]};
initializeLandscape(old);
for(let y=991;y<997;y++)for(let x=982;x<989;x++)assert.equal(waterBlocked(old.state,x,y),false);
assert.equal(old.state.buildings.get(house.id),house);
for(let y=1008;y<1010;y++)for(let x=985;x<988;x++)assert.equal(old.state.occupied.has(`${x},${y}`),false);

// Every entry can muster troops and route to a real exchange of blows without
// crossing water; forest cover and crags use existing encounter mechanics.
for (const direction of ['north','northeast','east','southeast','south','southwest','west','northwest']) {
  const w = createInitialWorld(); initializeLandscape(w); new Factions(w,{seed:7});
  Object.assign(w.getVillage('home'),{wood:100,stone:100,iron:100,copper:100,cloth:100});
  const battle = new BattleSystem(w);
  const forecasts = new EventForecast(w,{random:()=>0,battle});
  const plan=w.state.eventQueue[0]; plan.entryDirection=direction;
  assert.equal(prepareBattle(w,plan).ok,true,direction);
  let damaged=false;
  for(let t=plan.startAt;t<=plan.startAt+45;t++){
    w.state.time=t; forecasts.update();
    for(const unit of w.state.combat.units){
      assert.equal(waterBlocked(w.state,unit.position.x,unit.position.y),false,direction);
      if(unit.hp<unit.maxHp)damaged=true;
    }
  }
  assert.ok(damaged,`${direction} must reach combat through the landscape`);
}
console.log('landscape: passed');

// Real renderer ground selection: the visible water tile remains underneath
// the ford marker, and both layers stay inside the camera query budget.
const originalPixi = globalThis.PIXI;
class Sprite { constructor(texture){this.texture=texture;this.position={set(){}};} destroy(){} }
globalThis.PIXI={Sprite};
try {
  const renderWorld=createInitialWorld();initializeLandscape(renderWorld);
  const renderer=new Renderer(null,renderWorld);
  renderer.camera.resize(480,320);renderer.camera.center({x:985,y:1000});
  renderer.stage={position:{set(){}}};renderer.objects={addChild(){}};
  renderer.app={renderer:{render(){}}};renderer.renderAtmosphere=()=>{};
  const draws=[];renderer.tiles={clear(){draws.length=0;},tile(texture,x,y){draws.push({texture,x,y});}};
  for(const type of Object.keys(APPEARANCE))renderer.textures.set(type,type);
  const ground=renderWorld.state.groundTiles, queried=[];
  ground.get=k=>{queried.push(k);return Map.prototype.get.call(ground,k);};
  ground.values=()=>assert.fail('renderer must not enumerate all stored terrain');
  try { renderer.render(16); } finally { delete ground.get;delete ground.values; }
  assert.equal(queried.length,renderer.visibleCellCount);
  const markers=draws.filter(d=>d.texture==='river_stones');assert.ok(markers.length>0);
  for(const marker of markers){const index=draws.indexOf(marker);assert.match(draws[index-1].texture,/^ford_/);assert.deepEqual([draws[index-1].x,draws[index-1].y],[marker.x,marker.y]);}
  assert.ok(draws.length<=renderer.visibleCellCount*3);
  renderer.render(16);assert.equal(queried.length,renderer.visibleCellCount,'unchanged camera reuses batch');
} finally {globalThis.PIXI=originalPixi;}
