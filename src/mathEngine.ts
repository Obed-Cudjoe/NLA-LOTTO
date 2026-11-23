/**
 * ---------------------------------------------------------------------------
 * Ghana NLA 5/90 — Mathematical & Logical Deduction Engine
 * ---------------------------------------------------------------------------
 * Pure TypeScript. No I/O, no DOM, no external dependencies. The exact same
 * code powers the Cloudflare Worker, the browser (GitHub Pages build) and the
 * test suite, so a backtest run in the UI is provably the same algorithm the
 * API returns.
 *
 * Four pillars:
 *   1. Bayesian posterior probability  — Beta-Binomial conjugate update
 *   2. Poisson inter-arrival & z-score — overdue / anomaly detection
 *   3. First-order Markov chain        — 90x90 transition matrix
 *   4. Combinatorial & entropy filter  — chooses the trio that survives
 *
 * HONESTY NOTE (read this):
 * A 5/90 draw is designed to be independent and uniform. Under those
 * assumptions every pillar above is descriptive, not predictive: the expected
 * hit rate of any fixed strategy equals chance, and NLA 5/90 prize tiers are
 * fixed odds, so no number selection changes expected value. This engine is
 * built to *test* that claim on your own data — see `backtest()` and the "Edge
 * Audit" panel, which reports the observed rate against the exact chance rate
 * with confidence intervals and p-values. Treat outputs as hypotheses, never as
 * certainties, and never stake money you cannot afford to lose.
 */
import {
  BALLS,
  BASE_P,
  EXPECTED_GAP,
  WINNING_COUNT,
  type BacktestResult,
  type BacktestRun,
  type CombinatorialAudit,
  type Deduction,
  type LastDrawReview,
  type Draw,
  type DrawRow,
  type EngineConfig,
  type NumberEvidence,
  type PillarWeights,
  type RateAudit,
  type Trio,
  DEFAULT_CONFIG,
} from './types';

export * from './types';

/* ==========================================================================
 * 0. Small, dependency-free math toolkit
 * ========================================================================== */

export const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));

export function mean(xs: readonly number[]): number {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Population standard deviation. */
export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) * (x - m);
  return Math.sqrt(v / xs.length);
}

/** Standardise an array to mean 0 / sd 1 (all zeros if the spread is 0). */
export function standardize(xs: readonly number[]): number[] {
  const m = mean(xs);
  const s = sd(xs);
  if (!Number.isFinite(s) || s < 1e-12) return xs.map(() => 0);
  return xs.map((x) => (x - m) / s);
}

/** Lanczos log-gamma (g = 7, n = 9). Accurate to ~1e-12 for x > 0. */
export function logGamma(x: number): number {
  const g = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // Reflection formula.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = g[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += g[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the regularised incomplete beta (modified Lentz). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const TINY = 1e-300;
  const EPS = 3e-12;
  const MAX_ITER = 300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta function I_x(a, b). */
export function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logGamma(a + b) - logGamma(a) - logGamma(b);
  const front = Math.exp(lbeta + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** log(C(n, k)) — stable for large n. */
export function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/**
 * Exact one-sided binomial tail P(X >= k) for X ~ Binomial(n, p).
 * Uses log-space summation so tiny p (e.g. 3-of-3 = 8.5e-5) stays stable.
 */
export function binomialTailAtLeast(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const logP = Math.log(p);
  const logQ = Math.log1p(-p);
  let maxLog = -Infinity;
  const terms: number[] = [];
  for (let i = k; i <= n; i++) {
    const lt = logChoose(n, i) + i * logP + (n - i) * logQ;
    terms.push(lt);
    if (lt > maxLog) maxLog = lt;
  }
  if (!Number.isFinite(maxLog)) return 0;
  let sum = 0;
  for (const lt of terms) sum += Math.exp(lt - maxLog);
  return clamp(Math.exp(maxLog + Math.log(sum)), 0, 1);
}

/** Wilson score interval for a binomial proportion (95% by default). */
export function wilsonInterval(
  successes: number,
  trials: number,
  z = 1.959963984540054
): [number, number] {
  if (trials <= 0) return [0, 1];
  const phat = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const centre = phat + z2 / (2 * trials);
  const margin = z * Math.sqrt((phat * (1 - phat)) / trials + z2 / (4 * trials * trials));
  return [clamp((centre - margin) / denom, 0, 1), clamp((centre + margin) / denom, 0, 1)];
}

/** Shannon entropy in bits of a probability vector. */
export function shannonEntropy(probs: readonly number[]): number {
  let h = 0;
  for (const p of probs) {
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

/** Deterministic PRNG (mulberry32) — used for reproducible Monte-Carlo. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ==========================================================================
 * 1. Draw normalisation, validation, and date helpers
 * ========================================================================== */

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Weekday (0=Sun) for an ISO date, evaluated in UTC to avoid TZ drift. */
export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function formatDrawDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${WEEKDAY_NAMES[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Game normally drawn on a given weekday, or null on Sundays. */
export function gameForDate(isoDate: string): string | null {
  const wd = weekdayOf(isoDate);
  return (
    ['', 'Monday Special', 'Lucky Tuesday', 'Midweek', 'Fortune Thursday', 'Friday Bonanza', 'National Weekly'][wd] ??
    null
  ) || null;
}

/** Next date on which `game` is drawn, strictly after `isoDate`. */
export function nextDateForGame(game: string, afterIso: string): string {
  let d = addDays(afterIso, 1);
  for (let guard = 0; guard < 7; guard++) {
    if (gameForDate(d) === game) return d;
    d = addDays(d, 1);
  }
  return d;
}

/** The next scheduled NLA 5/90 event strictly after `isoDate`. */
export function nextDrawAfter(isoDate: string): { date: string; game: string; label: string } {
  let d = addDays(isoDate, 1);
  for (let guard = 0; guard < 7; guard++) {
    const game = gameForDate(d);
    if (game) return { date: d, game, label: `${game} · ${formatDrawDate(d)}` };
    d = addDays(d, 1);
  }
  return { date: d, game: 'Monday Special', label: `Monday Special · ${formatDrawDate(d)}` };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  draw?: Draw;
}

/**
 * Validate a candidate draw.
 *
 * Rules: exactly 5 winning + 5 machine numbers, all integers in 1..90, and the
 * ten numbers must be distinct (NLA draws all ten balls from the same drum
 * without replacement).
 */
export function validateDraw(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['Draw must be an object'], warnings };
  }
  const raw = input as Record<string, unknown>;

  const drawDate = String(raw.draw_date ?? raw.date ?? '').slice(0, 10);
  if (!isIsoDate(drawDate)) errors.push(`draw_date must be an ISO date (YYYY-MM-DD), got "${raw.draw_date ?? raw.date ?? ''}"`);

  const game = String(raw.game_name ?? raw.game ?? '').trim();
  if (!game) errors.push('game_name is required');

  const winning = pickNumbers(raw, ['winning', 'win', 'numbers', 'winners'], 'num', WINNING_COUNT);
  const machine = pickNumbers(raw, ['machine', 'mac', 'machine_numbers'], 'mac', 5);

  for (const [label, arr] of [
    ['winning', winning],
    ['machine', machine],
  ] as const) {
    if (arr.length !== 5) {
      errors.push(`${label} must contain exactly 5 numbers, got ${arr.length}`);
      continue;
    }
    for (const n of arr) {
      if (!Number.isInteger(n) || n < 1 || n > BALLS) errors.push(`${label} number ${n} is not an integer in 1..90`);
    }
    if (new Set(arr).size !== arr.length) errors.push(`${label} numbers must be unique`);
  }

  if (!errors.length) {
    const all = [...winning, ...machine];
    if (new Set(all).size !== all.length) {
      errors.push('the 10 drawn numbers must be distinct (winning and machine overlap)');
    }
  }

  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, errors, warnings, draw: { draw_date: drawDate, game_name: game, winning, machine } };
}

function pickNumbers(
  raw: Record<string, unknown>,
  arrayKeys: string[],
  prefix: 'num' | 'mac',
  count: number
): number[] {
  for (const k of arrayKeys) {
    const v = raw[k];
    if (Array.isArray(v)) return v.map((x) => Number(x));
  }
  const out: number[] = [];
  for (let i = 1; i <= count; i++) {
    const v = raw[`${prefix}${i}`];
    if (v !== undefined && v !== null && v !== '') out.push(Number(v));
  }
  return out;
}

/** Parse free-form CSV (header optional). Accepts `YYYY-MM-DD,Game,5 nums,5 nums`. */
export function parseCsv(text: string): { rows: Draw[]; errors: string[] } {
  const errors: string[] = [];
  const rows: Draw[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  for (const [i, line] of lines.entries()) {
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (i === 0 && /date/i.test(cells[0] ?? '') && cells.length >= 3) continue; // header
    if (cells.length < 12) {
      errors.push(`line ${i + 1}: expected 12 columns (date, game, 5 winning, 5 machine), got ${cells.length}`);
      continue;
    }
    const nums = cells.slice(2, 12).map((c) => Number(c));
    const candidate = {
      draw_date: cells[0],
      game_name: cells[1],
      winning: nums.slice(0, 5),
      machine: nums.slice(5, 10),
    };
    const v = validateDraw(candidate);
    if (v.ok && v.draw) rows.push(v.draw);
    else errors.push(`line ${i + 1}: ${v.errors.join('; ')}`);
  }
  return { rows, errors };
}

export const drawToRow = (d: Draw, source = 'manual'): DrawRow => ({
  draw_date: d.draw_date,
  game_name: d.game_name,
  num1: d.winning[0],
  num2: d.winning[1],
  num3: d.winning[2],
  num4: d.winning[3],
  num5: d.winning[4],
  mac1: d.machine[0],
  mac2: d.machine[1],
  mac3: d.machine[2],
  mac4: d.machine[3],
  mac5: d.machine[4],
  source,
});

export const rowToDraw = (r: DrawRow): Draw => ({
  draw_date: r.draw_date,
  game_name: r.game_name,
  winning: [r.num1, r.num2, r.num3, r.num4, r.num5],
  machine: [r.mac1, r.mac2, r.mac3, r.mac4, r.mac5],
});

/** Chronological sort (ascending) + de-duplication by draw_date. */
export function normalizeHistory(draws: readonly Draw[]): Draw[] {
  const byDate = new Map<string, Draw>();
  for (const d of draws) byDate.set(d.draw_date, d);
  return [...byDate.values()].sort((a, b) => a.draw_date.localeCompare(b.draw_date));
}

/** Filter to one game, or keep everything when `game` is empty / "all". */
export function filterByGame(draws: readonly Draw[], game?: string | null): Draw[] {
  if (!game || game === 'all' || game === 'All games') return [...draws];
  return draws.filter((d) => d.game_name.toLowerCase() === game.toLowerCase());
}

/** Last `lookback` draws (0/negative/NaN = all). */
export function windowOf(draws: readonly Draw[], lookback: number): Draw[] {
  if (!lookback || lookback <= 0 || !Number.isFinite(lookback)) return [...draws];
  return draws.slice(Math.max(0, draws.length - lookback));
}

/* ==========================================================================
 * 2. Pillar 1 — Bayesian posterior (Beta-Binomial conjugate)
 * ========================================================================== */

export interface BayesResult {
  hits: number;
  trials: number;
  alpha: number;
  beta: number;
  posteriorMean: number;
  priorMean: number;
  lift: number;
  probHotterThanPrior: number;
  sd: number;
}

/**
 * Uniform prior Beta(a0, b0) centred on 5/90, then conjugate update with the
 * number of appearances in the lookback window.
 *
 *   a0 = k * p0,  b0 = k * (1 - p0)     (k = priorStrength in pseudo-draws)
 *   posterior = Beta(a0 + hits, b0 + trials - hits)
 *   mean = (a0 + hits) / (k + trials)
 *
 * `probHotterThanPrior` = P(p > p0 | data) = 1 - I_{p0}(a, b), i.e. how much of
 * the posterior mass sits above the uniform baseline. With small windows this
 * stays near 0.5 — which is exactly the point: streaks are weak evidence.
 */
export function bayesPosterior(
  window: readonly Draw[],
  n: number,
  priorStrength = DEFAULT_CONFIG.bayesPriorStrength
): BayesResult {
  const trials = window.length;
  let hits = 0;
  for (const d of window) if (d.winning.includes(n)) hits++;

  const k = Math.max(0.001, priorStrength);
  const alpha0 = k * BASE_P;
  const beta0 = k * (1 - BASE_P);
  const alpha = alpha0 + hits;
  const beta = beta0 + (trials - hits);
  const total = alpha + beta;
  const posteriorMean = alpha / total;
  const variance = (alpha * beta) / (total * total * (total + 1));
  const probHotterThanPrior = clamp(1 - incompleteBeta(alpha, beta, BASE_P), 0, 1);

  return {
    hits,
    trials,
    alpha,
    beta,
    posteriorMean,
    priorMean: BASE_P,
    lift: posteriorMean / BASE_P,
    probHotterThanPrior,
    sd: Math.sqrt(variance),
  };
}

/* ==========================================================================
 * 3. Pillar 2 — Poisson / geometric inter-arrival & z-score
 * ========================================================================== */

export interface GapResult {
  gap: number;
  expectedGap: number;
  sd: number;
  z: number;
  survival: number;
  overdue: boolean;
  censored: boolean;
}

/**
 * Inter-arrival model. For a specific number, appearances are Bernoulli(p0) per
 * draw, so the gap G between appearances is Geometric with mean 1/p0 = 18 draws
 * (the exponential/Poisson limit with lambda = 18 is what the spec asks for; the
 * exact discrete law is used here and it is what the numbers below report).
 *
 *   sd(G) = sqrt((1-p)/p^2)  ~= 17.49
 *   z     = (gap - 18) / sd
 *   S(g)  = P(G >= g) = (1-p)^g      (survival / "overdue" tail mass)
 */
export function poissonGap(
  window: readonly Draw[],
  n: number,
  expectedGap = EXPECTED_GAP
): GapResult {
  const p = 1 / Math.max(1, expectedGap);
  const len = window.length;
  let gap = len;
  let censored = true;
  for (let i = len - 1; i >= 0; i--) {
    if (window[i].winning.includes(n)) {
      gap = len - 1 - i;
      censored = false;
      break;
    }
  }
  const sdGap = Math.sqrt((1 - p) / (p * p));
  const z = (gap - expectedGap) / sdGap;
  return {
    gap,
    expectedGap,
    sd: sdGap,
    z,
    survival: Math.pow(1 - p, gap),
    overdue: z >= 1,
    censored,
  };
}

/* ==========================================================================
 * 4. Pillar 3 — First-order Markov chain (90 x 90 transitions)
 * ========================================================================== */

export interface MarkovModel {
  /** counts[from * 90 + to] = shrunk transition evidence */
  counts: Float64Array;
  /** rowTotals[from] = total transition weight leaving `from` */
  rowTotals: Float64Array;
  alpha: number;
  machineWeight: number;
  transitions: number;
  /** Baseline probability of any single number being a winning number. */
  baseline: number;
}

/**
 * Build the transition matrix.
 *
 * For each consecutive pair of draws (t-1 -> t) and each drawn number `a` in
 * draw t-1 (winning numbers weight 1, machine numbers weight `machineWeight`),
 * every winning number `b` of draw t earns counts[a][b] += weight(a).
 *
 * P(b | a) = (counts[a][b] + alpha * p0) / (rowTotals[a] + alpha)
 *
 * `rowTotals[a]` counts transitions out of `a` (one per transition), so
 * sum_b P(b|a) = 5 exactly: the expected number of winning numbers, of which
 * each individual number keeps baseline probability p0 = 5/90.
 *
 * The `alpha * p0` term shrinks sparse rows toward the uniform 5/90 baseline
 * instead of toward zero — an unobserved transition should look *uninformative*,
 * not *impossible*.
 */
export function buildMarkov(
  draws: readonly Draw[],
  opts: { alpha?: number; machineWeight?: number } = {}
): MarkovModel {
  const alpha = Math.max(0, opts.alpha ?? DEFAULT_CONFIG.markovAlpha);
  const machineWeight = clamp(opts.machineWeight ?? DEFAULT_CONFIG.markovMachineWeight, 0, 1);
  const counts = new Float64Array(BALLS * BALLS);
  const rowTotals = new Float64Array(BALLS);
  let transitions = 0;

  for (let t = 1; t < draws.length; t++) {
    const prev = draws[t - 1];
    const curr = draws[t];
    const sources: Array<{ n: number; w: number }> = [
      ...prev.winning.map((n) => ({ n, w: 1 })),
      ...prev.machine.map((n) => ({ n, w: machineWeight })).filter((s) => s.w > 0),
    ];
    for (const src of sources) {
      const row = src.n - 1;
      // One "trial" per transition (not per target): a transition carries 5
      // winning targets, so the row must sum to 5 x p0 = 5 x (1/18) = 0.2778...
      // per target and exactly 5 in total. See the normalisation note above.
      rowTotals[row] += src.w;
      for (const b of curr.winning) counts[row * BALLS + (b - 1)] += src.w;
    }
    transitions++;
  }

  return { counts, rowTotals, alpha, machineWeight, transitions, baseline: BASE_P };
}

/** P(to | from) with baseline shrinkage. */
export function transitionProbability(m: MarkovModel, from: number, to: number): number {
  const row = from - 1;
  const count = m.counts[row * BALLS + (to - 1)];
  const denom = m.rowTotals[row] + m.alpha;
  if (denom <= 0) return m.baseline;
  return (count + m.alpha * m.baseline) / denom;
}

/**
 * Score how strongly `n` is expected to follow the most recent draw's set.
 * Returns a weighted expected count plus the strongest individual driver.
 */
export function markovScore(
  m: MarkovModel,
  lastDraw: Draw | undefined,
  n: number
): { expectedFollow: number; baseline: number; lift: number; bestPredecessor: { from: number; probability: number } | null } {
  if (!lastDraw) {
    return { expectedFollow: BASE_P, baseline: BASE_P, lift: 1, bestPredecessor: null };
  }
  const sources: Array<{ from: number; w: number; isMachine: boolean }> = [
    ...lastDraw.winning.map((from) => ({ from, w: 1, isMachine: false })),
    ...lastDraw.machine.map((from) => ({ from, w: m.machineWeight, isMachine: true })),
  ].filter((s) => s.w > 0);

  let expectedFollow = 0;
  let weightSum = 0;
  let best: { from: number; probability: number } | null = null;
  let bestWeighted = -1;

  for (const s of sources) {
    const p = transitionProbability(m, s.from, n);
    expectedFollow += s.w * p;
    weightSum += s.w;
    const weighted = s.w * p;
    if (weighted > bestWeighted) {
      bestWeighted = weighted;
      best = { from: s.from, probability: p };
    }
  }
  const baseline = Math.max(1e-9, weightSum) * BASE_P;
  return {
    expectedFollow,
    baseline,
    lift: expectedFollow / baseline,
    bestPredecessor: best,
  };
}

/* ==========================================================================
 * 5. Pillar 4 — Combinatorial & entropy filtering
 * ========================================================================== */

/** Tens group index 0..8 (1-10, 11-20, ..., 81-90). */
export const decadeOf = (n: number): number => Math.floor((n - 1) / 10);
export const decadeLabel = (d: number): string =>
  d >= 8 ? '81–90' : `${d * 10 + 1}–${d * 10 + 10}`;
/** Quartile index 0..3 over 1..90. */
const quartileOf = (n: number): number => Math.min(3, Math.floor(((n - 1) * 4) / BALLS));

/** Expected sum of three distinct numbers from 1..90 (= 3 * 45.5). */
export const EXPECTED_TRIO_SUM = 136.5;
/** SD of the sum of three distinct numbers from 1..90 (~44.5). */
export const TRIO_SUM_SD = 44.5;

/**
 * 0..1 diversity index for a trio: average normalised Shannon entropy across
 * decade occupancy, parity split and quartile occupancy. 0 = fully clustered,
 * 1 = maximally spread.
 */
export function trioEntropy(trio: readonly number[]): number {
  if (trio.length < 2) return 0;
  const normalized = (counts: number[], maxEntropy: number): number => {
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0 || maxEntropy <= 0) return 0;
    return shannonEntropy(counts.map((c) => c / total)) / maxEntropy;
  };

  const decadeCounts = new Array(9).fill(0);
  for (const n of trio) decadeCounts[decadeOf(n)]++;
  // Max entropy for k items in k distinct buckets = log2(k).
  const decadeEntropy = normalized(decadeCounts.slice(), Math.log2(Math.min(3, trio.length)));

  const odd = trio.filter((n) => n % 2 === 1).length;
  const parityEntropy = normalized([odd, trio.length - odd], 1);

  const quartileCounts = new Array(4).fill(0);
  for (const n of trio) quartileCounts[quartileOf(n)]++;
  const quartileEntropy = normalized(quartileCounts, Math.log2(Math.min(3, trio.length)));

  return clamp((decadeEntropy + parityEntropy + quartileEntropy) / 3, 0, 1);
}

/** Audit a trio against the combinatorial rules plus informational patterns. */
export function auditTrio(
  numbers: readonly number[],
  filters: EngineConfig['filters'] = DEFAULT_CONFIG.filters
): CombinatorialAudit {
  const nums = [...numbers].sort((a, b) => a - b);
  const decades = nums.map(decadeOf);
  const distinctDecades = new Set(decades).size;
  const odd = nums.filter((n) => n % 2 === 1).length;
  const even = nums.length - odd;
  const sum = nums.reduce((a, b) => a + b, 0);

  const spreadOk = distinctDecades >= 2;
  const parityOk = odd > 0 && even > 0;
  const sumOk = sum >= filters.minSum && sum <= filters.maxSum;

  const patterns: string[] = [];
  if (nums.every((n) => n <= 31)) patterns.push('all within 1–31 (birthday range)');
  const consecutive = nums.some((n, i) => i > 0 && n - nums[i - 1] === 1);
  if (consecutive) patterns.push('contains a consecutive pair');
  if (nums.every((n) => n % 10 === 0)) patterns.push('all round numbers');
  if (distinctDecades === 3) patterns.push('three separate decades');

  return {
    numbers: nums,
    decades,
    distinctDecades,
    odd,
    even,
    sum,
    spreadOk,
    parityOk,
    sumOk,
    pass: (!filters.decadeSpread || spreadOk) && (!filters.parityBalance || parityOk) && (!filters.sumRange || sumOk),
    entropy: trioEntropy(nums),
    patterns,
  };
}

/* ==========================================================================
 * 6. Blended scoring + deduction
 * ========================================================================== */

export function normalizeWeights(w: Partial<PillarWeights> | undefined): PillarWeights {
  const b = Math.max(0, w?.bayes ?? DEFAULT_CONFIG.weights.bayes);
  const p = Math.max(0, w?.poisson ?? DEFAULT_CONFIG.weights.poisson);
  const m = Math.max(0, w?.markov ?? DEFAULT_CONFIG.weights.markov);
  const total = b + p + m;
  if (total <= 1e-9) return { bayes: 1 / 3, poisson: 1 / 3, markov: 1 / 3 };
  return { bayes: b / total, poisson: p / total, markov: m / total };
}

const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const fx = (x: number, digits = 2) => x.toFixed(digits);

/**
 * Score every number 1..90 across the three pillars, standardise each pillar
 * (so slider weights mean the same thing), blend, and attach narratives.
 */
export function scoreNumbers(
  history: readonly Draw[],
  config: EngineConfig = DEFAULT_CONFIG
): { evidence: NumberEvidence[]; window: Draw[]; weights: PillarWeights; scoreEntropy: number } {
  const chron = normalizeHistory(history);
  const window = windowOf(chron, config.lookback);
  const lastDraw = window[window.length - 1];
  const weights = normalizeWeights(config.weights);
  const markov = buildMarkov(window, {
    alpha: config.markovAlpha,
    machineWeight: config.markovMachineWeight,
  });

  const raw = [] as Array<{
    number: number;
    bayes: BayesResult;
    poisson: GapResult;
    markov: ReturnType<typeof markovScore>;
  }>;

  for (let n = 1; n <= BALLS; n++) {
    raw.push({
      number: n,
      bayes: bayesPosterior(window, n, config.bayesPriorStrength),
      poisson: poissonGap(window, n, config.expectedGap || EXPECTED_GAP),
      markov: markovScore(markov, lastDraw, n),
    });
  }

  // Standardise each pillar across the 90 numbers.
  const zBayes = standardize(raw.map((r) => r.bayes.posteriorMean));
  // Poisson: use the raw z-score already in gap units, clipped so a 60-draw
  // drought cannot dominate the blend.
  const zPoisson = standardize(raw.map((r) => clamp(r.poisson.z, -3, 3)));
  // Markov: lift over baseline, log-scaled to damp extreme small-sample rows.
  const zMarkov = standardize(raw.map((r) => Math.log(Math.max(1e-6, r.markov.lift))));

  const evidence: NumberEvidence[] = raw.map((r, i) => {
    const contribution = {
      bayes: weights.bayes * zBayes[i],
      poisson: weights.poisson * zPoisson[i],
      markov: weights.markov * zMarkov[i],
    };
    const score = contribution.bayes + contribution.poisson + contribution.markov;
    return {
      number: r.number,
      bayes: { ...r.bayes },
      poisson: { ...r.poisson },
      markov: { ...r.markov },
      z: { bayes: zBayes[i], poisson: zPoisson[i], markov: zMarkov[i] },
      score,
      contribution,
      rank: 0,
      plain: {
        bayes: `${r.bayes.hits} appearance${r.bayes.hits === 1 ? '' : 's'} in ${r.bayes.trials} draws → posterior ${pct(
          r.bayes.posteriorMean
        )} vs ${pct(BASE_P)} baseline (${r.bayes.lift >= 1 ? '+' : ''}${pct(r.bayes.lift - 1, 0)} lift, ${pct(
          r.bayes.probHotterThanPrior
        )} of posterior mass above baseline)`,
        poisson:
          r.poisson.censored && r.poisson.gap >= r.bayes.trials
            ? `not seen in the ${r.bayes.trials}-draw window — gap censored at ${r.poisson.gap} (z ${fx(r.poisson.z)})`
            : `gap ${r.poisson.gap} draw${r.poisson.gap === 1 ? '' : 's'} since last hit vs λ=${fx(
                r.poisson.expectedGap,
                0
              )} (z ${fx(r.poisson.z, 2)}, tail mass ${pct(r.poisson.survival)})${
                r.poisson.overdue ? ' — flagged overdue' : ''
              }`,
        markov: `expected follow-through ${fx(r.markov.expectedFollow, 3)} vs ${fx(
          r.markov.baseline,
          3
        )} baseline (${fx(r.markov.lift, 2)}×)${
          r.markov.bestPredecessor
            ? `, strongest link from ${r.markov.bestPredecessor.from} (p=${pct(r.markov.bestPredecessor.probability)})`
            : ''
        }`,
        overall: '',
      },
    };
  });

  evidence.sort((a, b) => b.score - a.score);
  evidence.forEach((e, i) => {
    e.rank = i + 1;
  });

  // Overall narrative per number.
  for (const e of evidence) {
    const parts: string[] = [];
    parts.push(
      `${e.bayes.hits}/${e.bayes.trials} hits (Bayes z ${fx(e.z.bayes, 1)})`,
      `gap ${e.poisson.gap} (Poisson z ${fx(e.poisson.z, 1)})`,
      `Markov ${fx(e.markov.lift, 1)}× baseline (z ${fx(e.z.markov, 1)})`
    );
    const verdict =
      e.score > 0.75 ? 'strong composite signal' : e.score > 0.25 ? 'mild composite signal' : e.score > -0.25 ? 'neutral' : 'cold on every pillar';
    e.plain.overall = `${parts.join(' · ')} → ${verdict} (blended z ${fx(e.score, 2)}).`;
  }

  // Entropy of the score distribution (normalised softmax) in bits.
  const maxScore = Math.max(...evidence.map((e) => e.score));
  const exps = evidence.map((e) => Math.exp((e.score - maxScore) * 2));
  const total = exps.reduce((a, b) => a + b, 0);
  const scoreEntropy = shannonEntropy(exps.map((x) => x / total));

  return { evidence, window, weights, scoreEntropy };
}

/** Composite trio score: statistical strength, nudged by diversity. */
function trioScore(members: NumberEvidence[], audit: CombinatorialAudit): number {
  const strength = mean(members.map((m) => m.score));
  const sumBonus = Math.max(0, 1 - Math.abs(audit.sum - EXPECTED_TRIO_SUM) / (2 * TRIO_SUM_SD));
  return strength + 0.35 * audit.entropy + 0.15 * sumBonus;
}

/**
 * Full deduction: top three numbers, the filtered trio, runner-up trios, and a
 * few full 5-number coverage lines built from the same candidate pool.
 */
export function deduce(
  history: readonly Draw[],
  config: EngineConfig = DEFAULT_CONFIG,
  /**
   * Which game the picks are for. When set, the target is the next date that
   * *that game* is drawn, so a Midweek analysis never advertises a Monday
   * draw. Leave undefined for the pooled view (next scheduled event of any
   * game).
   */
  targetGame?: string
): Deduction {
  const chron = normalizeHistory(history);
  const { evidence, window, weights, scoreEntropy } = scoreNumbers(chron, config);
  const byNumber = new Map(evidence.map((e) => [e.number, e]));

  const poolSize = clamp(Math.round(config.poolSize || 15), 3, 40);
  const pool = evidence.slice(0, poolSize);

  let testedCombos = 0;
  let validCombos = 0;
  const trios: Trio[] = [];
  const relaxed: Trio[] = [];

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      for (let k = j + 1; k < pool.length; k++) {
        testedCombos++;
        const members = [pool[i], pool[j], pool[k]];
        const nums = members.map((m) => m.number);
        const audit = auditTrio(nums, config.filters);
        const t: Trio = { numbers: audit.numbers, score: trioScore(members, audit), audit };
        if (audit.pass) {
          validCombos++;
          trios.push(t);
        } else {
          relaxed.push(t);
        }
      }
    }
  }

  trios.sort((a, b) => b.score - a.score);
  relaxed.sort((a, b) => b.score - a.score);

  const primary = trios[0] ?? relaxed[0] ?? {
    numbers: evidence.slice(0, 3).map((e) => e.number).sort((a, b) => a - b),
    score: 0,
    audit: auditTrio(evidence.slice(0, 3).map((e) => e.number), config.filters),
  };

  const alternatives = trios.slice(1, 3);

  // Coverage lines: 3 full 5-number tickets from the top 10, diversity-weighted.
  const coveragePool = evidence.slice(0, Math.min(10, evidence.length));
  const lines: { numbers: number[]; score: number }[] = [];
  for (let a = 0; a < coveragePool.length; a++) {
    for (let b = a + 1; b < coveragePool.length; b++) {
      for (let c = b + 1; c < coveragePool.length; c++) {
        for (let d = c + 1; d < coveragePool.length; d++) {
          for (let e = d + 1; e < coveragePool.length; e++) {
            const nums = [coveragePool[a], coveragePool[b], coveragePool[c], coveragePool[d], coveragePool[e]].map(
              (x) => x.number
            );
            const audit = auditTrio(nums.slice(0, 3), config.filters);
            const strength = mean(
              nums.map((n) => byNumber.get(n)?.score ?? 0)
            );
            lines.push({ numbers: nums.sort((x, y) => x - y), score: strength + 0.4 * audit.entropy });
          }
        }
      }
    }
  }
  lines.sort((x, y) => y.score - x.score);

  // De-duplicate near-identical tickets (share 4+ numbers).
  const coverageTickets: { numbers: number[]; score: number }[] = [];
  for (const line of lines) {
    if (coverageTickets.length >= 3) break;
    const tooSimilar = coverageTickets.some(
      (t) => t.numbers.filter((n) => line.numbers.includes(n)).length >= 4
    );
    if (!tooSimilar) coverageTickets.push(line);
  }

  const windowStart = window[0]?.draw_date ?? '—';
  const windowEnd = window[window.length - 1]?.draw_date ?? '—';

  return {
    next: (() => {
      const anchor = windowEnd === '—' ? new Date().toISOString().slice(0, 10) : windowEnd;
      if (!targetGame || targetGame === 'all') return nextDrawAfter(anchor);
      const date = nextDateForGame(targetGame, anchor);
      return { game: targetGame, date, label: `${targetGame} · ${formatDrawDate(date)}` };
    })(),
    top: evidence.slice(0, 3),
    trio: primary,
    alternatives,
    coverageTickets,
    evidence,
    meta: {
      drawsUsed: window.length,
      totalDraws: chron.length,
      windowStart,
      windowEnd,
      weights,
      poolSize,
      validCombos,
      testedCombos,
      scoreEntropy,
      generatedAt: new Date().toISOString(),
    },
  };
}

/* ==========================================================================
 * 7. Walk-forward backtester + edge audit
 * ========================================================================== */

/** Chance rate that a *single specified* number hits (5/90). */
export const CHANCE_ONE = WINNING_COUNT / BALLS;
/** Chance rate that two specified numbers both hit: C(5,2)/C(90,2). */
export const CHANCE_TWO = choose(WINNING_COUNT, 2) / choose(BALLS, 2);
/** Chance rate that three specified numbers all hit: C(5,3)/C(90,3). */
export const CHANCE_THREE = choose(WINNING_COUNT, 3) / choose(BALLS, 3);

function rateAudit(
  hits: number,
  trials: number,
  expectedRate: number,
  label: string
): RateAudit {
  const rate = trials > 0 ? hits / trials : 0;
  const expectedHits = trials * expectedRate;
  const pValue = trials > 0 ? binomialTailAtLeast(hits, trials, expectedRate) : 1;
  const lift = expectedRate > 0 ? rate / expectedRate : 0;
  let verdict: string;
  if (trials === 0) verdict = 'No draws evaluated.';
  else if (pValue > 0.05) {
    verdict =
      `Consistent with chance: ${hits} hit${hits === 1 ? '' : 's'} in ${trials} draws vs ${fx(
        expectedHits,
        2
      )} expected (p=${fx(pValue, 3)}).`;
  } else if (rate > expectedRate) {
    verdict = `Above chance with p=${fx(pValue, 4)} — interesting, but check for look-ahead leakage and multiple-testing bias before believing it.`;
  } else {
    verdict = `Below chance (p=${fx(pValue, 4)}) — no evidence of edge on this pillar mix.`;
  }
  return {
    hits,
    trials,
    rate,
    expectedRate,
    expectedHits,
    lift,
    ci: wilsonInterval(hits, trials),
    pValue,
    verdict: `${label}: ${verdict}`,
  };
}

/**
 * Strict walk-forward simulation.
 *
 * For every draw t (from `minTrain` onward) the engine sees ONLY draws 0..t-1,
 * predicts, then is scored against draw t. Nothing from the future leaks in:
 * the lookback window, the Markov matrix and the Bayesian posterior are all
 * rebuilt from the truncated history at each step.
 */
export function backtest(
  history: readonly Draw[],
  config: EngineConfig = DEFAULT_CONFIG,
  opts: { minTrain?: number; game?: string | null; maxSteps?: number; simulations?: number } = {}
): BacktestResult {
  const minTrain = Math.max(10, opts.minTrain ?? 20);
  const all = normalizeHistory(filterByGame(history, opts.game));
  const maxSteps = Math.max(1, opts.maxSteps ?? 1200);
  const start = Math.max(minTrain, all.length - maxSteps - 1);

  const runs: BacktestRun[] = [];
  let hit1 = 0;
  let hit2 = 0;
  let hit3 = 0;
  let line5TotalHits = 0;
  const line5Distribution: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let bestLine: { date: string; numbers: number[]; hits: number } | null = null;

  for (let t = start; t < all.length; t++) {
    const train = all.slice(0, t);
    if (train.length < minTrain) continue;
    const target = all[t];
    const d = deduce(train, config);

    const line5 = d.evidence.slice(0, 5).map((e) => e.number);
    const top1 = d.evidence[0]?.number ?? d.trio.numbers[0];
    const pair = d.evidence.slice(0, 2).map((e) => e.number);
    const trio = d.trio.numbers;

    const hit1Flag = target.winning.includes(top1);
    const hit2Flag = pair.every((n) => target.winning.includes(n));
    const hit3Flag = trio.every((n) => target.winning.includes(n));
    const matched = [...new Set([...pair, ...trio, top1])].filter((n) => target.winning.includes(n));
    const drawn10 = [...target.winning, ...target.machine];
    const matchedInclMachine = [...new Set([...line5, ...trio])].filter((n) => drawn10.includes(n));
    const line5Hits = line5.filter((n) => target.winning.includes(n)).length;

    if (hit1Flag) hit1++;
    if (hit2Flag) hit2++;
    if (hit3Flag) hit3++;
    line5TotalHits += line5Hits;
    line5Distribution[line5Hits] = (line5Distribution[line5Hits] ?? 0) + 1;
    if (!bestLine || line5Hits > bestLine.hits) {
      bestLine = { date: target.draw_date, numbers: line5, hits: line5Hits };
    }

    runs.push({
      index: t,
      draw_date: target.draw_date,
      game_name: target.game_name,
      winning: [...target.winning].sort((a, b) => a - b),
      machine: [...target.machine].sort((a, b) => a - b),
      line5: [...line5].sort((a, b) => a - b),
      top1,
      pair: [...pair].sort((a, b) => a - b),
      trio: [...trio].sort((a, b) => a - b),
      hit1: hit1Flag,
      hit2: hit2Flag,
      hit3: hit3Flag,
      matched: matched.sort((a, b) => a - b),
      matchedInclMachine: matchedInclMachine.sort((a, b) => a - b),
      line5Hits,
      trioScore: d.trio.score,
      trainingDraws: train.length,
    });
  }

  const trials = runs.length;

  // Monte-Carlo: what would random picks have done over the same schedule?
  const simulations = clamp(Math.round(opts.simulations ?? 400), 0, 5000);
  const rng = mulberry32(0x5eed);
  const randomTrioHits: number[] = [];
  let randomOneHitsSum = 0;
  for (let sim = 0; sim < simulations; sim++) {
    let trioHits = 0;
    let oneHits = 0;
    for (const run of runs) {
      const pool = Array.from({ length: BALLS }, (_, i) => i + 1);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const pick = pool.slice(0, 3);
      if (pick.every((n) => run.winning.includes(n))) trioHits++;
      if (run.winning.includes(pick[0])) oneHits++;
    }
    randomTrioHits.push(trioHits);
    randomOneHitsSum += oneHits;
  }
  randomTrioHits.sort((a, b) => a - b);
  const percentile = simulations
    ? (randomTrioHits.filter((x) => x < hit3).length / simulations) * 100
    : 0;

  return {
    runs,
    summary: {
      draws: trials,
      minTrain,
      oneNumber: rateAudit(hit1, trials, CHANCE_ONE, '1-Number'),
      twoSure: rateAudit(hit2, trials, CHANCE_TWO, '2-Sure'),
      threeDirect: rateAudit(hit3, trials, CHANCE_THREE, '3-Direct'),
      line5: {
        avgHits: trials ? line5TotalHits / trials : 0,
        expectedHits: (5 * WINNING_COUNT) / BALLS,
        bestLine,
        distribution: line5Distribution,
      },
      randomBaseline: {
        simulations,
        meanTrioHits: simulations ? randomTrioHits.reduce((a, b) => a + b, 0) / simulations : 0,
        p95TrioHits: simulations ? randomTrioHits[Math.min(simulations - 1, Math.floor(0.95 * simulations))] : 0,
        meanOneNumberHits: simulations ? randomOneHitsSum / simulations : 0,
        percentile,
        note:
          'Random picks were simulated over the identical draw schedule. ' +
          'If the engine sits inside this distribution, its "signal" is indistinguishable from luck.',
      },
    },
    config,
  };
}

/* ==========================================================================
 * Review: what the engine said before the last draw that was actually played
 * ========================================================================== */

/** Exact P(X >= 1) that a k-pick line contains at least one of the five winners. */
export function chanceAtLeastOneHit(picks: number): number {
  const n = BALLS;
  const wins = WINNING_COUNT;
  let miss = 1;
  for (let i = 0; i < picks; i++) miss *= (n - wins - i) / (n - i);
  return 1 - miss;
}

/**
 * Re-run the walk-forward step that covered the newest stored draw and compare
 * it with the result. This is deliberately deterministic: the same history and
 * settings always produce the same "what it said", so the review can be shown
 * for draws that happened years ago, not just for predictions the browser
 * happened to see.
 */
export function reviewLastDraw(
  history: readonly Draw[],
  config: EngineConfig = DEFAULT_CONFIG,
  targetGame?: string
): LastDrawReview | null {
  const chron = normalizeHistory(history);
  if (chron.length < 6) return null;

  const actual = chron[chron.length - 1];
  const training = chron.slice(0, -1);
  const before = deduce(training, config, targetGame);
  if (before.next.date !== actual.draw_date) return null; // schedule gap — nothing to compare

  const picks = before.trio.numbers;
  const byNumber = new Map(before.evidence.map((e) => [e.number, e]));
  const ranked = actual.winning.map((number) => {
    const e = byNumber.get(number);
    return {
      number,
      rank: e?.rank ?? BALLS,
      z: e?.score ?? 0,
      hit: picks.includes(number),
    };
  });

  const matched = picks.filter((n) => actual.winning.includes(n));
  const matchedMachine = picks.filter((n) => !actual.winning.includes(n) && actual.machine.includes(n));
  const hits = matched.length;
  const expectedHits = picks.length * BASE_P;
  const pAtLeastOne = chanceAtLeastOneHit(picks.length);

  const verdict =
    hits >= 3
      ? 'All three landed. That is a 1-in-11,748 event — the tail of a random distribution, not a method. Take the money and expect the next 60 draws to look ordinary again.'
      : hits === 2
        ? 'Two of three landed, which happens in about 0.7% of draws. Unusual, pleasant, and still luck: nothing in the model caused the drum to release those balls.'
        : hits === 1
          ? 'One of three landed. That is the single most common non-zero outcome (about 15% of draws) and exactly what chance offers — the expected hits per draw is 0.17.'
          : 'None landed, which is the most likely outcome: about 84% of draws hit nothing. The expected hits per draw is 0.17, so a blank is normal, not a failure of the model.';

  return {
    actual,
    predicted: { numbers: picks, targetDate: before.next.date, weights: before.meta.weights },
    matched,
    matchedMachine,
    hits,
    expectedHits,
    pAtLeastOne,
    ranked,
    verdict,
  };
}
