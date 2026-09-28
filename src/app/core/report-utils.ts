import { midnightIn } from './format';

export type RangeKey = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'custom';

export interface DateRange {
  key: RangeKey;
  /** Inclusive start (UTC instant of local midnight). */
  from: Date;
  /** Exclusive end. */
  to: Date;
  /** Local calendar days in the range, e.g. ['2026-09-18', …]. */
  days: string[];
  label: string;
}

/** Calendar parts of an instant in a timezone. */
export function zoned(iso: string | Date, timeZone: string): { date: string; hour: number; weekday: number } {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    weekday: weekdays.indexOf(get('weekday')),
  };
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Builds a range in the restaurant's timezone. `from`/`to` are 'YYYY-MM-DD' (inclusive) for custom ranges. */
export function buildRange(key: RangeKey, timeZone: string, customFrom?: string, customTo?: string): DateRange {
  const today = zoned(new Date(), timeZone).date;
  let start = today;
  let end = today; // inclusive
  let label = 'Today';
  switch (key) {
    case 'yesterday':
      start = end = addDays(today, -1);
      label = 'Yesterday';
      break;
    case 'last7':
      start = addDays(today, -6);
      label = 'Last 7 days';
      break;
    case 'last30':
      start = addDays(today, -29);
      label = 'Last 30 days';
      break;
    case 'thisMonth':
      start = today.slice(0, 8) + '01';
      label = 'This month';
      break;
    case 'lastMonth': {
      const firstThis = today.slice(0, 8) + '01';
      end = addDays(firstThis, -1);
      start = end.slice(0, 8) + '01';
      label = 'Last month';
      break;
    }
    case 'custom':
      start = customFrom || today;
      end = customTo && customTo >= start ? customTo : start;
      label = start === end ? start : `${start} → ${end}`;
      break;
  }
  const days: string[] = [];
  for (let d = start; d <= end && days.length < 400; d = addDays(d, 1)) days.push(d);
  return {
    key,
    from: midnightIn(start, timeZone),
    to: midnightIn(addDays(end, 1), timeZone),
    days,
    label,
  };
}

export function inRange(iso: string | undefined | null, range: DateRange): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= range.from.getTime() && t < range.to.getTime();
}

/** Downloads rows as a CSV file (Excel-friendly, UTF-8 with BOM). */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]): void {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Cents → plain decimal string for CSV (1450 → "14.50"). */
export function csvMoney(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toFixed(2);
}
