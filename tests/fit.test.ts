import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type Draw } from '../src/mathEngine';
import { fitWeights, weightGrid } from '../src/fit';

function draw(i: number, winning: number[]): Draw {
  return {
    draw_date: new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10),
    game_name: 'Midweek',
    winning,
    machine: [91, 92, 93, 94, 95].map((n) => ((n + i) % 90) + 1),
  };
}

describe('weight fitting', () => {
  it('walks the whole weight simplex', () => {
    const grid = weightGrid(0.25);
    expect(grid).toHaveLength(15); // (n+1)(n+2)/2 for n = 4
    for (const w of grid) {
      expect(w.bayes + w.poisson + w.markov).toBeCloseTo(1, 10);
    }
  });

  it('refuses to fit on a handful of draws', () => {
    expect(fitWeights([draw(0, [1, 2, 3, 4, 5])])).toBeNull();
  });

  it('reports train and test slices separately, never one score', () => {
    const draws = Array.from({ length: 30 }, (_, i) =>
      draw(i, [1 + ((i * 7) % 30), 31 + ((i * 11) % 30), 61, 62, 63])
    );
    const r = fitWeights(draws, DEFAULT_CONFIG, { step: 0.25 });
    expect(r).not.toBeNull();
    expect(r!.testDraws).toBeGreaterThan(0);
    expect(r!.trainDraws).toBeGreaterThan(r!.testDraws);
    expect(r!.chanceLevel).toBeCloseTo((15 * 5) / 90, 10);
    expect(r!.testPValue).toBeGreaterThanOrEqual(0);
    expect(r!.testPValue).toBeLessThanOrEqual(1);
  });

  it('does not claim a win without out-of-sample evidence and a small p', () => {
    const draws = Array.from({ length: 30 }, (_, i) => draw(i, [1 + (i % 5), 20, 40, 60, 80]));
    const r = fitWeights(draws, DEFAULT_CONFIG, { step: 0.25 })!;
    if (r.beatsDefaults) {
      expect(r.testDifference).toBeGreaterThan(0);
      expect(r.testPValue).toBeLessThan(0.05);
    } else {
      expect(r.verdict).toMatch(/do not beat|does not beat/);
    }
  });
});
