import { describe, expect, it } from 'vitest';
import { NO_INVERSE, drawsForPower, powerToDetect, whatTheArchiveCanSee } from '../src/identifiability';

describe('identifiability — why the timing cannot be inverted', () => {
  it('is calibrated at the null: no tilt gives alpha, not power', () => {
    const power = powerToDetect(0, 64, 300);
    expect(power).toBeGreaterThan(0.01);
    expect(power).toBeLessThan(0.1); // ~5%, as alpha says
  });

  it('gains power with more draws and a bigger tilt', () => {
    const small = powerToDetect(0.4, 64, 200);
    const large = powerToDetect(0.4, 512, 200);
    expect(large).toBeGreaterThan(small);
    expect(powerToDetect(0.2, 512, 200)).toBeLessThan(powerToDetect(0.4, 512, 200));
  });

  it('reports the honest size of the archive it would need', () => {
    const need40 = drawsForPower(0.4);
    const need20 = drawsForPower(0.2);
    expect(need40).toBeGreaterThan(400);
    expect(need20).toBeGreaterThan(need40);
    // Years, not weeks: six draws a week.
    expect(need40 / 6).toBeGreaterThan(100);
  });

  it('refuses the inverse in words a reader can hold', () => {
    expect(NO_INVERSE).toContain('never recorded');
    expect(NO_INVERSE).toContain('zero bits');
    expect(whatTheArchiveCanSee(64)).toContain('80% power');
  });
});
