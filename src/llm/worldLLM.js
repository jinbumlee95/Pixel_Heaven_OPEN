import { INTERPRETATION_REASON, relation } from '../state/society.js';
// The mock proposes exactly one action per triggered decision; the engine owns
// current-state validation, placement, inventory transfers and population math.
export async function decideWorldAction(context) {
  const { villages, rules, triggers } = context;
  const propose = (actor, action, target, reason, parameters = {}) => ({ actor, action, target, reason, parameters });
  const canBuild = (actor, action) => Object.entries(actor.constructionCosts?.[action]
    ?? { wood: action === 'farm' ? rules.farmWood : action === 'build_house' ? rules.houseWood : rules.templeWood })
    .every(([resource, amount]) => Number.isFinite(actor[resource]) && actor[resource] >= amount);
  const oracle = context.interpretations?.[0];
  if (oracle) {
    const actor = villages.find(v => v.id === oracle.actor);
    if (!actor || actor.population <= 0) return { action: 'none' };
    const neighbor = villages.find(v => v.id !== actor.id && v.population > 0);
    if (oracle.intent === 'remembrance' && actor.templeCount === 0 && canBuild(actor, 'build_temple')) {
      return propose(actor.id, 'build_temple', actor.id, INTERPRETATION_REASON);
    }
    if (oracle.intent === 'faith' && actor.templeCount > 0 && actor.religion !== 'sky_god') {
      return propose(actor.id, 'change_religion', actor.id, INTERPRETATION_REASON, { religion: 'sky_god' });
    }
    if (oracle.intent === 'peace' && neighbor && relation(actor, neighbor) !== 'allied') {
      return propose(actor.id, 'form_alliance', neighbor.id, INTERPRETATION_REASON);
    }
    if (oracle.intent === 'conflict' && neighbor && actor.happiness < 35
      && actor.religion !== neighbor.religion && relation(actor, neighbor) === 'neutral') {
      return propose(actor.id, 'start_war', neighbor.id, INTERPRETATION_REASON);
    }
    return { action: 'none' };
  }
  for (const trigger of triggers) {
    const actor = villages.find(v => v.id === trigger.actor);
    if (!actor || actor.population <= 0) continue;
    const others = villages.filter(v => v.id !== actor.id && v.population > 0);
    const neighbors = others.filter(v => relation(actor, v) !== 'war');
    if (trigger.reason === 'faith_crisis' && actor.templeCount > 0 && actor.religion === 'none') {
      return propose(actor.id, 'change_religion', actor.id, trigger.reason, { religion: 'sky_god' });
    }
    if (['raid', 'conflict'].includes(trigger.reason)) {
      const ally = others.find(v => relation(actor, v) !== 'allied');
      if (ally && (trigger.reason === 'raid' || actor.happiness >= 40)) {
        return propose(actor.id, 'form_alliance', ally.id, trigger.reason);
      }
    }
    if (trigger.reason === 'food_shortage') {
      if (actor.food < actor.reserve) {
        const seller = neighbors.find(v => v.food - 25 >= v.reserve);
        if (seller && actor.wood >= 5) return propose(actor.id, 'trade', seller.id, trigger.reason, { food: 25 });
      }
      if (actor.production + 1e-9 < actor.consumption && (!actor.labor || actor.labor.farming >= actor.farmCapacity) && canBuild(actor, 'farm')) {
        return propose(actor.id, 'farm', actor.id, trigger.reason);
      }
      const destination = neighbors.find(v => v.housing - v.population >= 5
        && v.food >= (v.population + 5) * rules.consumptionPerPerson * rules.reserveTicks);
      if (actor.food < actor.reserve && actor.population >= 5 && destination) {
        return propose(actor.id, 'migrate', destination.id, trigger.reason, { people: 5 });
      }
      const rival = others.find(v => relation(actor, v) === 'neutral' && v.religion !== actor.religion);
      if (actor.food < actor.reserve && actor.wood < rules.farmWood && actor.happiness < 35 && rival) {
        return propose(actor.id, 'start_war', rival.id, trigger.reason);
      }
    }
    if (trigger.reason === 'housing_shortage') {
      if (canBuild(actor, 'build_house')) return propose(actor.id, 'build_house', actor.id, trigger.reason);
      const destination = neighbors.find(v => v.housing - v.population >= 5
        && v.food >= (v.population + 5) * rules.consumptionPerPerson * rules.reserveTicks);
      if (actor.population >= 5 && destination) return propose(actor.id, 'migrate', destination.id, trigger.reason, { people: 5 });
    }
  }
  return { action: 'none' };
}
