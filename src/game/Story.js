export const STORY_PROFILES = Object.freeze({
  steady: Object.freeze({ interval:1200, chance:1, lead:360 }),
  changing: Object.freeze({ interval:120, chance:0.35, lead:360 }),
  gentle: Object.freeze({ interval:600, chance:1, lead:480 }),
});
export function initializeStory(world) {
  world.state.story ??= { profile:'steady', personality:'careful', memories:[], nextSequence:1 };
}
export function setStoryProfile(world, profile) {
  if(!Object.hasOwn(STORY_PROFILES,profile))return false;
  world.state.story.profile=profile;return true; // Existing forecasts are deliberately untouched.
}
export function nextStoryTime(state, previous, random) {
  const rule=STORY_PROFILES[state.story.profile];
  let next=Math.max(state.time+rule.lead,previous+rule.interval);
  // Randomness is consumed when creating the public forecast, never at impact.
  for(let day=0;day<30&&random()>rule.chance;day++)next+=rule.interval;
  return next;
}
export function rememberEvent(state,event) {
  if(!state.story || ['need','faction_trade','faction_recovery'].includes(event.action))return;
  if(event.source==='factions'&&event.target&&event.target!=='home')return;
  state.story.memories.push({ ...structuredClone(event), memoryId:state.story.nextSequence++ });
  state.story.memories=state.story.memories.slice(-100);
  const chain=state.story.chains?.find(c=>c.id==='harvest_relief');
  if(chain?.stage==='waiting'&&event.action==='drought_resolved'&&state.life){chain.stage='relief_requested';state.life.nextVisit=Math.min(state.life.nextVisit,state.time+30);}
  if(chain?.stage==='relief_requested'&&event.action==='life_caravan_arrived')chain.stage='trade_open';
  if(chain?.stage==='trade_open'&&event.action==='life_caravan_left')chain.stage='complete';
}
