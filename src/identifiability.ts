/**
 * Why "reverse engineer the timing from past games" cannot be done — and what
 * the archive could detect if the machine were biased at all.
 *
 * Reverse engineering needs two things: an observation of the input, and a
 * mapping from input to output that can be inverted. Here there is neither. The
 * input (how long the guest walked, how long the drum mixed) is never recorded;
 * the output is five balls. Between them sits a physical process that loses
 * information: thousands of shake durations end in the same five numbers.
 *
 * So the honest substitute is a power calculation. If the machine did favour
 * part of the drum — the only bias the record could show — how large would that
 * bias have to be before this many draws could see it? That number is the real
 * answer to "can we work it out backwards", and it is measurable.
 */

import { firstBallTest, decadeOf } from './drumOrder';

export interface PowerPoint {
  /** Tilt applied to the favoured bucket, as a multiplicative factor. */
  effect: number;
  draws: number;
  /** Fraction of simulated archives that would reject uniformity at 0.05. */
  power: number;
}

/**
 * Monte-Carlo power of the first-ball test against a tilted drum.
 *
 * The null is nine equal buckets. The alternative favours one bucket by
 * `effect` and shrinks the other eight to keep the probabilities summing to one
 * — a simple, generous model of "the drum is not even".
 */
export function powerToDetect(effect: number, draws: number, sims = 300, seed = 20261127): number {
  let hits = 0;
  let s = seed >>> 0;
  const rand = (): number => {
    // xorshift32 — deterministic, so the reported power never drifts.
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const favoured = (1 + effect) / 9;
  const rest = (1 - favoured) / 8;
  for (let k = 0; k < sims; k++) {
    const counts = new Array(9).fill(0);
    for (let i = 0; i < draws; i++) {
      const u = rand();
      const bucket = u < favoured ? 0 : 1 + Math.min(7, Math.floor(((u - favoured) / (1 - favoured)) * 8));
      counts[bucket] += 1;
    }
    const expected = draws / 9;
    let chi = 0;
    for (const c of counts) chi += (c - expected) ** 2 / expected;
    if (pFromChi(chi, 8) < 0.05) hits += 1;
  }
  return hits / sims;
}

/** Local chi-square tail, so the simulation does not depend on its own report. */
function pFromChi(chi: number, df: number): number {
  // Wilson–Hilferty is too crude for a power curve; use the same incomplete
  // gamma as the live test via a small re-implementation to keep this module
  // self-contained and testable in isolation.
  const a = df / 2;
  const x = chi / 2;
  const gln = lnGamma(a);
  let sum = 1 / a;
  let ap = a;
  let del = sum;
  for (let n = 0; n < 200; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
  }
  const lower = sum * Math.exp(-x + a * Math.log(x) - gln);
  return Math.max(0, Math.min(1, 1 - lower));
}

function lnGamma(z: number): number {
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

export interface DetectionPlan {
  /** Draws needed for 80% power at this tilt, by bisection on the power curve. */
  drawsFor80: number;
  headline: string;
}

/** How long an archive must be before a tilt of this size shows up. */
export function drawsForPower(effect: number, target = 0.8, sims = 200): number {
  let lo = 20;
  let hi = 4000;
  for (let step = 0; step < 12; step++) {
    const mid = Math.round((lo + hi) / 2);
    if (powerToDetect(effect, mid, sims) >= target) hi = mid;
    else lo = mid;
    if (hi - lo <= 8) break;
  }
  return hi;
}

/**
 * The identifiability statement, in one sentence a reader can hold on to.
 */
export const NO_INVERSE =
  'Reverse engineering needs the input and a mapping that can be inverted. The input — how long the guest ' +
  'walked, how long the drum mixed — is never recorded, and thousands of timings end in the same five ' +
  'numbers. Under any fair-drum model the timing and the result are independent, so the result carries ' +
  'zero bits about the timing: every timing schedule is equally consistent with the archive.';

/** What the archive can say about the drum itself, phrased as a size question. */
export function whatTheArchiveCanSee(draws: number): string {
  const tilt20 = Math.round(powerToDetect(0.2, draws, 400) * 100);
  const tilt40 = Math.round(powerToDetect(0.4, draws, 400) * 100);
  const need20 = drawsForPower(0.2);
  const need40 = drawsForPower(0.4);
  return (
    `With ${draws} draws this test catches a 20% tilt in the drum ${tilt20}% of the time and a 40% tilt ` +
    `${tilt40}% of the time. Reaching 80% power needs roughly ${need20} draws for the smaller tilt and ` +
    `${need40} for the larger — about ${(need20 / 6).toFixed(0)} to ${(need40 / 6).toFixed(0)} weeks of ` +
    `six-night weeks, and only for a bias that would already be obvious to the naked eye.`
  );
}

/** Sanity helper used by the tests: the observed first-ball test at this size. */
export function observeFirstBall(draws: ReadonlyArray<{ winning: number[] }>): ReturnType<typeof firstBallTest> {
  return firstBallTest(draws);
}

export { decadeOf };
