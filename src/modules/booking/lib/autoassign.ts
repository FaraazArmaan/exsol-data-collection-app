export function pickLeastBusy(
  candidates: { id: string; bookingsToday: number }[],
): string | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (x, y) => x.bookingsToday - y.bookingsToday || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  )[0]!.id;
}
