/**
 * Shared domain types for the Ghana NLA 5/90 Deduction Engine.
 *
 * Everything here is pure data — no D1, no fetch, no DOM. That is what lets the
 * identical deduction code run inside a Cloudflare Worker, inside a Node test,
 * and inside the browser bundle used by the GitHub Pages build.
 */

/** The six NLA 5/90 evening games, in weekday order. */
export const GAMES = [
  'Monday Special',
  'Lucky Tuesday',
  'Midweek',
  'Fortune Thursday',
  'Friday Bonanza',
  'National Weekly',
] as const;

export type GameName = (typeof GAMES)[number];

/** Weekday (0 = Sunday) on which each game is drawn. */
export const GAME_WEEKDAY: Record<GameName, number> = {
  'Monday Special': 1,
  'Lucky Tuesday': 2,
  Midweek: 3,
  'Fortune Thursday': 4,
  'Friday Bonanza': 5,
  'National Weekly': 6,
};

/** Balls in the machine. */
export const BALLS = 90;
/** Winning numbers drawn per event. */
export const WINNING_COUNT = 5;
/** Machine (extra) numbers drawn per event. */
export const MACHINE_COUNT = 5;
/** Unconditional probability that one specific number is a winning number. */
export const BASE_P = WINNING_COUNT / BALLS; // 0.05555...
/** Expected gap, in draws, between appearances of one specific number. */
export const EXPECTED_GAP = 1 / BASE_P; // 18

/** A draw in engine form (arrays, chronological). */
export interface Draw {
  draw_date: string; // ISO 'YYYY-MM-DD'
  game_name: string;
  winning: number[]; // exactly 5, 1..90
  machine: number[]; // exactly 5, 1..90
}

/** A draw as stored in D1 (flat columns, matching schema.sql). */
export interface DrawRow {
  id?: number;
  draw_date: string;
  game_name: string;
  num1: number;
  num2: number;
  num3: number;
  num4: number;
  num5: number;
  mac1: number;
  mac2: number;
  mac3: number;
  mac4: number;
  mac5: number;
  source?: string;
  created_at?: string;
}

/** Normalised weights for the three scoring pillars. */
export interface PillarWeights {
  bayes: number;
  poisson: number;
  markov: number;
}

/** Everything the engine needs to produce a deduction. */
export interface EngineConfig {
  /** How many recent draws feed the model. 0 or negative = all history. */
  lookback: number;
  /** Relative influence of each pillar (auto-normalised). */
  weights: PillarWeights;
  /** Beta prior strength (pseudo-draws). Larger = more sceptical of streaks. */
  bayesPriorStrength: number;
  /** Shrinkage strength (pseudo-counts) pulling Markov rows to the 5/90 baseline. */
  markovAlpha: number;
  /** Weight applied to machine numbers when building Markov transitions (0..1). */
  markovMachineWeight: number;
  /** Expected inter-arrival gap in draws. */
  expectedGap: number;
  /** Candidate pool size used for exhaustive trio search. */
  poolSize: number;
  /** Combinatorial filters. */
  filters: {
    decadeSpread: boolean;
    parityBalance: boolean;
    sumRange: boolean;
    minSum: number;
    maxSum: number;
  };
}

export const DEFAULT_CONFIG: EngineConfig = {
  lookback: 40,
  weights: { bayes: 0.45, poisson: 0.25, markov: 0.3 },
  bayesPriorStrength: 24,
  markovAlpha: 12,
  markovMachineWeight: 0.5,
  expectedGap: EXPECTED_GAP,
  poolSize: 15,
  filters: {
    decadeSpread: true,
    parityBalance: true,
    sumRange: true,
    minSum: 75,
    maxSum: 195,
  },
};

/** Per-number evidence across the three scoring pillars. */
export interface NumberEvidence {
  number: number;
  /** Pillar 1 — Bayesian posterior */
  bayes: {
    hits: number;
    trials: number;
    alpha: number;
    beta: number;
    posteriorMean: number;
    priorMean: number;
    lift: number;
    /** P(p > prior mean | data), from the Beta posterior. */
    probHotterThanPrior: number;
    sd: number;
  };
  /** Pillar 2 — Poisson inter-arrival / z-score */
  poisson: {
    gap: number;
    expectedGap: number;
    sd: number;
    z: number;
    /** P(gap >= observed) under the geometric inter-arrival law. */
    survival: number;
    overdue: boolean;
    censored: boolean;
  };
  /** Pillar 3 — first-order Markov */
  markov: {
    expectedFollow: number;
    baseline: number;
    lift: number;
    bestPredecessor: { from: number; probability: number } | null;
  };
  /** Pillar z-scores (each standardised across 1..90 so weights are comparable). */
  z: { bayes: number; poisson: number; markov: number };
  /** Blended z-score using normalised weights. */
  score: number;
  /** Weighted contribution of each pillar to `score`. */
  contribution: { bayes: number; poisson: number; markov: number };
  rank: number;
  /** Short plain-English sentences, one per pillar + overall. */
  plain: { bayes: string; poisson: string; markov: string; overall: string };
}

/** Result of the combinatorial audit on a candidate trio. */
export interface CombinatorialAudit {
  numbers: number[];
  decades: number[];
  distinctDecades: number;
  odd: number;
  even: number;
  sum: number;
  spreadOk: boolean;
  parityOk: boolean;
  sumOk: boolean;
  pass: boolean;
  /** 0..1 — how evenly the trio is spread across decades / parity / quartiles. */
  entropy: number;
  /** Informational flags about patterns humans tend to choose. No EV effect. */
  patterns: string[];
}

export interface Trio {
  numbers: number[];
  score: number;
  audit: CombinatorialAudit;
}

export interface Deduction {
  next: { game: string; date: string; label: string };
  top: NumberEvidence[];
  trio: Trio;
  alternatives: Trio[];
  coverageTickets: { numbers: number[]; score: number }[];
  evidence: NumberEvidence[];
  meta: {
    drawsUsed: number;
    totalDraws: number;
    windowStart: string;
    windowEnd: string;
    weights: PillarWeights;
    poolSize: number;
    validCombos: number;
    testedCombos: number;
    /** Shannon entropy (bits) of the blended score distribution. */
    scoreEntropy: number;
    generatedAt: string;
  };
}

/**
 * What the engine said *before* the most recent stored draw, next to what the
 * drum actually produced. Deterministic: it re-runs the walk-forward step, so
 * it is available even for draws that happened before this feature existed.
 */
export interface LastDrawReview {
  actual: Draw;
  predicted: { numbers: number[]; targetDate: string; weights: PillarWeights };
  /** Predicted numbers that landed in the five winning numbers. */
  matched: number[];
  /** Predicted numbers that landed in the machine numbers (not a win). */
  matchedMachine: number[];
  hits: number;
  /** 3 picks x 5/90. */
  expectedHits: number;
  /** Exact hypergeometric probability of at least one hit with three picks. */
  pAtLeastOne: number;
  /** The winning numbers as the model ranked them *before* the draw. */
  ranked: Array<{ number: number; rank: number; z: number; hit: boolean }>;
  verdict: string;
}

export interface BacktestRun {
  index: number;
  draw_date: string;
  game_name: string;
  winning: number[];
  machine: number[];
  line5: number[];
  top1: number;
  pair: number[];
  trio: number[];
  hit1: boolean;
  hit2: boolean;
  hit3: boolean;
  /** Picks that landed in the winning five. */
  matched: number[];
  /** Picks that landed anywhere in the ten drawn numbers. */
  matchedInclMachine: number[];
  line5Hits: number;
  trioScore: number;
  trainingDraws: number;
}

export interface RateAudit {
  hits: number;
  trials: number;
  rate: number;
  expectedRate: number;
  expectedHits: number;
  lift: number;
  ci: [number, number];
  /** One-sided exact binomial p-value for "better than chance". */
  pValue: number;
  /** Verdict in plain English. */
  verdict: string;
}

export interface BacktestResult {
  runs: BacktestRun[];
  summary: {
    draws: number;
    minTrain: number;
    oneNumber: RateAudit;
    twoSure: RateAudit;
    threeDirect: RateAudit;
    line5: {
      avgHits: number;
      expectedHits: number;
      bestLine: { date: string; numbers: number[]; hits: number } | null;
      distribution: Record<number, number>;
    };
    /** Random-pick Monte-Carlo baseline for the same number of draws. */
    randomBaseline: {
      simulations: number;
      meanTrioHits: number;
      p95TrioHits: number;
      meanOneNumberHits: number;
      percentile: number;
      note: string;
    };
  };
  config: EngineConfig;
}
