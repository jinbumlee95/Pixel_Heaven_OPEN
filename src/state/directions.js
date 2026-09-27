export const DIRECTIONS = Object.freeze([
  'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest',
]);

// Cardinal hints select half-planes; diagonals select strict quadrants.
// Every footprint cell must lie on the requested side of the anchor.
export function matchesDirection(anchor, position, footprint, direction) {
  const left = position.x - anchor.x;
  const right = left + footprint.w - 1;
  const top = position.y - anchor.y;
  const bottom = top + footprint.h - 1;
  switch (direction) {
    case 'north': return bottom < 0;
    case 'south': return top > 0;
    case 'east': return left > 0;
    case 'west': return right < 0;
    case 'northeast': return bottom < 0 && left > 0;
    case 'northwest': return bottom < 0 && right < 0;
    case 'southeast': return top > 0 && left > 0;
    case 'southwest': return top > 0 && right < 0;
    default: return false;
  }
}
