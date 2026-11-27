import { describe, expect, it } from 'vitest';
import { TIMING_IS_NOT_IN_THE_NUMBERS, chiSquareTail, decadeOf, firstBallTest, positionProfile } from '../src/drumOrder';

const draw = (winning: number[]) => ({ winning });

describe('drum order — what the record can and cannot answer', () => {
  it('computes the chi-square tail against known values', () => {
    expect(chiSquareTail(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquareTail(15.507, 8)).toBeCloseTo(0.05, 3);
    expect(chiSquareTail(2, 2)).toBeCloseTo(0.3679, 3);
    expect(chiSquareTail(30, 8)).toBeLessThan(0.001);
    expect(chiSquareTail(0, 8)).toBe(1);
  });

  it('buckets the drum into nine equal decades', () => {
    expect(decadeOf(1)).toBe(0);
    expect(decadeOf(10)).toBe(0);
    expect(decadeOf(11)).toBe(1);
    expect(decadeOf(90)).toBe(8);
  });

  it('finds no signal in a first ball spread evenly over the buckets', () => {
    // Nine first balls, one per decade, repeated — the fair-drum picture.
    const draws = Array.from({ length: 72 }, (_, i) => draw([i * 10 % 90 + 1, 2, 3, 4, 5]));
    const test = firstBallTest(draws);
    expect(test.draws).toBe(72);
    expect(test.p).toBeGreaterThan(0.05);
    expect(test.verdict).toContain('fair drum');
  });

  it('does flag a first ball stuck in one decade', () => {
    const draws = Array.from({ length: 60 }, () => draw([3, 40, 52, 61, 88]));
    const test = firstBallTest(draws);
    expect(test.p).toBeLessThan(0.001);
    expect(test.verdict).toContain('not spread evenly');
    expect(test.topBucketShare).toBe(1);
  });

  it('stays empty and honest without draws', () => {
    const test = firstBallTest([]);
    expect(test.draws).toBe(0);
    expect(test.p).toBe(1);
    expect(positionProfile([])[0].meanNumber).toBeNaN();
  });

  it('says plainly that a result holds no duration', () => {
    expect(TIMING_IS_NOT_IN_THE_NUMBERS).toContain('never when or for how long');
    expect(TIMING_IS_NOT_IN_THE_NUMBERS).toContain('cannot be recovered');
  });
});
