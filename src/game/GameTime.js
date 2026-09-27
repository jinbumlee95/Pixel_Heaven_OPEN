// Display conversion only. One simulation second remains one logical update;
// calendar presentation must never advance or rebalance the simulation.
export const GAME_DAY_SECONDS = 120;

function boundedSeconds(value, round) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, round(value)) : 0;
}

export function elapsedClock(seconds) {
  const total = boundedSeconds(seconds, Math.floor);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function durationParts(seconds) {
  const total = boundedSeconds(seconds, Math.ceil);
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}
