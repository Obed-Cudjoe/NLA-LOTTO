/**
 * The pick book: every line this site has committed to, locked *before* the
 * draw and scored *after* it.
 *
 * Why keep a record at all? Anybody can name five numbers. Publishing what was
 * said, with the timestamp, before the result is the only way a reader can tell
 * skill from luck afterwards — and the arithmetic already tells us what the
 * record will look like: a five-number line lands all five about once in 44
 * million draws, a 2-Sure pair about once in 401. A book that sits at those
 * rates is a book that is behaving exactly as a fair drum implies.
 *
 * The scoring is deliberately blunt. No weighting, no "close enough", no
 * excusing a miss as a near-hit.
 */

import type { Draw, Deduction } from './mathEngine';

export interface PickRecord {
  /** The draw this line was locked for (YYYY-MM-DD). */
  draw_date: string;
  game: string;
  /** Five numbers, strongest first. Order is irrelevant to Direct 5 / Perm 5. */
  five: number[];
  /** The 2-Sure pair — both must be drawn. */
  pair: number[];
  /** The 3-Direct trio — all three must be drawn. */
  trio: number[];
  /** ISO timestamp of the commitment. Anything later is hindsight. */
  locked_at: string;
}

export interface ScoredPick extends PickRecord {
  /** The winning numbers, once the draw is known. */
  drawn: number[] | null;
  /** How many of the five numbers appeared. */
  matches: number[];
  five_hit: boolean;
  pair_hit: boolean;
  trio_hit: boolean;
}

export interface PickBookReport {
  locked: number;
  resolved: number;
  fiveHits: number;
  pairHits: number;
  trioHits: number;
  /** Draws where three or more of the five numbers came out. */
  threeHits: number;
  matches: number;
  expectedMatches: number;
  expectedPairHits: number;
  expectedTrioHits: number;
  verdict: string;
}

/** Exact chance a specific pair appears among the five drawn numbers. */
export const PAIR_CHANCE = 10 / 4005; // C(5,2)/C(90,2) = 1 in 400.5
/** Exact chance a specific trio appears. */
export const TRIO_CHANCE = 10 / 117480; // C(5,3)/C(90,3) = 1 in 11,748
/** Chance a specific five-number line is the drawn five. */
export const FIVE_CHANCE = 1 / 43949268;

export function emptyReport(): PickBookReport {
  return {
    locked: 0,
    resolved: 0,
    fiveHits: 0,
    pairHits: 0,
    trioHits: 0,
    threeHits: 0,
    matches: 0,
    expectedMatches: 0,
    expectedPairHits: 0,
    expectedTrioHits: 0,
    verdict: 'No line has been locked yet. The record starts with the next draw you commit to.',
  };
}

/** The line this site would play for the deduction it is showing. */
export function pickFromDeduction(d: Deduction, lockedAt = new Date().toISOString()): PickRecord {
  const five = d.evidence.slice(0, 5).map((e) => e.number);
  return {
    draw_date: d.next.date,
    game: d.next.game,
    five,
    pair: five.slice(0, 2),
    trio: d.trio.numbers.slice(0, 3),
    locked_at: lockedAt,
  };
}

/**
 * Add a line to the book, replacing any earlier commitment for the same draw.
 * A pick may be rewritten before its draw, but never after: the caller passes
 * the existing book, so re-locking today's line simply updates it.
 */
export function lockPick(book: PickRecord[], pick: PickRecord): PickRecord[] {
  const key = (p: PickRecord): string => `${p.draw_date}|${p.game.toLowerCase()}`;
  const next = [...book.filter((p) => key(p) !== key(pick)), pick];
  return next.sort((a, b) => a.draw_date.localeCompare(b.draw_date));
}

const same = (a: number, b: number): boolean => a === b;

/** Score every locked line against the draws that actually happened. */
export function scorePickBook(
  book: PickRecord[],
  draws: Draw[]
): { rows: ScoredPick[]; report: PickBookReport } {
  const byDate = new Map<string, Draw>();
  for (const d of draws) byDate.set(d.draw_date, d);

  const rows: ScoredPick[] = book.map((pick) => {
    const exact = byDate.get(pick.draw_date);
    // A draw is only a result if it is for the same game; a date carries one game.
    const draw = exact && exact.game_name.toLowerCase() === pick.game.toLowerCase() ? exact : null;
    const drawn = draw ? [...draw.winning] : null;
    const matches = drawn ? pick.five.filter((n) => drawn.some((x) => same(x, n))) : [];
    const has = (n: number): boolean => Boolean(drawn && drawn.some((x) => same(x, n)));
    return {
      ...pick,
      drawn,
      matches,
      five_hit: matches.length === 5,
      pair_hit: Boolean(drawn) && pick.pair.every(has),
      trio_hit: Boolean(drawn) && pick.trio.every(has),
    };
  });

  const resolvedRows = rows.filter((r) => r.drawn);
  const resolved = resolvedRows.length;
  const report: PickBookReport = {
    locked: rows.length,
    resolved,
    fiveHits: resolvedRows.filter((r) => r.five_hit).length,
    pairHits: resolvedRows.filter((r) => r.pair_hit).length,
    trioHits: resolvedRows.filter((r) => r.trio_hit).length,
    threeHits: rowThrees(resolvedRows),
    matches: resolvedRows.reduce((sum, r) => sum + r.matches.length, 0),
    expectedMatches: resolved * 5 * (5 / 90),
    expectedPairHits: resolved * PAIR_CHANCE,
    expectedTrioHits: resolved * TRIO_CHANCE,
    verdict: '',
  };
  report.verdict = verdictFor(report);
  return { rows, report };
}

function rowThrees(rows: ScoredPick[]): number {
  return rows.filter((r) => r.matches.length >= 3).length;
}

/**
 * The verdict is written before the numbers arrive, in the sense that its
 * thresholds are fixed: small samples say nothing, and a hit at the expected
 * rate is not evidence of anything.
 */
function verdictFor(r: PickBookReport): string {
  if (r.resolved === 0) {
    return r.locked === 0
      ? 'No line locked yet.'
      : 'Locked and waiting for the draw — the result gets scored automatically once it is stored.';
  }
  if (r.resolved < 20) {
    return `${r.resolved} resolved draw${r.resolved === 1 ? '' : 's'}: too few to say anything. The book exists so the answer arrives eventually, not so it can be asserted now.`;
  }
  const pairGap = r.pairHits - r.expectedPairHits;
  const within = Math.abs(pairGap) <= Math.max(1, 2 * Math.sqrt(Math.max(r.expectedPairHits, 0.25)));
  if (r.pairHits > r.expectedPairHits && !within) {
    return `Pair hits are above chance (${r.pairHits} vs ${r.expectedPairHits.toFixed(2)} expected). That is worth investigating, not celebrating — one run of luck looks like this.`;
  }
  if (r.pairHits < r.expectedPairHits && !within) {
    return `Pair hits are below chance (${r.pairHits} vs ${r.expectedPairHits.toFixed(2)} expected). The model is doing worse than picking at random.`;
  }
  return `Sitting at chance: ${r.pairHits} pair hits against ${r.expectedPairHits.toFixed(2)} expected, ${r.matches} of ${r.resolved * 5} numbers drawn against ${r.expectedMatches.toFixed(1)} expected. That is what a fair drum does to any method.`;
}

/** CSV of the book, for anyone who wants to check the scoring elsewhere. */
export function pickBookToCsv(rows: ScoredPick[]): string {
  const head = [
    'draw_date',
    'game',
    'five',
    'pair',
    'trio',
    'locked_at',
    'drawn',
    'matches',
    'five_hit',
    'pair_hit',
    'trio_hit',
  ].join(',');
  const body = rows.map((r) =>
    [
      r.draw_date,
      `"${r.game}"`,
      `"${r.five.join(' ')}"`,
      `"${r.pair.join(' ')}"`,
      `"${r.trio.join(' ')}"`,
      r.locked_at,
      `"${(r.drawn ?? []).join(' ')}"`,
      r.matches.length,
      r.five_hit ? 'yes' : 'no',
      r.pair_hit ? 'yes' : 'no',
      r.trio_hit ? 'yes' : 'no',
    ].join(',')
  );
  return [head, ...body].join('\n');
}
