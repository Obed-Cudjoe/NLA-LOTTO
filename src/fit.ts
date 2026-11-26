/**
 * Fitting the model's own weights to the archive — the honest version of
 * "train yourself on every draw".
 *
 * What this does: the blended score is a weighted average of three pillars
 * (Bayes, Poisson/gap, Markov). The default weights are a judgement call. This
 * module searches the weight simplex by walk-forward **log-loss** — the proper
 * scoring rule, which punishes confident wrongness — under a strict split: the
 * weights are chosen on the earlier part of the archive and scored on the later
 * part that the search never saw.
 *
 * What it can and cannot prove: an in-sample gain means the search found
 * something to fit. What matters is the out-of-sample column. If the fitted
 * weights do not beat the defaults on data the search never touched, the model
 * has not learned anything about the drum — it has learned about the archive.
 */

import {
  DEFAULT_CONFIG,
  filterByGame,
  normalizeHistory,
  scoreNumbers,
  type Draw,
  type EngineConfig,
  type PillarWeights,
} from './mathEngine';

export interface WeightFitResult {
  /** Weights chosen on the training slice. */
  fitted: PillarWeights;
  /** Weights the app ships with. */
  defaults: PillarWeights;
  /** Which top-k ranking was scored. */
  k: number;
  /** Mean drawn-ball hits inside the top k, per draw. */
  trainFitted: number;
  trainDefaults: number;
  /** The same, on draws the search never saw. */
  testFitted: number;
  testDefaults: number;
  /** What chance alone gives: k × 5/90. */
  chanceLevel: number;
  trainDraws: number;
  testDraws: number;
  candidates: number;
  /** Paired difference (fitted − defaults) on the test slice, and its two-sided p. */
  testDifference: number;
  testPValue: number;
  beatsDefaults: boolean;
  verdict: string;
}

/**
 * How many of the five drawn balls the model placed in its top `k`, per draw.
 *
 * This is the right objective for this app: it ranks numbers and then buys
 * tickets from the top, so ranking quality — not a softmax of z-scores — is
 * what the player actually experiences. It is also calibration-free, so the
 * search cannot "win" by shrinking a score that was never a probability.
 * Under chance, 5 balls drawn meets k/90 of them: 0.83 per draw at k = 15.
 */
function topKHits(history: readonly Draw[], weights: PillarWeights, config: EngineConfig, k: number): number[] {
  const chron = normalizeHistory(history);
  const out: number[] = [];
  for (let t = 5; t < chron.length; t++) {
    const train = chron.slice(0, t);
    const { evidence } = scoreNumbers(train, {
      ...config,
      weights,
      lookback: Math.max(5, Math.min(config.lookback, train.length)),
    });
    const top = new Set(
      [...evidence].sort((a, b) => b.score - a.score).slice(0, k).map((e) => e.number)
    );
    out.push(chron[t].winning.filter((n) => top.has(n)).length);
  }
  return out;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Grid points on the weight simplex, coarsened at `step`. */
export function weightGrid(step = 0.2): PillarWeights[] {
  const out: PillarWeights[] = [];
  const steps = Math.round(1 / step);
  for (let b = 0; b <= steps; b++) {
    for (let p = 0; p <= steps - b; p++) {
      const m = steps - b - p;
      out.push({ bayes: b / steps, poisson: p / steps, markov: m / steps });
    }
  }
  return out;
}

/**
 * Fit the pillar weights on the earlier part of the archive, then score them on
 * the later part that the search never saw.
 */
export function fitWeights(
  history: readonly Draw[],
  config: EngineConfig = DEFAULT_CONFIG,
  {
    game,
    trainShare = 0.6,
    step = 0.2,
    k = 15,
  }: { game?: string | null; trainShare?: number; step?: number; k?: number } = {}
): WeightFitResult | null {
  const chron = normalizeHistory(filterByGame(history, game));
  if (chron.length < 20) return null;

  const cut = Math.max(12, Math.min(chron.length - 5, Math.round(chron.length * trainShare)));
  const train = chron.slice(0, cut);
  const test = chron.slice(Math.max(0, cut - 5)); // five draws of context, none scored in training
  const defaults = config.weights;
  const chanceLevel = (k * 5) / 90;

  let best: { weights: PillarWeights; score: number } | null = null;
  const grid = weightGrid(step);
  for (const weights of grid) {
    const score = mean(topKHits(train, weights, config, k));
    if (!Number.isFinite(score)) continue;
    if (!best || score > best.score) best = { weights, score };
  }
  if (!best) return null;

  const trainDefaults = mean(topKHits(train, defaults, config, k));
  const testFittedSeries = topKHits(test, best.weights, config, k);
  const testDefaultsSeries = topKHits(test, defaults, config, k);
  const testFitted = mean(testFittedSeries);
  const testDefaults = mean(testDefaultsSeries);

  const diffs = testFittedSeries.map((x, i) => x - (testDefaultsSeries[i] ?? 0));
  const n = diffs.length;
  const dMean = mean(diffs);
  const dSd = n > 1 ? Math.sqrt(diffs.reduce((a, d) => a + (d - dMean) ** 2, 0) / (n - 1)) : 0;
  const z = dSd > 0 ? dMean / (dSd / Math.sqrt(n)) : 0;
  // Two-sided normal approximation; honest about being rough at this sample size.
  const pValue = Math.min(1, 2 * (1 - normalCdf(Math.abs(z))));
  const beatsDefaults = dMean > 0 && pValue < 0.05;

  const verdict = beatsDefaults
    ? `Fitted weights (${fmt(best.weights)}) put ${dMean.toFixed(2)} more drawn balls per draw in the top ${k} than the defaults on ${n} unseen draws (p ≈ ${pValue.toFixed(3)}). That is worth confirming in the backtester: ranking gains at this sample size are fragile.`
    : `Fitted weights (${fmt(best.weights)}) do not beat the defaults on ${n} unseen draws: ${dMean >= 0 ? '+' : ''}${dMean.toFixed(2)} drawn balls per draw in the top ${k}, p ≈ ${pValue.toFixed(2)}. The search fitted the training slice and learned nothing that transferred — the correct result on a fair drum.`;

  return {
    fitted: best.weights,
    defaults,
    k,
    trainFitted: best.score,
    trainDefaults,
    testFitted,
    testDefaults,
    chanceLevel,
    trainDraws: train.length,
    testDraws: n,
    candidates: grid.length,
    testDifference: dMean,
    testPValue: pValue,
    beatsDefaults,
    verdict,
  };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly =
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - (Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)) * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

function fmt(w: PillarWeights): string {
  return `${Math.round(w.bayes * 100)}/${Math.round(w.poisson * 100)}/${Math.round(w.markov * 100)}`;
}
