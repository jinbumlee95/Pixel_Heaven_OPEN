import { rememberEvent } from './Story.js';
const listeners=new WeakMap();
export function subscribeEvents(state,listener) {
  const set=listeners.get(state)??new Set();set.add(listener);listeners.set(state,set);
  return ()=>set.delete(listener);
}
// One writer; recent events and chronicle are bounded views of the same identities.
export function recordEvent(state,event) {
  state.recent_events??=[];
  if(event.journalId&&state.recent_events.some(e=>e.journalId===event.journalId)) {
    const memory=state.story?.memories.find(e=>e.journalId===event.journalId);
    if(memory)Object.assign(memory,structuredClone(event));
    for(const listener of listeners.get(state)??[])listener(event);
    return event;
  }
  state.eventSequence=(state.eventSequence??Math.max(0,...state.recent_events.map(e=>e.journalId??0)))+1;
  event.journalId=state.eventSequence;
  event.salience=/answered|celebrated|offered|discovered|battle|retreated|cleared|construction_complete/.test(event.action)?3:event.source==='divine'?2:1;
  state.recent_events.push(event);state.recent_events=state.recent_events.slice(-50);
  rememberEvent(state,event);
  for(const listener of listeners.get(state)??[])listener(event);
  return event;
}
