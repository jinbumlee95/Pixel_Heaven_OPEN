// Presentation-only introduction to an arriving threat. Manual camera control
// cancels it; it never changes simulation time or a combatant's position.
export class CameraTour {
  constructor() { this.current = null; this.lastId = null; }

  start(id, position, home, camera, { enabled = true, reducedMotion = false } = {}) {
    if (!id || id === this.lastId) return false;
    this.lastId = id;
    if (!enabled || reducedMotion) return false;
    this.current = { id, elapsed: 0, stage: 'outbound', from: { x: camera.x, y: camera.y },
      entry: { ...position }, home: { ...home } };
    return true;
  }

  cancel() { this.current = null; }

  update(elapsedMs, camera) {
    const tour = this.current;
    if (!tour) return;
    tour.elapsed += Math.max(0, Math.min(Number(elapsedMs) || 0, 250));
    const entry = { x: tour.entry.x - camera.width / 2, y: tour.entry.y - camera.height / 2 };
    const home = { x: tour.home.x - camera.width / 2, y: tour.home.y - camera.height / 2 };
    const ease = value => value * value * (3 - 2 * value);
    let from, to, amount;
    if (tour.elapsed < 700) { tour.stage = 'outbound'; from = tour.from; to = entry; amount = ease(tour.elapsed / 700); }
    else if (tour.elapsed < 3200) { tour.stage = 'watching'; from = entry; to = entry; amount = 1; }
    else if (tour.elapsed < 3900) { tour.stage = 'returning'; from = entry; to = home; amount = ease((tour.elapsed - 3200) / 700); }
    else { camera.center(tour.home); this.cancel(); return; }
    camera.x = from.x + (to.x - from.x) * amount;
    camera.y = from.y + (to.y - from.y) * amount;
    camera.pan(0, 0);
  }
}
