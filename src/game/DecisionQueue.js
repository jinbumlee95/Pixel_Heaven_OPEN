// A view over authoritative objects, not a second simulation or copied queue.
export function decisionQueue(state) {
  const cards = (state.eventQueue ?? []).filter(p => ['forecast','active'].includes(p.stage))
    .map(p => ({ id:p.id, kind:p.kind, stage:p.stage, at:p.stage==='active'?p.endAt:p.startAt, object:p }));
  const visit=state.life?.caravan;
  if(visit && visit.stage!=='departed') cards.push({id:visit.id,kind:'caravan',stage:visit.stage,at:visit.stage==='visiting'?visit.departAt:visit.arriveAt,object:visit});
  const wolves=state.life?.wolves;
  if(wolves)cards.push({id:`wolves-${wolves.startAt}`,kind:'wolves',stage:wolves.stage,at:wolves.stage==='active'?wolves.endAt:wolves.startAt,object:wolves});
  for(const p of state.diplomacy?.proposals??[])if(['pending','counteroffer'].includes(p.status))
    cards.push({id:p.id,kind:'proposal',stage:p.status,at:p.expiresAt,object:p});
  return cards.sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
}
export function selectDecision(state, {id,kind}={}) {
  const choices=decisionQueue(state).filter(c=>(!id||c.id===id)&&(!kind||c.kind===kind));
  return choices.length===1 ? {ok:true,card:choices[0]} : {ok:false,code:choices.length?'ambiguous':'expired',choices:choices.map(c=>c.id)};
}
export function setDecision(state, id, decision) {
  const result=selectDecision(state,{id});
  if(!result.ok)return result;
  if(!['autonomous','receiving','responded','failed'].includes(decision))return {ok:false,code:'invalid'};
  result.card.object.playerDecision=decision;
  return {ok:true};
}
