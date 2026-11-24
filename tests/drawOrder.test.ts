import { describe, expect, it } from 'vitest';
import { analyseDrawOrder, chiSquareUniform, detectableLift, firstBallHistogram } from '../src/drawOrder';
import type { Draw } from '../src/mathEngine';

const GAMES = ['Monday Special', 'Lucky Tuesday', 'Midweek', 'Fortune Thursday', 'Friday Bonanza', 'National Weekly'];

/** n draws whose first ball follows a supplied pattern. */
function makeDraws(n: number, first: (i: number) => number): Draw[] {
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  return Array.from({ length: n }, (_, i) => {
    const first_ = first(i);
    const rest = new Set<number>([first_]);
    while (rest.size < 5) rest.add(1 + Math.floor(rand() * 90));
    const nums = [...rest];
    return {
      draw_date: new Date(Date.UTC(2026, 0, 5 + Math.floor(i / 6) * 7 + (i % 6))).toISOString().slice(0, 10),
      game_name: GAMES[i % 6],
      winning: nums,
      machine: [11, 22, 33, 44, 55],
    };
  });
}

describe('first-ball analysis', () => {
  it('returns an empty report without draws', () => {
    const r = analyseDrawOrder([]);
    expect(r.draws).toBe(0);
    expect(r.verdict).toMatch(/no draws/i);
  });

  it('cannot call a fair drum biased', () => {
    // First ball cycles through 1..90 evenly: the least skewed archive possible.
    const fair = makeDraws(90, (i) => 1 + (i % 90));
    const r = analyseDrawOrder(fair, { simulations: 500 });
    expect(r.draws).toBe(90);
    expect(r.pValue).toBeGreaterThan(0.05);
    expect(r.verdict).toMatch(/consistent with a fair drum/i);
    expect(r.hottest[0].count).toBe(1);
    expect(r.detectableLift).toBeGreaterThan(1);
  });

  it('flags an archive where one ball is always drawn first', () => {
    const rigged = makeDraws(60, () => 7);
    const r = analyseDrawOrder(rigged, { simulations: 500 });
    expect(r.counts[6].count).toBe(60);
    expect(r.counts[6].lift).toBeCloseTo(90, 6);
    expect(r.chiSquare).toBeGreaterThan(100);
    expect(r.pValue).toBeLessThan(0.05);
    expect(r.verdict).toMatch(/unusual skew/i);
  });

  it('is deterministic for a fixed seed', () => {
    const draws = makeDraws(40, (i) => 1 + (i % 90));
    const a = analyseDrawOrder(draws, { simulations: 300, seed: 99 });
    const b = analyseDrawOrder(draws, { simulations: 300, seed: 99 });
    expect(a.pValue).toBe(b.pValue);
    expect(a.chiSquare).toBe(b.chiSquare);
  });

  it('reports the detection floor honestly', () => {
    // 60 draws can only see a first ball appearing ~6x more often than chance;
    // a 2x lift needs ~880 draws, which is why the play test needs years of data.
    expect(detectableLift(60)).toBeGreaterThan(4);
    expect(detectableLift(880)).toBeCloseTo(2, 0);
    expect(detectableLift(10_000)).toBeLessThan(detectableLift(60));
    expect(chiSquareUniform(new Array(90).fill(2), 180)).toBeCloseTo(0, 12);
  });

  it('produces a sparse histogram', () => {
    const r = analyseDrawOrder(makeDraws(30, (i) => 1 + i));
    const hist = firstBallHistogram(r);
    expect(hist).toHaveLength(30);
    expect(hist.reduce((s, h) => s + h.count, 0)).toBe(30);
  });
});
