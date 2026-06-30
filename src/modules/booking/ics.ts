// Minimal RFC-5545 .ics generation for "Add to calendar" — fully client-side,
// no external service. Times emitted as UTC basic format YYYYMMDDTHHMMSSZ.

function toIcsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function buildIcs(o: { uid: string; title: string; startIso: string; endIso: string; stampIso?: string }): string {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ExSol//Booking//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${o.uid}`,
    `DTSTAMP:${toIcsUtc(o.stampIso ?? o.startIso)}`,
    `DTSTART:${toIcsUtc(o.startIso)}`,
    `DTEND:${toIcsUtc(o.endIso)}`,
    `SUMMARY:${o.title}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

export function downloadIcs(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
