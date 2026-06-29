import { zonedToUtc, addMinutes } from './tz';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type OpenWindow = { open: string; close: string };          // "HH:mm"
export type DaySchedule = Record<Weekday, OpenWindow[]>;
export type Interval = { start: Date; end: Date };
export type Slot = { startUtc: Date; endUtc: Date; resourceId: string };

export interface AvailabilityInput {
  date: string;            // YYYY-MM-DD, tenant-local
  timeZone: string;
  slotIntervalMin: number;
  leadTimeMin: number;
  now: Date;
  tenantWeekly: DaySchedule;
  service: { durationMin: number; bufferMin: number };
  resources: { id: string; weekly: DaySchedule | null; busy: Interval[] }[];
}

const ORDER: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function weekdayOf(dateYmd: string): Weekday {
  // Noon UTC avoids any date rollover; weekday of a calendar date is zone-stable enough here.
  const d = new Date(`${dateYmd}T12:00:00.000Z`);
  return ORDER[d.getUTCDay()]!;
}
function hhmmToMin(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function minToHHmm(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}
function intersectWindows(a: OpenWindow[], b: OpenWindow[]): OpenWindow[] {
  const out: OpenWindow[] = [];
  for (const x of a) for (const y of b) {
    const open = Math.max(hhmmToMin(x.open), hhmmToMin(y.open));
    const close = Math.min(hhmmToMin(x.close), hhmmToMin(y.close));
    if (close > open) out.push({ open: minToHHmm(open), close: minToHHmm(close) });
  }
  return out;
}

export function computeAvailability(input: AvailabilityInput): Slot[] {
  const wd = weekdayOf(input.date);
  const tenantWins = input.tenantWeekly[wd] ?? [];
  const earliest = addMinutes(input.now, input.leadTimeMin);
  const footprint = input.service.durationMin + input.service.bufferMin;
  const slots: Slot[] = [];

  for (const r of input.resources) {
    const resWins = r.weekly ? (r.weekly[wd] ?? []) : tenantWins;     // null weekly = inherit tenant
    const windows = r.weekly ? intersectWindows(tenantWins, resWins) : tenantWins;
    for (const w of windows) {
      const winOpen = zonedToUtc(`${input.date}T${w.open}:00`, input.timeZone);
      const winClose = zonedToUtc(`${input.date}T${w.close}:00`, input.timeZone);
      for (let start = winOpen; ; start = addMinutes(start, input.slotIntervalMin)) {
        const end = addMinutes(start, footprint);
        if (end > winClose) break;
        if (start < earliest) continue;
        const cand: Interval = { start, end };
        if (r.busy.some((b) => overlaps(cand, b))) continue;
        slots.push({ startUtc: start, endUtc: addMinutes(start, input.service.durationMin), resourceId: r.id });
      }
    }
  }
  return slots;
}
