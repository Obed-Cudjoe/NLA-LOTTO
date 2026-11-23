import { describe, expect, it } from 'vitest';
import {
  BASE_P,
  buildMarkov,
  CHANCE_ONE,
  CHANCE_THREE,
  CHANCE_TWO,
  DEFAULT_CONFIG,
  EXPECTED_GAP,
  auditTrio,
  backtest,
  bayesPosterior,
  binomialTailAtLeast,
  chanceAtLeastOneHit,
  choose,
  deduce,
  incompleteBeta,
  normalizeHistory,
  normalizeWeights,
  parseCsv,
  poissonGap,
  reviewLastDraw,
  scoreNumbers,
  transitionProbability,
  trioEntropy,
  validateDraw,
  wilsonInterval,
  type Draw,
} from '../src/mathEngine';
import seed from '../data/draws.json';

const history: Draw[] = seed.map((d) => ({
  draw_date: d.draw_date,
  game_name: d.game_name,
  winning: d.winning,
  machine: d.machine,
}));

/** Deterministic synthetic history: n draws, uniform random, seeded. */
function synthetic(count: number, seedNum = 7): Draw[] {
  let a = seedNum >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: Draw[] = [];
  const base = new Date('2026-01-05T00:00:00Z');
  for (let i = 0; i < count; i++) {
    const pool = Array.from({ length: 90 }, (_, k) => k + 1);
    const picks: number[] = [];
    for (let k = 0; k < 10; k++) picks.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    out.push({
      draw_date: d.toISOString().slice(0, 10),
      game_name: 'Midweek',
      winning: picks.slice(0, 5),
      machine: picks.slice(5),
    });
  }
  return out;
}

describe('constants', () => {
  it('matches the 5/90 chance rates', () => {
    expect(BASE_P).toBeCloseTo(0.0555555, 6);
    expect(EXPECTED_GAP).toBe(18);
    expect(CHANCE_ONE).toBeCloseTo(5 / 90, 12);
    expect(CHANCE_TWO).toBeCloseTo(10 / 4005, 12);
    expect(CHANCE_THREE).toBeCloseTo(10 / 117480, 12);
    expect(choose(90, 3)).toBe(117480);
  });
});

describe('distribution helpers', () => {
  it('computes the regularised incomplete beta correctly', () => {
    // I_0.5(1,1) = 0.5; I_0.5(2,2) = 0.5
    expect(incompleteBeta(1, 1, 0.5)).toBeCloseTo(0.5, 8);
    expect(incompleteBeta(2, 2, 0.5)).toBeCloseTo(0.5, 8);
    // Beta(1,b) => I_x = 1-(1-x)^b
    expect(incompleteBeta(1, 3, 0.2)).toBeCloseTo(1 - Math.pow(0.8, 3), 8);
  });

  it('computes exact binomial tails', () => {
    // Fair coin, 10 tosses, P(X >= 8) = 56/1024
    expect(binomialTailAtLeast(8, 10, 0.5)).toBeCloseTo(56 / 1024, 8);
    expect(binomialTailAtLeast(0, 10, 0.5)).toBe(1);
    expect(binomialTailAtLeast(11, 10, 0.5)).toBe(0);
  });

  it('computes Wilson intervals that bracket the point estimate', () => {
    const [lo, hi] = wilsonInterval(5, 100);
    expect(lo).toBeLessThan(0.05);
    expect(hi).toBeGreaterThan(0.05);
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeLessThan(1);
  });
});

describe('draw validation', () => {
  it('accepts a well-formed draw', () => {
    const r = validateDraw({
      draw_date: '2026-11-23',
      game_name: 'Monday Special',
      winning: [1, 2, 3, 4, 5],
      machine: [6, 7, 8, 9, 10],
    });
    expect(r.ok).toBe(true);
    expect(r.draw?.winning).toHaveLength(5);
  });

  it('accepts flat num1..mac5 columns', () => {
    const r = validateDraw({
      draw_date: '2026-11-24',
      game_name: 'Lucky Tuesday',
      num1: 11,
      num2: 22,
      num3: 33,
      num4: 44,
      num5: 55,
      mac1: 66,
      mac2: 77,
      mac3: 88,
      mac4: 89,
      mac5: 90,
    });
    expect(r.ok).toBe(true);
  });

  it('rejects out-of-range, duplicate and overlapping numbers', () => {
    expect(
      validateDraw({ draw_date: '2026-11-23', game_name: 'Midweek', winning: [0, 2, 3, 4, 5], machine: [6, 7, 8, 9, 10] }).ok
    ).toBe(false);
    expect(
      validateDraw({ draw_date: '2026-11-23', game_name: 'Midweek', winning: [1, 1, 3, 4, 5], machine: [6, 7, 8, 9, 10] }).ok
    ).toBe(false);
    expect(
      validateDraw({ draw_date: '2026-11-23', game_name: 'Midweek', winning: [1, 2, 3, 4, 5], machine: [5, 7, 8, 9, 10] }).ok
    ).toBe(false);
    expect(
      validateDraw({ draw_date: '23/11/2026', game_name: 'Midweek', winning: [1, 2, 3, 4, 5], machine: [6, 7, 8, 9, 10] }).ok
    ).toBe(false);
  });

  it('parses CSV with and without a header', () => {
    const csv = [
      'date,game,num1,num2,num3,num4,num5,mac1,mac2,mac3,mac4,mac5',
      '2026-11-23,Monday Special,1,2,3,4,5,6,7,8,9,10',
      '2026-11-24,Lucky Tuesday,11,12,13,14,15,16,17,18,19,20',
    ].join('\n');
    const parsed = parseCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1].game_name).toBe('Lucky Tuesday');
  });
});

describe('Pillar 1 — Bayesian posterior', () => {
  it('returns the uniform prior when a number never appears', () => {
    const window = synthetic(30);
    const b = bayesPosterior(window, 90);
    expect(b.posteriorMean).toBeLessThan(BASE_P);
    expect(b.probHotterThanPrior).toBeLessThan(0.5);
  });

  it('moves the posterior up with appearances and respects the prior strength', () => {
    const window: Draw[] = Array.from({ length: 20 }, (_, i) => ({
      draw_date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      game_name: 'Midweek',
      winning: [7, 11, 20, 30, 40],
      machine: [1, 2, 3, 4, 5],
    }));
    const strong = bayesPosterior(window, 7, 4);
    const weak = bayesPosterior(window, 7, 400);
    expect(strong.posteriorMean).toBeGreaterThan(BASE_P);
    expect(strong.posteriorMean).toBeGreaterThan(weak.posteriorMean);
    expect(strong.probHotterThanPrior).toBeGreaterThan(0.95);
    expect(strong.hits).toBe(20);
  });
});

describe('Pillar 2 — Poisson inter-arrival', () => {
  it('reports gap 0 for a number in the latest draw and grows otherwise', () => {
    const drawn = history[history.length - 1].winning[0];
    expect(poissonGap(history, drawn).gap).toBe(0);
    const absent = Array.from({ length: 90 }, (_, i) => i + 1).find(
      (n) => !history[history.length - 1].winning.includes(n)
    )!;
    expect(poissonGap(history, absent).gap).toBeGreaterThanOrEqual(0);
  });

  it('flags long gaps as overdue with a high z-score', () => {
    const window = synthetic(60, 99);
    const never = Array.from({ length: 90 }, (_, i) => i + 1).find((n) =>
      window.every((d) => !d.winning.includes(n))
    )!;
    const g = poissonGap(window, never);
    expect(g.censored).toBe(true);
    expect(g.z).toBeGreaterThan(1);
    expect(g.overdue).toBe(true);
    expect(g.survival).toBeLessThan(0.05);
  });
});

describe('Pillar 3 — Markov chain', () => {
  it('produces 90 ranks, standardised scores and coherent evidence', () => {
    const { evidence, weights } = scoreNumbers(history, DEFAULT_CONFIG);
    expect(evidence).toHaveLength(90);
    expect(new Set(evidence.map((e) => e.number)).size).toBe(90);
    expect(weights.bayes + weights.poisson + weights.markov).toBeCloseTo(1, 10);
    expect(evidence[0].score).toBeGreaterThanOrEqual(evidence[89].score);
    expect(evidence.every((e) => Number.isFinite(e.score))).toBe(true);
    expect(evidence.every((e) => e.markov.lift > 0)).toBe(true);
  });

  it('normalises transition rows so each source expects 5 winning numbers', () => {
    const m = buildMarkov(history);
    const source = history[10].winning[0];
    let rowSum = 0;
    for (let b = 1; b <= 90; b++) rowSum += transitionProbability(m, source, b);
    expect(rowSum).toBeCloseTo(5, 6);

    // Average lift across all 90 numbers must centre on 1.0 (independence).
    const lifts: number[] = [];
    const last = history[history.length - 1];
    for (let n = 1; n <= 90; n++) {
      let expected = 0;
      let weight = 0;
      for (const from of last.winning) {
        expected += transitionProbability(m, from, n);
        weight += 1;
      }
      lifts.push(expected / (weight * (5 / 90)));
    }
    const avg = lifts.reduce((a, b) => a + b, 0) / lifts.length;
    expect(avg).toBeGreaterThan(0.85);
    expect(avg).toBeLessThan(1.15);
  });

  it('normalises weights safely', () => {
    expect(normalizeWeights({ bayes: 2, poisson: 1, markov: 1 })).toEqual({
      bayes: 0.5,
      poisson: 0.25,
      markov: 0.25,
    });
    expect(normalizeWeights({ bayes: 0, poisson: 0, markov: 0 })).toEqual({
      bayes: 1 / 3,
      poisson: 1 / 3,
      markov: 1 / 3,
    });
  });
});

describe('Pillar 4 — combinatorial audit', () => {
  it('rejects same-decade, all-odd and out-of-range sums', () => {
    expect(auditTrio([1, 3, 5]).spreadOk).toBe(false); // all in the 1–10 decade
    expect(auditTrio([1, 11, 21]).spreadOk).toBe(true);
    expect(auditTrio([41, 43, 45]).parityOk).toBe(false);
    expect(auditTrio([1, 2, 3]).sumOk).toBe(false); // sum 6 < 75
    expect(auditTrio([1, 2, 3]).pass).toBe(false);
    expect(auditTrio([12, 47, 88]).pass).toBe(true);
  });

  it('scores entropy higher for spread-out trios', () => {
    expect(trioEntropy([12, 47, 88])).toBeGreaterThan(trioEntropy([41, 43, 45]));
    expect(trioEntropy([12, 47, 88])).toBeGreaterThan(0.8);
  });

  it('selects a passing trio from the candidate pool', () => {
    const d = deduce(history, DEFAULT_CONFIG);
    expect(d.trio.numbers).toHaveLength(3);
    expect(d.trio.audit.pass).toBe(true);
    expect(d.trio.audit.sum).toBeGreaterThanOrEqual(75);
    expect(d.trio.audit.sum).toBeLessThanOrEqual(195);
    expect(d.trio.audit.distinctDecades).toBeGreaterThanOrEqual(2);
    expect(d.meta.validCombos).toBeGreaterThan(0);
    expect(d.coverageTickets).toHaveLength(3);
    expect(d.top).toHaveLength(3);
    expect(d.top[0].plain.overall.length).toBeGreaterThan(10);
    expect(d.next.date > d.meta.windowEnd).toBe(true);
  });

  it('honours custom weights (markov-only vs bayes-only differ)', () => {
    const bayesOnly = deduce(history, {
      ...DEFAULT_CONFIG,
      weights: { bayes: 1, poisson: 0, markov: 0 },
    });
    const markovOnly = deduce(history, {
      ...DEFAULT_CONFIG,
      weights: { bayes: 0, poisson: 0, markov: 1 },
    });
    expect(bayesOnly.top.map((t) => t.number)).not.toEqual(markovOnly.top.map((t) => t.number));
  });
});

describe('walk-forward backtester', () => {
  it('only ever trains on draws strictly before the target', () => {
    const result = backtest(history, DEFAULT_CONFIG, { minTrain: 25 });
    expect(result.runs.length).toBeGreaterThan(10);
    for (const run of result.runs) {
      expect(run.trainingDraws).toBe(run.index);
      expect(run.trainingDraws).toBeLessThan(run.index + 1);
    }
    // The first evaluated draw must have exactly minTrain history draws before it.
    expect(result.runs[0].trainingDraws).toBeGreaterThanOrEqual(25);
    expect(result.runs.at(-1)!.draw_date).toBe(history.at(-1)!.draw_date);
  });

  it('produces a coherent, honestly-labelled audit', () => {
    const result = backtest(history, DEFAULT_CONFIG, { minTrain: 25, simulations: 50 });
    const s = result.summary;
    expect(s.draws).toBe(result.runs.length);
    expect(s.oneNumber.trials).toBe(s.draws);
    expect(s.oneNumber.expectedRate).toBeCloseTo(5 / 90, 10);
    expect(s.twoSure.expectedRate).toBeCloseTo(10 / 4005, 10);
    expect(s.threeDirect.expectedRate).toBeCloseTo(10 / 117480, 10);
    expect(s.oneNumber.hits).toBe(result.runs.filter((r) => r.hit1).length);
    expect(s.randomBaseline.simulations).toBe(50);
    expect(s.oneNumber.verdict).toMatch(/chance|p=/);
    // The distribution must add up to the number of runs.
    const distTotal = Object.values(s.line5.distribution).reduce((a, b) => a + b, 0);
    expect(distTotal).toBe(s.draws);
  });

  it('is deterministic across runs', () => {
    const a = backtest(history, DEFAULT_CONFIG, { minTrain: 25, simulations: 20 });
    const b = backtest(history, DEFAULT_CONFIG, { minTrain: 25, simulations: 20 });
    expect(a.runs.map((r) => r.trio)).toEqual(b.runs.map((r) => r.trio));
  });
});

describe('history helpers', () => {
  it('sorts and de-duplicates by date', () => {
    const messy = [history[2], history[0], history[1], history[1]];
    const clean = normalizeHistory(messy);
    expect(clean).toHaveLength(3);
    expect(clean.map((d) => d.draw_date)).toEqual([...clean.map((d) => d.draw_date)].sort());
  });
});

describe('reviewLastDraw — the daily result check', () => {
  it('re-runs the walk-forward step and counts real hits', () => {
    const review = reviewLastDraw(history, DEFAULT_CONFIG);
    expect(review).not.toBeNull();
    const r = review!;
    expect(r.actual.draw_date).toBe(history[history.length - 1].draw_date);
    expect(r.predicted.numbers).toHaveLength(3);
    expect(r.hits).toBe(r.matched.length);
    expect(r.matched.every((n) => r.actual.winning.includes(n))).toBe(true);
    expect(r.matchedMachine.every((n) => !r.actual.winning.includes(n))).toBe(true);
    expect(r.ranked).toHaveLength(5);
    expect(r.ranked.map((x) => x.number).sort((a, b) => a - b)).toEqual(
      [...r.actual.winning].sort((a, b) => a - b)
    );
    expect(r.verdict.length).toBeGreaterThan(20);
  });

  it('reports chance-level expectations, not promises', () => {
    const r = reviewLastDraw(history, DEFAULT_CONFIG)!;
    expect(r.expectedHits).toBeCloseTo(3 * (5 / 90), 10);
    // 1 - C(85,3)/C(90,3)
    expect(r.pAtLeastOne).toBeCloseTo(0.1593, 3);
    expect(chanceAtLeastOneHit(0)).toBeCloseTo(0, 10);
    expect(chanceAtLeastOneHit(1)).toBeCloseTo(5 / 90, 10);
  });

  it('is deterministic — same history, same verdict', () => {
    const a = reviewLastDraw(history, DEFAULT_CONFIG)!;
    const b = reviewLastDraw(history, DEFAULT_CONFIG)!;
    expect(a.predicted.numbers).toEqual(b.predicted.numbers);
    expect(a.verdict).toBe(b.verdict);
  });

  it('returns null rather than inventing a comparison', () => {
    expect(reviewLastDraw([], DEFAULT_CONFIG)).toBeNull();
    expect(reviewLastDraw(history.slice(0, 5), DEFAULT_CONFIG)).toBeNull();
  });
});
