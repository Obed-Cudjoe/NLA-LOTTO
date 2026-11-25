/**
 * The timing journal: an instrument for testing the one hypothesis the app
 * cannot test from published data.
 *
 * Nothing in the public record says how long the invited guest took to reach
 * the button. So if you believe walk time carries information about the first
 * ball — the only release Direct 1 pays on — the honest way to settle it is to
 * write the times down *before* the draws happen and test them afterwards.
 *
 * Two rules make this a real test rather than a story:
 *
 *   1. Record the walk time and shake time BEFORE the numbers appear (or at
 *      least before you read them). Otherwise you will unconsciously round
 *      toward whatever the result "should" have been.
 *   2. Say in advance how much data counts as an answer. At a few dozen
 *      entries this test cannot distinguish a real dependence from noise, and
 *      the app reports that limit rather than a comforting p-value.
 *
 * The statistic is a chi-square test of independence between walk-time tercile
 * and first-ball decile, with a deterministic Monte-Carlo p-value. It detects
 * any dependence, not just a straight line, which is the right shape for
 * "timing rearranges the drum".
 */

const BALLS = 90;

/** Association strengths worth planning for: weak, middling, strong. */
const POWER_LADDER = [0.10, 0.15, 0.25];

/** One observed draw, as logged by the player. */
export interface TimingEntry {
  /** ISO date of the draw. */
  draw_date: string;
  /** Observed seconds from the guest being called to the press. */
  walkSeconds: number;
  /** Observed seconds of shaking before that press (best estimate). */
  shakeSeconds: number;
  /** The first ball drawn — the number Direct 1 pays on. */
  firstBall: number;
  /** Game name, optional. */
  game?: string;
  /** Free-text note. */
  note?: string;
}

/**
 * How many timings a given effect size needs before this test can see it.
 *
 * Cramér's V is the association strength; the table is 3 x 9, so df = 16 and the
 * non-centrality a real effect of size V produces is n * V^2 * 2. Power is
 * approximated from the normal approximation to the non-central chi-square —
 * good enough to tell a player whether they need 40 evenings or 400, which is
 * the only decision this number has to support.
 */
export function requiredEntries(
  v: number,
  { alpha = 0.05, power = 0.8 }: { alpha?: number; power?: number } = {}
): number {
  if (!(v > 0)) return Number.POSITIVE_INFINITY;
  const df = 16;
  // Chi-square critical value at `alpha`, Wilson–Hilferty approximation.
  const zA = 1.959964; // alpha = 0.05, two-sided
  const h = 2 / (9 * df);
  const crit = df * Math.pow(1 - h + zA * Math.sqrt(h), 3);
  const zB = 0.841621; // power = 0.8
  const lambdaFor = (n: number): number => n * v * v * 2;
  let lo = 1;
  let hi = 1;
  // Bracket the answer, then bisect on the power condition.
  const ok = (n: number): boolean => {
    const lambda = lambdaFor(n);
    const mean = df + lambda;
    const sd = Math.sqrt(2 * (df + 2 * lambda));
    return (mean - crit) / sd >= zB;
  };
  while (!ok(hi) && hi < 1e7) hi *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi);
}

/** The weakest association (Cramér's V) that `entries` timings could detect. */
export function detectableV(entries: number): number {
  if (!(entries > 0)) return 1;
  let lo = 0.001;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (requiredEntries(mid) <= entries) hi = mid;
    else lo = mid;
  }
  return hi;
}

export interface JournalReport {
  entries: number;
  /** Terciles of walk time actually observed, as [low, mid, high] second values. */
  terciles: { low: number; mid: number; high: number };
  /** Chi-square statistic on the 3 x 9 contingency table. */
  chiSquare: number;
  df: number;
  /** Monte-Carlo p-value (deterministic for a fixed seed). */
  pValue: number;
  /** Effect size 0..1 — 0 is no association at all. */
  cramersV: number;
  verdict: string;
  /** How much data is needed before the verdict means anything. */
  guidance: string;
  /** Entries needed to detect a weak / middling / strong association. */
  power: Array<{ v: number; entries: number }>;
  /** Weakest association the entries on file could detect. */
  detectableV: number;
  /** Per-tercile summary, for the table. */
  byTercile: Array<{ label: string; from: number; to: number; draws: number; meanFirstBall: number }>;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Balls grouped into nine deciles of the 1..90 range. */
function decileOf(ball: number): number {
  return Math.min(8, Math.floor((Math.min(BALLS, Math.max(1, ball)) - 1) / 10));
}

/** Sorted copy without mutating the input. */
function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function quantile(sortedValues: number[], q: number): number {
  if (!sortedValues.length) return 0;
  const pos = (sortedValues.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sortedValues[Math.min(sortedValues.length - 1, base + 1)];
  return sortedValues[base] + rest * (next - sortedValues[base]);
}

/** Chi-square statistic of a matrix of observed counts. */
function chiSquare2D(table: number[][]): number {
  const rows = table.length;
  const cols = table[0]?.length ?? 0;
  const rowTotals = table.map((r) => r.reduce((a, b) => a + b, 0));
  const colTotals = Array.from({ length: cols }, (_, c) => table.reduce((a, r) => a + r[c], 0));
  const total = rowTotals.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  let stat = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const expected = (rowTotals[r] * colTotals[c]) / total;
      if (expected > 0) stat += ((table[r][c] - expected) ** 2) / expected;
    }
  }
  return stat;
}

export function emptyJournalReport(): JournalReport {
  return {
    entries: 0,
    terciles: { low: 0, mid: 0, high: 0 },
    chiSquare: 0,
    df: 16,
    pValue: 1,
    cramersV: 0,
    verdict: 'No timings logged yet — nothing to test.',
    guidance: '',
    power: POWER_LADDER.map((v) => ({ v, entries: requiredEntries(v) })),
    detectableV: 1,
    byTercile: [],
  };
}

/**
 * Test whether walk time and the first ball are independent.
 *
 * `simulations` sets the resolution of the Monte-Carlo p-value: first-ball
 * deciles are shuffled while walk terciles stay fixed, which is the correct
 * null for "timing tells you nothing".
 */
export function analyseTimingJournal(
  entries: readonly TimingEntry[],
  { simulations = 2000, seed = 20261123 }: { simulations?: number; seed?: number } = {}
): JournalReport {
  const usable = entries.filter(
    (e) =>
      Number.isFinite(e.walkSeconds) &&
      e.walkSeconds >= 0 &&
      Number.isInteger(e.firstBall) &&
      e.firstBall >= 1 &&
      e.firstBall <= BALLS
  );
  if (usable.length < 8) {
    return {
      ...emptyJournalReport(),
      entries: usable.length,
      verdict:
        usable.length === 0
          ? 'No timings logged yet — nothing to test.'
          : `Only ${usable.length} timings logged. The test needs at least 8 to build a table, and a few hundred before a negative result means anything.`,
      guidance: 'Log walk seconds before each draw; the journal is saved in this browser and exports to CSV.',
      power: POWER_LADDER.map((v) => ({ v, entries: requiredEntries(v) })),
      detectableV: detectableV(usable.length),
    };
  }

  const walks = sorted(usable.map((e) => e.walkSeconds));
  const t1 = quantile(walks, 1 / 3);
  const t2 = quantile(walks, 2 / 3);
  const tercileOf = (w: number): number => (w <= t1 ? 0 : w <= t2 ? 1 : 2);

  const table = Array.from({ length: 3 }, () => new Array<number>(9).fill(0));
  for (const e of usable) table[tercileOf(e.walkSeconds)][decileOf(e.firstBall)] += 1;

  const chiSquare = chiSquare2D(table);
  const n = usable.length;
  const df = 2 * 8;

  // Monte-Carlo null: permute the first-ball deciles across entries.
  const deciles = usable.map((e) => decileOf(e.firstBall));
  const rand = rng(seed);
  let extreme = 0;
  for (let s = 0; s < simulations; s++) {
    const shuffled = [...deciles];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const simTable = Array.from({ length: 3 }, () => new Array<number>(9).fill(0));
    usable.forEach((e, i) => {
      simTable[tercileOf(e.walkSeconds)][shuffled[i]] += 1;
    });
    if (chiSquare2D(simTable) >= chiSquare - 1e-12) extreme += 1;
  }
  const pValue = (extreme + 1) / (simulations + 1);

  const cramersV = Math.sqrt(chiSquare / (n * Math.min(2, 8)));

  const byTercile = [
    { label: 'quick walk', from: 0, to: t1 },
    { label: 'typical walk', from: t1, to: t2 },
    { label: 'slow walk', from: t2, to: Number.POSITIVE_INFINITY },
  ].map((band, r) => {
    const rows = usable.filter((e) => tercileOf(e.walkSeconds) === r);
    return {
      label: band.label,
      from: band.from,
      to: band.to,
      draws: rows.length,
      meanFirstBall: rows.length ? rows.reduce((s, e) => s + e.firstBall, 0) / rows.length : 0,
    };
  });

  const verdict =
    n < 60
      ? `Inconclusive by design: ${n} timings cannot separate a real effect from noise. Keep logging and look again past 60.`
      : pValue >= 0.05
        ? `No detectable link between walk time and the first ball (p = ${pValue.toFixed(2)}, Cramér's V = ${cramersV.toFixed(2)} over ${n} draws). If the drum is fair, this is exactly what you should see.`
        : `A dependence shows up (p = ${pValue.toFixed(3)}, Cramér's V = ${cramersV.toFixed(2)}) in ${n} draws. Before believing it, check your recording — one test at 5% will misfire one time in twenty, and timings are easy to log after the fact.`;

  const guidance =
    'Pre-register the test: log walk seconds before the numbers appear, aim for 300+ entries, and treat a single significant result at this sample size as a hint, not a finding.';

  return {
    entries: n,
    terciles: { low: t1, mid: t2, high: walks[walks.length - 1] },
    chiSquare,
    df,
    pValue,
    cramersV,
    verdict,
    guidance,
    power: POWER_LADDER.map((v) => ({ v, entries: requiredEntries(v) })),
    detectableV: detectableV(n),
    byTercile,
  };
}

/** CSV in the same shape the app exports, so a spreadsheet can extend it. */
export function journalToCsv(entries: readonly TimingEntry[]): string {
  const head = 'draw_date,game,walk_seconds,shake_seconds,first_ball,note';
  const rows = entries.map((e) =>
    [e.draw_date, e.game ?? '', e.walkSeconds, e.shakeSeconds, e.firstBall, (e.note ?? '').replace(/[\r\n,]+/g, ' ')].join(',')
  );
  return [head, ...rows].join('\n');
}

/** Parse a CSV produced by `journalToCsv` (or hand-written in that shape). */
export function parseJournalCsv(text: string): { entries: TimingEntry[]; errors: string[] } {
  const errors: string[] = [];
  const entries: TimingEntry[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  for (const [i, line] of lines.entries()) {
    if (i === 0 && /draw_date|walk/i.test(line)) continue;
    const cells = line.split(',').map((c) => c.trim());
    if (cells.length < 5) {
      errors.push(`line ${i + 1}: expected 5 columns, found ${cells.length}`);
      continue;
    }
    const [date, game, walk, shake, first, ...rest] = cells;
    const walkSeconds = Number(walk);
    const shakeSeconds = Number(shake);
    const firstBall = Number(first);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`line ${i + 1}: bad date "${date}" (want YYYY-MM-DD)`);
      continue;
    }
    if (!Number.isFinite(walkSeconds) || walkSeconds < 0) {
      errors.push(`line ${i + 1}: bad walk seconds "${walk}"`);
      continue;
    }
    if (!Number.isInteger(firstBall) || firstBall < 1 || firstBall > BALLS) {
      errors.push(`line ${i + 1}: bad first ball "${first}" (want an integer 1-90)`);
      continue;
    }
    entries.push({
      draw_date: date,
      game: game || undefined,
      walkSeconds,
      shakeSeconds: Number.isFinite(shakeSeconds) ? shakeSeconds : 0,
      firstBall,
      note: rest.join(',') || undefined,
    });
  }
  return { entries, errors };
}
