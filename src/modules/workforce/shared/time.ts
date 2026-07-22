const FALLBACK_TIME_ZONE = 'UTC';

function dateValue(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid Workforce time value.');
  return date;
}

export function workforceTimeZone(timeZone?: string | null): string {
  if (!timeZone) return FALLBACK_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return timeZone;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

export function workforceDateKey(value: string | Date, timeZone?: string | null): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: workforceTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dateValue(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatWorkforceTime(value: string | Date, timeZone?: string | null): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: workforceTimeZone(timeZone),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(dateValue(value));
}

export function formatWorkforceDate(value: string | Date, timeZone?: string | null): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: workforceTimeZone(timeZone),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(dateValue(value));
}

export function formatWorkforceDateKey(value: string): string {
  return formatWorkforceDate(`${value}T12:00:00.000Z`, 'UTC');
}
