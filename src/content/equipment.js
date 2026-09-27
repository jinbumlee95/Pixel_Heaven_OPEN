// Original Worldtree equipment; names/art from reference games are not copied.
const item = (id, role, w, h, damage, armor, hp, speed = 0, effect = null, tag = 'oak') => ({ id, role, w, h, damage, armor, hp, speed, effect, tag, icon: `assets/equipment/${id}.png`, labelKey: `gear.${id}` });
export const EQUIPMENT = Object.freeze({
  shortblade: item('shortblade','weapon',1,3,2,0,0,.15),
  saber: item('saber','weapon',1,4,3,0,0,.3),
  mace: item('mace','weapon',2,3,5,1,0,-.2),
  greatsword: item('greatsword','weapon',2,4,8,0,0,-.5),
  runeblade: item('runeblade','weapon',1,4,4,0,0,.5,'charged','rune'),
  lightarmor: item('lightarmor','armor',2,2,0,1,4,.1),
  plate: item('plate','armor',2,3,0,3,10,-.2),
  ember: item('ember','charm',1,1,0,0,0,0,'ember','rune'),
  ward: item('ward','charm',1,2,0,0,2,0,'ward'),
  pathfinder: item('pathfinder','charm',1,2,0,0,0,0,'provisions'),
  dawnblade: item('dawnblade','weapon',2,4,6,0,6,-.3,'dawn','rune'),
  worldheart: item('worldheart','charm',2,2,0,1,8,0,'heart','rune'),
});
export const GRADES = Object.freeze({ common: 1, rare: 1.35, unique: 1.6, mythic: 1.8 });
export const CRAFT_GEAR = Object.freeze(Object.fromEntries(Object.keys(EQUIPMENT).filter(id=>!['dawnblade','worldheart'].includes(id)).map(id=>[id,{inputs:{iron: id==='greatsword'?10:4,wood:3,cloth:2},workSeconds:30}])));
