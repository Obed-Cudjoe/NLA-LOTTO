/**
 * When the result reached us.
 *
 * The drum's own running time is invisible in public data: no source publishes
 * how long it mixed before the first ball left, and no source publishes how long
 * the invited guest took to walk to the button. So the site does not pretend to
 * know either. What it can do — honestly, with a timestamp it produced itself —
 * is record the moment each result first appeared in its archive.
 *
 * That number measures the machine from the closing bell to our copy of the
 * outcome: network, scraping, refresh. It is not the shake and it is not the
 * walk. Writing the difference down is what keeps the two from being confused,
 * because "the result came at 20:46" is the kind of fact that gets retold as
 * "the draw took 46 minutes".
 */

import { DRAW_CLOSE_UTC_MINUTES } from './mathEngine';

export interface LatencyRecord {
  /** ISO date of the draw this result belongs to. */
  draw_date: string;
  game_name: string;
  /** ISO timestamp of the first poll that saw this result. */
  firstSeenAt: string;
  /** Minutes from the 20:30 GMT closing bell to that first sighting. */
  minutesAfterClose: number;
}

const CLOSE_MINUTES = DRAW_CLOSE_UTC_MINUTES;

/** UTC minutes-since-midnight for `draw_date` at the closing bell. */
function closeInstant(draw_date: string): number {
  return Date.parse(`${draw_date}T00:00:00Z`) + CLOSE_MINUTES * 60_000;
}

/**
 * Add first-sighting timestamps for draws we have not seen before.
 * Existing records are never rewritten: the first sighting is the fact.
 */
export function mergeSightings(
  existing: readonly LatencyRecord[],
  draws: ReadonlyArray<{ draw_date: string; game_name: string }>,
  nowIso: string
): LatencyRecord[] {
  const known = new Set(existing.map((r) => `${r.draw_date}|${r.game_name}`));
  const now = Date.parse(nowIso);
  const added: LatencyRecord[] = [];
  for (const d of draws) {
    const key = `${d.draw_date}|${d.game_name}`;
    if (known.has(key)) continue;
    known.add(key);
    const minutesAfterClose = Math.max(0, Math.round((now - closeInstant(d.draw_date)) / 60_000));
    added.push({ draw_date: d.draw_date, game_name: d.game_name, firstSeenAt: nowIso, minutesAfterClose });
  }
  return added.length ? [...existing, ...added].sort((a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt)) : [...existing];
}

export interface LatencySummary {
  records: number;
  /** Median minutes after the closing bell, or null when nothing is recorded. */
  medianMinutes: number | null;
  fastest: LatencyRecord | null;
  slowest: LatencyRecord | null;
  /** Results that arrived before the bell (a next-day pull, usually). */
  late: number;
}

export function summariseLatency(records: readonly LatencyRecord[]): LatencySummary {
  if (!records.length) {
    return { records: 0, medianMinutes: null, fastest: null, slowest: null, late: 0 };
  }
  const sorted = [...records].sort((a, b) => a.minutesAfterClose - b.minutesAfterClose);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 ? sorted[mid].minutesAfterClose : (sorted[mid - 1].minutesAfterClose + sorted[mid].minutesAfterClose) / 2;
  return {
    records: sorted.length,
    medianMinutes: median,
    fastest: sorted[0],
    slowest: sorted[sorted.length - 1],
    late: sorted.filter((r) => r.minutesAfterClose > 240).length,
  };
}

/** Human wording for a gap in minutes, without inventing precision. */
export function describeGap(minutes: number): string {
  if (minutes < 1) return 'under a minute after the bell';
  if (minutes < 60) return `${Math.round(minutes)} min after the bell`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min after the bell` : `${h} h after the bell`;
}

export function latencyToCsv(records: readonly LatencyRecord[]): string {
  const head = 'draw_date,game,first_seen_utc,minutes_after_close';
  return [head, ...records.map((r) => [r.draw_date, `"${r.game_name}"`, r.firstSeenAt, r.minutesAfterClose].join(','))].join('\n');
}
