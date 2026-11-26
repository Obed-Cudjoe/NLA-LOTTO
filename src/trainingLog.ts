/**
 * The training ledger, and a pre-registered verdict for a short horizon.
 *
 * "Every draw should train the model" is only meaningful if the training has a
 * scoreboard that cannot be edited after the fact. The ledger below scores the
 * model's own pre-draw line against every draw in the archive, in order, and
 * accumulates hits against what chance would produce. It is derived from the
 * walk-forward backtest, so it grows by one row every evening without anyone
 * having to remember to press anything.
 *
 * The horizon plan is the part that keeps us honest about time: before the next
 * seven draws happen, this says what result would count as evidence and what
 * result would not. That is what separates a training programme from a story.
 */

import type { Draw } from './mathEngine';

/** P(exactly k of the five drawn balls are among five specified numbers). */
export function hypergeomPmf(k: number, population = 90, marked = 5, draws = 5): number {
  const choose = (n: number, r: number): number => {
    if (r < 0 || r > n) return 0;
    let out = 1;
    for (let i = 0; i < r; i++) out = (out * (n - i)) / (i + 1);
    return out;
  };
  return (choose(marked, k) * choose(population - marked, draws - k)) / choose(population, draws);
}

/** Distribution of total hits over `n` independent draws (convolution). */
export function hitsDistribution(n: number): number[] {
  const single = Array.from({ length: 6 }, (_, k) => hypergeomPmf(k));
  let pmf = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(pmf.length + 5).fill(0);
    pmf.forEach((p, j) => single.forEach((q, k) => (next[j + k] += p * q)));
    pmf = next;
  }
  return pmf;
}

/** P(total hits ≥ `threshold`) over `n` draws, exactly. */
export function hitsTail(n: number, threshold: number): number {
  const pmf = hitsDistribution(n);
  let tail = 0;
  for (let h = Math.max(0, Math.floor(threshold)); h < pmf.length; h++) tail += pmf[h] ?? 0;
  return Math.min(1, tail);
}

export interface HorizonPlan {
  draws: number;
  /** Hits the model's published five would produce at chance over the horizon. */
  expectedHits: number;
  /** Smallest hit count that would reach p < 0.05 against chance. */
  threshold: number;
  /** That threshold's actual p-value. */
  thresholdP: number;
  /** Chance of reaching the threshold by luck alone. */
  luckChance: number;
  verdict: string;
}

/**
 * What the next `draws` nights would have to produce to count as evidence.
 */
export function planHorizon(draws = 7, alpha = 0.05): HorizonPlan {
  const expectedHits = draws * 5 * (5 / 90);
  const pmf = hitsDistribution(draws);
  let threshold = 0;
  let thresholdP = 1;
  for (let h = pmf.length - 1; h >= 0; h--) {
    const tail = hitsTail(draws, h);
    if (tail <= alpha) {
      threshold = h;
      thresholdP = tail;
    } else break;
  }
  if (!threshold) {
    threshold = pmf.length - 1;
    thresholdP = hitsTail(draws, threshold);
  }
  return {
    draws,
    expectedHits,
    threshold,
    thresholdP,
    luckChance: thresholdP,
    verdict:
      `Over the next ${draws} draws chance alone gives about ${expectedHits.toFixed(1)} hits across the ` +
      `published five. ${threshold} or more would be p ≈ ${thresholdP.toFixed(3)} — the only result in that ` +
      `window worth calling evidence, and even then it would be a hint, not a finding. Anything below ` +
      `${threshold} is indistinguishable from luck, including a perfect seven-for-seven on pairs.`,
  };
}

export interface LedgerRow {
  draw_date: string;
  game_name: string;
  line5: number[];
  pair: number[];
  trio: number[];
  line5Hits: number;
  pairHit: boolean;
  trioHits: number;
}

export interface LedgerSummary {
  rows: LedgerRow[];
  draws: number;
  totalHits: number;
  expectedHits: number;
  /** Exact one-sided p-value for "the model beats chance" on the five-number line. */
  pValue: number;
  pairHits: number;
  pairExpected: number;
  trioHits: number;
  trioExpected: number;
}

/** Build the ledger from backtest runs, oldest first. */
export function buildLedger(
  runs: ReadonlyArray<{
    draw_date: string;
    game_name: string;
    line5: number[];
    pair: number[];
    trio: number[];
    line5Hits: number;
    matched?: number[];
    winning: number[];
  }>
): LedgerSummary {
  const rows: LedgerRow[] = runs.map((r) => ({
    draw_date: r.draw_date,
    game_name: r.game_name,
    line5: r.line5,
    pair: r.pair,
    trio: r.trio,
    line5Hits: r.line5Hits,
    pairHit: r.pair.every((n) => r.winning.includes(n)),
    trioHits: r.trio.filter((n) => r.winning.includes(n)).length,
  }));
  const draws = rows.length;
  const totalHits = rows.reduce((a, r) => a + r.line5Hits, 0);
  const pairHits = rows.filter((r) => r.pairHit).length;
  const trioHits = rows.reduce((a, r) => a + r.trioHits, 0);
  return {
    rows,
    draws,
    totalHits,
    expectedHits: draws * 5 * (5 / 90),
    pValue: draws ? hitsTail(draws, totalHits) : 1,
    pairHits,
    pairExpected: draws * (10 / 4005),
    trioHits,
    trioExpected: draws * 3 * (5 / 90),
  };
}

/** CSV so the ledger can leave the browser and be checked elsewhere. */
export function ledgerToCsv(summary: LedgerSummary): string {
  const head = 'draw_date,game,line5,pair,trio,line5_hits,pair_hit,trio_hits';
  const body = summary.rows.map((r) =>
    [
      r.draw_date,
      `"${r.game_name}"`,
      `"${r.line5.join(' ')}"`,
      `"${r.pair.join(' ')}"`,
      `"${r.trio.join(' ')}"`,
      r.line5Hits,
      r.pairHit ? 1 : 0,
      r.trioHits,
    ].join(',')
  );
  return [head, ...body].join('\n');
}

/** Convenience for callers holding raw draws: not used by the UI. */
export type LedgerDraw = Draw;
