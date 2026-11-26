import { describe, expect, it } from 'vitest';
import {
  buildLedger,
  hitLadder,
  hitsDistribution,
  hitsTail,
  hypergeomPmf,
  ledgerToCsv,
  nearMissRecord,
  planHorizon,
} from '../src/trainingLog';

describe('training ledger and the pre-registered horizon', () => {
  it('knows the one-draw distribution of hits on five numbers', () => {
    const pmf = Array.from({ length: 6 }, (_, k) => hypergeomPmf(k));
    expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(pmf[0]).toBeCloseTo(0.7467, 3); // blank five ~75% of the time
    expect(hitsTail(1, 1)).toBeCloseTo(0.2533, 3);
    expect(5 * (5 / 90)).toBeCloseTo(0.2778, 4);
  });

  it('convolves over a horizon without drifting from the mean', () => {
    const pmf = hitsDistribution(7);
    const mean = pmf.reduce((a, p, k) => a + p * k, 0);
    expect(mean).toBeCloseTo(7 * 5 * (5 / 90), 6);
    expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('pre-registers a threshold that seven draws could reach', () => {
    const plan = planHorizon(7);
    expect(plan.expectedHits).toBeCloseTo(1.94, 2);
    expect(plan.threshold).toBe(5); // exact convolution, not a guess
    expect(plan.thresholdP).toBeLessThan(0.05);
    expect(plan.verdict).toContain('indistinguishable from luck');
  });

  it('scores a ledger from backtest rows, pair wins counted only when both land', () => {
    const rows = [
      { draw_date: '2026-11-24', game_name: 'Lucky Tuesday', line5: [1, 2, 3, 4, 5], pair: [1, 2], trio: [1, 2, 3], line5Hits: 0, winning: [9, 10, 11, 12, 13] },
      { draw_date: '2026-11-25', game_name: 'Midweek', line5: [32, 80, 47, 12, 71], pair: [32, 80], trio: [32, 80, 47], line5Hits: 1, winning: [58, 32, 36, 22, 42] },
      { draw_date: '2026-11-26', game_name: 'Fortune Thursday', line5: [17, 78, 73, 20, 49], pair: [17, 78], trio: [17, 78, 73], line5Hits: 0, winning: [17, 78, 5, 6, 7] },
    ];
    const l = buildLedger(rows);
    expect(l.draws).toBe(3);
    expect(l.totalHits).toBe(1);
    expect(l.pairHits).toBe(1); // the third row: both 17 and 78 drawn
    expect(l.pValue).toBeGreaterThan(0.5); // one hit in three draws is pure noise
    expect(ledgerToCsv(l).split('\n')).toHaveLength(4);
  });

  it('refuses an empty ledger instead of dividing by zero', () => {
    const l = buildLedger([]);
    expect(l.draws).toBe(0);
    expect(l.pValue).toBe(1);
    expect(l.expectedHits).toBe(0);
  });

  it('prices the near miss: two of five is 1 in 44 and pays nothing', () => {
    const ladder = hitLadder();
    expect(ladder).toHaveLength(6);
    expect(ladder[2].oneIn).toBeGreaterThan(43);
    expect(ladder[2].oneIn).toBeLessThan(46);
    expect(ladder[2].pays).toContain('nothing');
    expect(ladder[5].pays).toContain('the prize');
    expect(hitsTail(1, 2)).toBeCloseTo(0.0233, 3); // two or more, per draw
  });

  it('scores the near misses actually seen against what chance expects', () => {
    const runs = [
      ...Array.from({ length: 36 }, (_, i) => ({ draw_date: `2026-10-${i + 1}`, line5: [1, 2, 3, 4, 5], winning: [9, 10, 11, 12, 13], line5Hits: 0 })),
      { draw_date: '2026-10-13', line5: [31, 46, 52, 60, 68], winning: [9, 23, 60, 63, 68], line5Hits: 2 },
      { draw_date: '2026-10-16', line5: [12, 31, 46, 68, 78], winning: [22, 36, 46, 49, 68], line5Hits: 2 },
    ];
    const near = nearMissRecord(runs);
    expect(near.draws).toBe(38);
    expect(near.twoPlus).toBe(2);
    expect(near.expectedTwoPlus).toBeCloseTo(0.89, 1);
    expect(near.pAtLeast).toBeGreaterThan(0.15); // two in 38 is unremarkable
    expect(near.pAtLeast).toBeLessThan(0.4);
    expect(near.examples[0].hits).toBe(2);
  });
});
