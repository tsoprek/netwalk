export type CompactCardColumn = 1 | 2;

/**
 * Assign source-ordered compact cards to the currently shorter column.
 * A card with a second content region (for example a booking note) occupies
 * two logical places; ordinary cards occupy one. Actual pixel height remains
 * measured by the card wrapper, while this stable assignment prevents the
 * browser's initial one-row placement from leaving a hole beside tall cards.
 */
export function assignCompactCardColumns(secondRegion: readonly boolean[]): CompactCardColumn[] {
  const occupied = [0, 0];
  return secondRegion.map((hasSecondRegion) => {
    const index = occupied[0] <= occupied[1] ? 0 : 1;
    occupied[index] += hasSecondRegion ? 2 : 1;
    return (index + 1) as CompactCardColumn;
  });
}
