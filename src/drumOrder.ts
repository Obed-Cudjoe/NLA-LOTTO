/**
 * Can the drum's timing be read back out of the numbers?
 *
 * No — and this module exists to say so with a test rather than an opinion.
 *
 * The idea is tempting: if the guest's walk and the shake length change which
 * balls leave, then the winning numbers should carry a trace of them. But the
 * record only holds the outcome, and the outcome is many-to-one: a hundred
 * different shake lengths can leave the same five balls. Nothing about a result
 * records a duration, so no amount of arithmetic recovers one. Only a stopwatch
 * on the broadcast can, which is what the timing journal is for.
 *
 * What the record *does* hold is the order the balls left. That is a real fact
 * about the machine, published every evening, and it can be tested: are the
 * numbers that come out first drawn from the same distribution as the ones that
 * come out fifth? A machine that mixes unevenly would show it here.
 *
 * So this module asks the one question the data can answer, and says plainly
 * that it is not the question about walk times.
 */

const BALLS = 90;

/** Nine equal buckets of ten, so each bucket holds the same number of balls. */
export function decadeOf(n: number): number {
  return Math.min(8, Math.floor((n - 1) / 10));
}

/**
 * Upper tail of the chi-square distribution: P(X >= chi) with `df` degrees of
 * freedom, via the regularised upper incomplete gamma Q(df/2, chi/2).
 */
export function chiSquareTail(chi: number, df: number): number {
  if (!(chi > 0)) return 1;
  if (!(df > 0)) return Number.NaN;
  const a = df / 2;
  const x = chi / 2;
  const gln = lnGamma(a);
  if (x < a + 1) {
    // Series for the lower regularised gamma.
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 200; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    const p = sum * Math.exp(-x + a * Math.log(x) - gln);
    return Math.max(0, Math.min(1, 1 - p));
  }
  // Continued fraction for the upper tail.
  let b = x + 1 - a;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.max(0, Math.min(1, Math.exp(-x + a * Math.log(x) - gln) * h));
}

function lnGamma(z: number): number {
  // Lanczos, good to ~1e-10 for the small arguments used here.
  const g = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += g[j] / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

export interface OrderTest {
  /** Draws that contributed (those with five ordered winning numbers). */
  draws: number;
  chi: number;
  df: number;
  p: number;
  /** Largest bucket's share of first balls, against the 1/9 a fair drum gives. */
  topBucketShare: number;
  verdict: string;
}

/**
 * Are the first balls drawn with the same number-of-decade distribution a fair
 * drum would give? Nine buckets, eight degrees of freedom.
 */
export function firstBallTest(draws: ReadonlyArray<{ winning: number[] }>): OrderTest {
  const usable = draws.filter((d) => d.winning.length >= 1 && d.winning.every((n) => n >= 1 && n <= BALLS));
  const counts = new Array(9).fill(0);
  for (const d of usable) counts[decadeOf(d.winning[0])] += 1;
  const n = usable.length;
  const expected = n / 9;
  let chi = 0;
  if (n) for (const c of counts) chi += (c - expected) ** 2 / expected;
  const df = 8;
  const p = n ? chiSquareTail(chi, df) : 1;
  const top = n ? Math.max(...counts) / n : 0;
  return {
    draws: n,
    chi,
    df,
    p,
    topBucketShare: top,
    verdict: !n
      ? 'No draws with ordered winning numbers yet.'
      : p < 0.05
        ? `The first ball is not spread evenly across the nine buckets (p = ${p.toFixed(3)}). Worth watching, not yet a finding — the archive is small and this was one test among many.`
        : `The first ball is spread across the nine buckets about as evenly as a fair drum gives (p = ${p.toFixed(2)}). Nothing here says the machine favours any part of the drum.`,
  };
}

export interface PositionRow {
  position: number;
  meanNumber: number;
  /** Share of this position's balls that fall in the lowest bucket (1–10). */
  lowBucketShare: number;
}

/** Mean number and low-bucket share by release position — a shape check. */
export function positionProfile(draws: ReadonlyArray<{ winning: number[] }>): PositionRow[] {
  const usable = draws.filter((d) => d.winning.length >= 5);
  return Array.from({ length: 5 }, (_, i) => {
    const values = usable.map((d) => d.winning[i]);
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : Number.NaN;
    const low = values.filter((v) => v <= 10).length;
    return {
      position: i + 1,
      meanNumber: mean,
      lowBucketShare: values.length ? low / values.length : Number.NaN,
    };
  });
}

/** One-line answer to "can you predict the press timing from the results?" */
export const TIMING_IS_NOT_IN_THE_NUMBERS =
  'A result records which five balls left, never when or for how long. Many different press timings ' +
  'produce the same five numbers, so the timing cannot be recovered from them — only measured on the ' +
  'night, which is what the stopwatch and the journal do.';
