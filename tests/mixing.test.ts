import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIXING,
  bestDirect1Ev,
  breakEvenShakeSeconds,
  collisionsDuringWalk,
  collisionsToMix,
  drawsToDetect,
  effectiveMixSeconds,
  firstBallProbability,
  mixQuality,
  mixingVerdict,
  positionalBiasPerRelease,
  qualityPerRelease,
} from '../src/mixing';

describe('drum mixing model', () => {
  it('mixes more with more time, bounded by 0 and 1', () => {
    expect(mixQuality(0, 0.7)).toBe(0);
    const a = mixQuality(1, 0.7);
    const b = mixQuality(5, 0.7);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThanOrEqual(1);
    expect(mixQuality(5, 0)).toBe(1);
  });

  it('gives no exploitable signal without a known loading order', () => {
    const p = firstBallProbability({ shakeSeconds: 0.1, loadingKnown: false });
    expect(p.favoured).toBeCloseTo(1 / 90, 12);
    expect(p.ordinary).toBeCloseTo(1 / 90, 12);
    expect(bestDirect1Ev({ shakeSeconds: 0.1, loadingKnown: false })).toBeCloseTo(40 / 90, 12);
    expect(mixingVerdict({ loadingKnown: false })).toMatch(/1 in 90/i);
  });

  it('quantifies an under-mixed drum honestly', () => {
    // Very short shake: the favoured ball is still likely to be in the exit slot.
    // No walk at all: isolate the shake so the test measures mixing, not the clock.
    const short = firstBallProbability({ shakeSeconds: 1, walkSeconds: 0, tau: 0.7, loadingKnown: true });
    expect(short.favoured).toBeGreaterThan(0.2);
    expect(bestDirect1Ev({ shakeSeconds: 1, walkSeconds: 0, tau: 0.7, loadingKnown: true })).toBeGreaterThan(1);

    // Plausible procedure: the bias is negligible and the bet still loses.
    const real = firstBallProbability(DEFAULT_MIXING);
    expect(real.favoured).toBeLessThan(0.0125);
    expect(bestDirect1Ev(DEFAULT_MIXING)).toBeLessThan(0.5);
    expect(mixingVerdict(DEFAULT_MIXING)).toMatch(/return only|only/i);
  });

  it('puts the break-even shake time where the maths says', () => {
    const t = breakEvenShakeSeconds(0.7, 40);
    // q needed = (1 - 1/40) / (1 - 1/90) = 0.98595 -> t = -tau * ln(0.01405)
    expect(t).toBeGreaterThan(2.8);
    expect(t).toBeLessThan(3.2);
    expect(bestDirect1Ev({ shakeSeconds: t, walkSeconds: 0, tau: 0.7, loadingKnown: true })).toBeCloseTo(1, 2);
  });

  it('decays any positional bias across the five releases', () => {
    const q = qualityPerRelease({ shakeSeconds: 1, walkSeconds: 0, interReleaseSeconds: 8 });
    expect(q).toHaveLength(5);
    for (let i = 1; i < q.length; i++) expect(q[i]).toBeGreaterThan(q[i - 1]);
    const bias = positionalBiasPerRelease({ shakeSeconds: 1, walkSeconds: 0, interReleaseSeconds: 0.5 });
    expect(bias[0]).toBeGreaterThan(bias[4]);
    expect(bias[4]).toBeGreaterThan(0);
    // With a realistic pause between releases the drum is fully mixed by ball 5.
    const realistic = positionalBiasPerRelease({ shakeSeconds: 5, walkSeconds: 0, interReleaseSeconds: 8 });
    expect(realistic[4]).toBeGreaterThanOrEqual(0);
    expect(realistic[4]).toBeLessThan(1e-9);
  });

  it('says how much data a bias would need', () => {
    expect(drawsToDetect(1 / 90)).toBe(Number.POSITIVE_INFINITY);
    const big = drawsToDetect(2 / 90);
    const small = drawsToDetect(1.1 / 90);
    expect(big).toBeLessThan(small);
    expect(big).toBeGreaterThan(100);
  });
});

describe('the guest walking to the button', () => {
  it('counts the walk as extra mixing only while the drum runs', () => {
    expect(effectiveMixSeconds({ shakeSeconds: 5, walkSeconds: 12, drumRunsDuringWalk: true })).toBe(17);
    expect(effectiveMixSeconds({ shakeSeconds: 5, walkSeconds: 12, drumRunsDuringWalk: false })).toBe(5);
    expect(collisionsDuringWalk({ walkSeconds: 12, collisionsPerSecond: 10, drumRunsDuringWalk: true })).toBe(120);
    expect(collisionsDuringWalk({ walkSeconds: 12, drumRunsDuringWalk: false })).toBe(0);
    expect(collisionsToMix({ tau: 0.7, collisionsPerSecond: 10 })).toBeCloseTo(7, 6);
  });

  it('makes the drum more uniform, never more readable', () => {
    const noWalk = bestDirect1Ev({ shakeSeconds: 5, walkSeconds: 0, loadingKnown: true });
    const shortWalk = bestDirect1Ev({ shakeSeconds: 5, walkSeconds: 3, loadingKnown: true });
    const longWalk = bestDirect1Ev({ shakeSeconds: 5, walkSeconds: 40, loadingKnown: true });
    expect(shortWalk).toBeLessThan(noWalk);
    expect(longWalk).toBeLessThan(shortWalk);
    // Fully mixed, the favoured ball is worth exactly the uniform 40/90.
    expect(longWalk).toBeCloseTo(40 / 90, 6);
  });

  it('changes nothing at all when the drum is stopped during the walk', () => {
    const stopped = bestDirect1Ev({ shakeSeconds: 5, walkSeconds: 45, drumRunsDuringWalk: false, loadingKnown: true });
    const same = bestDirect1Ev({ shakeSeconds: 5, walkSeconds: 0, drumRunsDuringWalk: false, loadingKnown: true });
    expect(stopped).toBeCloseTo(same, 12);
  });

  it('explains the walk in the verdict', () => {
    expect(mixingVerdict({ shakeSeconds: 1, walkSeconds: 3, loadingKnown: true })).toMatch(/walk/i);
  });
});
