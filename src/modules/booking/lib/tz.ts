// DST-safe timezone helpers using only the built-in Intl API (no date library).
// Strategy: format a UTC guess into the target zone, measure the offset, correct once.

function partsInZone(instant: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) map[p.type] = p.value;
  const hour = map.hour === '24' ? 0 : Number(map.hour); // Intl can emit '24'
  return {
    y: Number(map.year), m: Number(map.month), d: Number(map.day),
    hh: hour, mm: Number(map.minute), ss: Number(map.second),
    weekday: (map.weekday ?? '').toLowerCase().slice(0, 3),
  };
}

/** Offset (ms) of `timeZone` from UTC at the given instant: localWallAsUTC - instant. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = partsInZone(instant, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - instant.getTime();
}

/** Convert a zone-naive wall-clock ("YYYY-MM-DDTHH:mm:ss") to the UTC instant in `timeZone`. */
export function zonedToUtc(localWall: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localWall);
  if (!m) throw new Error(`bad wall-clock: ${localWall}`);
  const naiveUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, m[6] ? +m[6] : 0);
  // First guess: treat the wall-clock as if it were UTC, then subtract the zone offset.
  const guess = new Date(naiveUtc);
  const off1 = zoneOffsetMs(guess, timeZone);
  const corrected = new Date(naiveUtc - off1);
  // Re-measure once to settle DST boundaries where the offset itself shifted.
  const off2 = zoneOffsetMs(corrected, timeZone);
  return off2 === off1 ? corrected : new Date(naiveUtc - off2);
}

export function utcToZonedParts(instant: Date, timeZone: string) {
  const p = partsInZone(instant, timeZone);
  return { y: p.y, m: p.m, d: p.d, hh: p.hh, mm: p.mm, weekday: p.weekday };
}

export function addMinutes(instant: Date, mins: number): Date {
  return new Date(instant.getTime() + mins * 60_000);
}
