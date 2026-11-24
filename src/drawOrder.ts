/**
 * Does the archive show any positional bias?
 *
 * NLA publishes the five winning numbers *in the order they left the machine*,
 * and Direct 1 pays only when your number is the FIRST one drawn. So the first
 * ball is the one quantity a machine-timing theory would have to move, and it
 * is also the only one that can be tested cleanly: the first release is an
 * unconditional draw from all 90 balls, so under a fair drum its distribution
 * is exactly uniform. Later releases are sampled without replacement, which
 * makes their marginal uniform too but their deviations correlated — testing
 * position 1 alone is the honest, high-power question.
 *
 * Everything here is a test, not a prediction. A p-value says whether the
 * deviation seen could easily be chance; it never says a number is "due".
 */

import type { Draw } from './mathEngine';

const N = 90;

/** Deterministic xorshift32 so a Monte-Carlo p-value is reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export interface FirstBallCount {
  number: number;
  count: number;
  /** count / expected — 1.00 means exactly as often as chance predicts. */
  lift: number;
}

export interface OrderReport {
  /** Draws that carried a usable first ball. */
  draws: number;
  expectedPerBall: number;
  counts: FirstBallCount[];
  hottest: FirstBallCount[];
  coldest: FirstBallCount[];
  /** Sum of squares against the uniform expectation. */
  chiSquare: number;
  df: number;
  /** Monte-Carlo p-value: how often a fair drum would look this skewed. */
  pValue: number;
  /** Smallest per-ball lift this many draws could detect, at 5% / 80% power. */
  detectableLift: number;
  verdict: string;
  caveat: string;
}

const EMPTY: OrderReport = {
  draws: 0,
  expectedPerBall: 0,
  counts: [],
  hottest: [],
  coldest: [],
  chiSquare: 0,
  df: N - 1,
  pValue: 1,
  detectableLift: Number.POSITIVE_INFINITY,
  verdict: 'No draws yet.',
  caveat: '',
};

/** Chi-square statistic for n first-ball draws against uniform(90). */
export function chiSquareUniform(observed: number[], n: number): number {
  if (n <= 0) return 0;
  const expected = n / N;
  return observed.reduce((sum, count) => sum + ((count - expected) * (count - expected)) / expected, 0);
}

/**
 * Smallest first-ball probability (relative to 1/90) that `n` draws could
 * detect, via a two-sided binomial test at 5% with 80% power.
 */
export function detectableLift(n: number): number {
  if (!(n > 0)) return Number.POSITIVE_INFINITY;
  const p0 = 1 / N;
  const zA = 1.959964;
  const zB = 0.841621;
  // Solve numerically for the smallest p > p0 that satisfies the power formula.
  const need = (p: number) => {
    const num = zA * Math.sqrt(p0 * (1 - p0)) + zB * Math.sqrt(p * (1 - p));
    return (num * num) / ((p - p0) * (p - p0));
  };
  // `need` falls as p rises, so the feasible set {p : need(p) <= n} is an upper
  // interval; bisect for its lower edge.
  let lo = p0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (need(mid) > n) lo = mid;
    else hi = mid;
  }
  return hi / p0;
}

/**
 * Analyse the first ball of every draw.
 *
 * `simulations` controls the Monte-Carlo p-value: it re-draws `n` uniform first
 * balls from a fixed seed and counts how often the skew matches or exceeds the
 * observed one. 2,000 is plenty for a verdict; 20,000 for a publishable number.
 */
export function analyseDrawOrder(
  draws: readonly Draw[],
  { simulations = 4000, seed = 20261123 }: { simulations?: number; seed?: number } = {}
): OrderReport {
  const usable = draws.filter(
    (d) => Array.isArray(d.winning) && d.winning.length > 0 && d.winning.every((n) => Number.isInteger(n) && n >= 1 && n <= N)
  );
  const n = usable.length;
  if (!n) return EMPTY;

  const observed = new Array<number>(N).fill(0);
  for (const d of usable) observed[d.winning[0] - 1] += 1;

  const chiSquare = chiSquareUniform(observed, n);
  const counts: FirstBallCount[] = observed.map((count, i) => ({
    number: i + 1,
    count,
    lift: count / (n / N),
  }));

  // Monte-Carlo null: n independent uniform first balls.
  const rand = rng(seed);
  let atLeastAsExtreme = 0;
  const simCounts = new Array<number>(N).fill(0);
  for (let s = 0; s < simulations; s++) {
    simCounts.fill(0);
    for (let i = 0; i < n; i++) simCounts[Math.floor(rand() * N)] += 1;
    if (chiSquareUniform(simCounts, n) >= chiSquare - 1e-12) atLeastAsExtreme += 1;
  }
  const pValue = (atLeastAsExtreme + 1) / (simulations + 1);

  const sorted = [...counts].sort((a, b) => b.count - a.count || a.number - b.number);
  const lift = detectableLift(n);
  const expected = n / N;

  const verdict =
    pValue >= 0.05
      ? `Consistent with a fair drum: ${n} draws show no more first-ball skew than chance produces (p = ${pValue.toFixed(2)}). Timing and mixing cannot be used to pick the first ball from this evidence.`
      : `Unusual skew (p = ${pValue.toFixed(3)}) — with ${n} draws that is worth a second look, but a single test at this sample size is also exactly how false positives happen. Collect more draws before believing it.`;

  return {
    draws: n,
    expectedPerBall: expected,
    counts,
    hottest: sorted.slice(0, 5),
    coldest: sorted.slice(-5).reverse(),
    chiSquare,
    df: N - 1,
    pValue,
    detectableLift: lift,
    verdict,
    caveat: `With ${n} draws this test can only detect a first ball appearing about ${lift.toFixed(1)}× more often than 1 in 90. The published order is taken at face value: if a source re-sorts its numbers, the position analysis is meaningless — worth checking on your source.`,
  };
}

/**
 * Frequency of each number in the first position, as a sparse list — handy for
 * drawing a compact chart without shipping 90 buckets.
 */
export function firstBallHistogram(report: OrderReport): Array<{ number: number; count: number }> {
  return report.counts.filter((c) => c.count > 0).map(({ number, count }) => ({ number, count }));
}
