import { describe, expect, it } from 'vitest';
import {
  NLA_MULTIPLIERS,
  betTypes,
  bestBet,
  coverage,
  directProbability,
  expectedReturn,
  linesForConfidence,
  probabilityOfMatch,
} from '../src/bets';

describe('NLA bet types and their exact value', () => {
  it('computes exact Direct probabilities', () => {
    expect(directProbability(1)).toBeCloseTo(1 / 90, 12);
    expect(directProbability(2)).toBeCloseTo(10 / 4005, 12);
    expect(directProbability(3)).toBeCloseTo(10 / 117480, 12);
    expect(directProbability(5)).toBeCloseTo(1 / 43949268, 12);
  });

  it('uses the published multipliers', () => {
    expect(NLA_MULTIPLIERS.direct1).toBe(40);
    expect(NLA_MULTIPLIERS.direct2).toBe(240);
    expect(NLA_MULTIPLIERS.direct3).toBe(2100);
    expect(NLA_MULTIPLIERS.direct5).toBe(44000);
  });

  it('shows every bet type losing money, best-EV first', () => {
    const bets = betTypes();
    expect(bets).toHaveLength(5);
    for (const b of bets) {
      expect(b.ev).toBeLessThan(1);
      expect(b.houseEdge).toBeGreaterThan(0);
      expect(b.ev).toBeCloseTo(b.probability * b.multiplier, 12);
      expect(b.oneIn).toBeCloseTo(1 / b.probability, 6);
    }
    const evs = bets.map((b) => b.ev);
    expect(evs).toEqual([...evs].sort((a, b) => b - a));
  });

  it('names Direct 2 as the least-bad ticket and Direct 5 as the worst', () => {
    const best = bestBet();
    expect(best.id).toBe('direct2');
    const worst = betTypes()[4];
    expect(worst.id).toBe('direct5');
    // Direct 2 returns ~60% of stake; Direct 5 returns ~0.1%.
    expect(best.ev).toBeGreaterThan(0.55);
    expect(worst.ev).toBeLessThan(0.002);
  });

  it('keeps expected return honest for degenerate inputs', () => {
    expect(probabilityOfMatch(2, 3)).toBe(0);
    expect(expectedReturn(0, 1000)).toBe(0);
  });

  it('shows coverage buying lines, not edge', () => {
    const one = coverage({ betId: 'direct5', lines: 1, stakePerLine: 10 });
    const many = coverage({ betId: 'direct5', lines: 1000, stakePerLine: 10 });
    expect(many.totalStake).toBe(10 * 1000);
    // Ten thousand cedis of Direct 5 lines buys a tiny chance and no edge at all.
    expect(many.evPerCedi).toBeCloseTo(one.evPerCedi, 12);
    expect(many.evPerCedi).toBeLessThan(0.01);
    expect(many.pAnyWin).toBeGreaterThan(one.pAnyWin);
    expect(many.netPerPlay).toBeLessThan(0);
  });

  it('computes how many lines a confidence target needs', () => {
    const lines = linesForConfidence('direct5', 0.5);
    expect(lines).toBeGreaterThan(3e7);
    expect(linesForConfidence('direct1', 0.5)).toBeGreaterThan(60);
  });
});
