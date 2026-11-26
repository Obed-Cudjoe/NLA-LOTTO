import { afterEach, describe, expect, it } from 'vitest';
import {
  NLA_MULTIPLIERS,
  betTypes,
  bestBet,
  coverage,
  directProbability,
  expectedReturn,
  linesForConfidence,
  probabilityOfMatch,
  setPriceOverrides,
  guarantee,
  planForChance,
  doubleChance,
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

describe('prices the player is actually paid', () => {
  afterEach(() => setPriceOverrides({}));

  it('defaults to the published multipliers', () => {
    setPriceOverrides({});
    const two = betTypes().find((b) => b.id === 'direct2')!;
    expect(two.multiplier).toBe(240);
    expect(two.ev).toBeCloseTo(0.5993, 3);
  });

  it('revalues the table when a kiosk pays 200x on 2-Sure', () => {
    // 10 cedis stake returning 2,000 is 200x, not the published 240x.
    setPriceOverrides({ direct2: 200 });
    const two = betTypes().find((b) => b.id === 'direct2')!;
    expect(two.multiplier).toBe(200);
    expect(two.ev).toBeCloseTo(200 / 400.5, 4);
    expect(two.ev).toBeCloseTo(0.4994, 3);
    // Still the least-bad ticket, but the margin over Direct 1 narrows.
    expect(betTypes()[0].id).toBe('direct2');
    expect(betTypes()[0].ev).toBeLessThan(0.6);
  });

  it('flows through coverage and the confidence ladder', () => {
    setPriceOverrides({ direct2: 200 });
    const cov = coverage({ betId: 'direct2', lines: 278, stakePerLine: 1 });
    expect(cov.expectedReturnValue).toBeCloseTo(278 * (200 / 400.5), 4);
    expect(cov.netPerPlay).toBeLessThan(-100);
  });

  it('ignores nonsense and falls back to published prices', () => {
    setPriceOverrides({ direct2: 0, direct3: Number.NaN, nonsense: 5 } as never);
    expect(betTypes().find((b) => b.id === 'direct2')!.multiplier).toBe(240);
    expect(betTypes().find((b) => b.id === 'direct3')!.multiplier).toBe(2100);
  });
});

describe('guarantee — the invoice for certainty', () => {
  afterEach(() => setPriceOverrides({}));

  it('prices a certain Direct 1 win exactly: 90 lines, −50', () => {
    const g = guarantee('direct1');
    expect(g.lines).toBe(90);
    expect(g.exact).toBe(true);
    expect(g.payout).toBe(40);
    expect(g.net).toBe(-50);
  });

  it('needs every combination of five, and loses 43.9 million', () => {
    const g = guarantee('direct5');
    expect(g.lines).toBe(43_949_268);
    expect(g.exact).toBe(true);
    expect(g.net).toBe(44_000 - 43_949_268);
  });

  it('gives only a floor for the middle tickets, never a flattering one', () => {
    const two = guarantee('direct2');
    expect(two.exact).toBe(false);
    expect(two.lines).toBe(401); // ceil(1 / (10/4005))
    expect(two.net).toBe(240 - 401);
  });

  it('never pays at any published price', () => {
    for (const id of ['direct1', 'direct2', 'direct3', 'direct4', 'direct5'] as const) {
      expect(guarantee(id).net).toBeLessThan(0);
    }
  });

  it('would pay only at a price above the fair odds — the one thing worth checking', () => {
    // Direct 1 is a 1-in-90 bet, so 90× is the fair price and 40× is the offer.
    setPriceOverrides({ direct1: 120 });
    expect(guarantee('direct1').net).toBe(30); // 120 × 1 win − 90 lines
    // Any real counter at that price is almost certainly misquoting the ticket.
    setPriceOverrides({ direct1: 40 });
    expect(guarantee('direct1').net).toBe(-50);
  });
});

describe('planForChance — buying a named chance', () => {
  afterEach(() => setPriceOverrides({}));

  it('gets to 75% on Direct 1 with exactly 68 distinct numbers', () => {
    const d1 = planForChance(0.75).find((p) => p.id === 'direct1')!;
    expect(d1.lines).toBe(68); // ceil(0.75 × 90)
    expect(d1.distinct).toBe(true);
    expect(d1.chance).toBeCloseTo(68 / 90, 10); // 75.56%, exact
    expect(d1.net).toBeLessThan(0);
  });

  it('reaches 100% at 90 lines, which is the whole drum', () => {
    const d1 = planForChance(0.99).find((p) => p.id === 'direct1')!;
    expect(d1.lines).toBe(90);
    expect(d1.chance).toBe(1);
  });

  it('prices the 75% five-number line and admits what it costs', () => {
    const d5 = planForChance(0.75).find((p) => p.id === 'direct5')!;
    expect(d5.lines).toBeGreaterThan(60_000_000);
    expect(d5.net).toBeLessThan(-60_000_000);
  });

  it('is monotone in confidence and never positive', () => {
    for (const id of ['direct1', 'direct2', 'direct3'] as const) {
      const lo = planForChance(0.5).find((p) => p.id === id)!;
      const hi = planForChance(0.9).find((p) => p.id === id)!;
      expect(hi.lines).toBeGreaterThan(lo.lines);
      expect(hi.net).toBeLessThan(lo.net);
      expect(lo.net).toBeLessThan(0);
    }
  });

  it('follows a price change, because the plan is the price', () => {
    setPriceOverrides({ direct2: 200 });
    const before = planForChance(0.75).find((p) => p.id === 'direct2')!;
    expect(before.expectedBack).toBeCloseTo(before.lines * (200 / 400.5), 6);
    expect(before.net).toBeLessThan(-200);
  });
});

describe('Double Chance — ten balls instead of five', () => {
  afterEach(() => setPriceOverrides({}));

  it('multiplies a pair by 4.5, not by 2', () => {
    const d2 = doubleChance('direct2')[0];
    expect(d2.chanceMultiple).toBeCloseTo(4.5, 6);
    expect(d2.coveredChance).toBeCloseTo(45 / 4005, 10);
  });

  it('multiplies a trio by 12 and a five-line by 252', () => {
    expect(doubleChance('direct3')[0].chanceMultiple).toBeCloseTo(12, 6);
    expect(doubleChance('direct5')[0].chanceMultiple).toBeCloseTo(252, 6);
  });

  it('leaves Direct 1 alone — it pays on the first ball', () => {
    const d1 = doubleChance('direct1')[0];
    expect(d1.chanceMultiple).toBe(1);
    expect(d1.note).toContain('first ball only');
  });

  it('flags a break-even cost so the player can check the screen', () => {
    const d2 = doubleChance('direct2')[0];
    // 240 × (45/4005) = 2.70 expected, against 0.5993 normally.
    expect(d2.evCovered).toBeCloseTo(2.6966, 3);
    expect(d2.breakEvenCostFactor).toBeCloseTo(4.5, 6);
    expect(d2.evCovered).toBeGreaterThan(1);
    expect(d2.note).toContain('reduce the payout');
  });
});
