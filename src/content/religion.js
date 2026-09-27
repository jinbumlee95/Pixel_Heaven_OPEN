// Bounded faith content. IDs and multipliers are persisted, never executable mods.
export const COMMANDMENTS = Object.freeze({
  rest: {group:'labor', rules:{faithProduction:1.25,foodProduction:.9}},
  toil: {group:'labor', rules:{foodProduction:1.15,woodProduction:1.15,faithProduction:.85}},
  preserve: {group:'nature', rules:{disasterDamage:.8,woodProduction:.8}},
  expand: {group:'nature', rules:{woodProduction:1.2,disasterDamage:1.15}},
  restraint: {group:'food', rules:{foodConsumption:.9,faithProduction:.95}},
  abundance: {group:'food', rules:{foodConsumption:1.1,faithProduction:1.1}},
});
export const RITES = Object.freeze({
  harvest:{cost:{food:20,crafts:2},faith:8,cooldown:600},
  funeral:{cost:{food:5},faith:4,cooldown:120},
  departure:{cost:{rations:1},faith:6,cooldown:120},
});
export const PRAYERS = Object.freeze(['food','cloth','temple','healing']);
export function faithRule(state,key) {
  let value=state.rules?.[key]??1;
  for(const id of state.religion?.commandments??[]) value*=COMMANDMENTS[id]?.rules[key]??1;
  return Math.max(.25,Math.min(2,value));
}
