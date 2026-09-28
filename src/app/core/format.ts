/** Integer cents → "$14.50" in the restaurant's currency. */
export function formatMoney(cents: number | null | undefined, currency: string, locale: string): string {
  const value = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/** A user-typed amount ("14.5") → integer cents (1450). */
export function toCents(amount: number | string | null | undefined): number {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount ?? 0;
  return Number.isFinite(n) ? Math.round((n as number) * 100) : 0;
}

export type DateStyle = 'date' | 'time' | 'datetime' | 'relative';

export function formatDate(iso: string | Date | null | undefined, style: DateStyle, timeZone: string, locale: string): string {
  if (!iso) return '';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return '';
  if (style === 'relative') return relative(date, locale);
  const options: Intl.DateTimeFormatOptions =
    style === 'date'
      ? { dateStyle: 'medium' }
      : style === 'time'
      ? { timeStyle: 'short' }
      : { dateStyle: 'medium', timeStyle: 'short' };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function relative(date: Date, locale: string): string {
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86400), 'day');
}

/** The UTC instant of midnight "today" in the given IANA timezone. */
export function startOfTodayIn(timeZone: string): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Wall-clock time in the zone, read as if it were UTC, minus the real instant = zone offset.
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offsetMs = wallAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')) - offsetMs);
}

/** Random key for the Idempotency-Key header (one per payment attempt). */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** "The Golden Fork" → "the-golden-fork" (matches the backend's slug rule). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Cents → plain decimal for an <input type="number"> (1450 → 14.5). */
export function fromCents(cents: number | null | undefined): number | null {
  return cents === null || cents === undefined ? null : cents / 100;
}

/** Up to 3 decimals, without trailing zeros: 287.5 → "287.5", 2 → "2". */
export function formatQty(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '0';
  return String(Math.round(n * 1000) / 1000);
}

/** "2026-09-24" → the UTC instant of that day's midnight in the given IANA timezone. */
export function midnightIn(dateStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return new Date(guess - (wallAsUtc - guess));
}
