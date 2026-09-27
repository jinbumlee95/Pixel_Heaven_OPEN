export const SOCIETY = Object.freeze({
  templeWood: 30, defenseTicks: 30, raidWarningTicks: 15,
  droughtTicks: 25, firstCrisisTick: 40, crisisInterval: 60,
});
export const RELIGIONS = Object.freeze(['none', 'sky_god', 'earth_god']);
export const INTERPRETATION_REASON = 'interpretation_of_divine_message';
export const INTENT_ACTIONS = Object.freeze({
  remembrance: 'build_temple', faith: 'change_religion', peace: 'form_alliance', conflict: 'start_war',
});

export function relation(a, b) { return a.relations?.[b.id] ?? 'neutral'; }
export function setRelation(a, b, value) {
  (a.relations ??= {})[b.id] = value;
  (b.relations ??= {})[a.id] = value;
}
