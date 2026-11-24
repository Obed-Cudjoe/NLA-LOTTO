import { describe, expect, it } from 'vitest';
import {
  analyseTimingJournal,
  journalToCsv,
  parseJournalCsv,
  type TimingEntry,
} from '../src/timingJournal';

const rand = (() => {
  let s = 987654321;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
})();

function entry(i: number, walkSeconds: number, firstBall: number): TimingEntry {
  return {
    draw_date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    walkSeconds,
    shakeSeconds: 5,
    firstBall,
  };
}

describe('timing journal', () => {
  it('refuses to test a handful of entries', () => {
    const r = analyseTimingJournal([entry(1, 12, 40)]);
    expect(r.entries).toBe(1);
    expect(r.verdict).toMatch(/at least 8/i);
  });

  it('finds nothing when walk time is independent of the ball', () => {
    const entries = Array.from({ length: 200 }, (_, i) =>
      entry(i, 5 + (i % 11), 1 + Math.floor(rand() * 90))
    );
    const r = analyseTimingJournal(entries, { simulations: 400 });
    expect(r.entries).toBe(200);
    expect(r.pValue).toBeGreaterThan(0.05);
    expect(r.cramersV).toBeLessThan(0.35);
    expect(r.verdict).toMatch(/no detectable link/i);
  });

  it('detects a planted dependence', () => {
    // Walk time decides the decile: a mechanical link that cannot exist, but
    // the test must be able to see it if it did.
    const entries = Array.from({ length: 240 }, (_, i) => {
      const walk = 4 + (i % 3) * 10; // three clean terciles
      const decile = Math.floor(walk / 10) % 9;
      const firstBall = decile * 10 + 1 + Math.floor(rand() * 10);
      return entry(i, walk, firstBall);
    });
    const r = analyseTimingJournal(entries, { simulations: 400 });
    expect(r.pValue).toBeLessThan(0.05);
    expect(r.verdict).toMatch(/dependence shows up/i);
  });

  it('says plainly when the sample is too small to conclude', () => {
    const entries = Array.from({ length: 30 }, (_, i) => entry(i, 6 + (i % 9), 1 + i * 3));
    const r = analyseTimingJournal(entries, { simulations: 300 });
    expect(r.verdict).toMatch(/inconclusive/i);
    expect(r.guidance).toMatch(/300/);
    expect(r.byTercile).toHaveLength(3);
  });

  it('is deterministic and reports effect size', () => {
    const entries = Array.from({ length: 120 }, (_, i) =>
      entry(i, 5 + (i % 12), 1 + ((i * 17) % 90))
    );
    const a = analyseTimingJournal(entries, { simulations: 300, seed: 7 });
    const b = analyseTimingJournal(entries, { simulations: 300, seed: 7 });
    expect(a.pValue).toBe(b.pValue);
    expect(a.cramersV).toBeCloseTo(b.cramersV, 12);
    expect(a.chiSquare).toBeCloseTo(b.chiSquare, 12);
    expect(a.df).toBe(16);
  });

  it('round-trips through CSV and rejects bad rows', () => {
    const entries = [entry(1, 11.5, 42), entry(2, 7, 3)];
    const csv = journalToCsv(entries);
    const back = parseJournalCsv(csv);
    expect(back.errors).toHaveLength(0);
    expect(back.entries).toHaveLength(2);
    expect(back.entries[0].firstBall).toBe(42);
    expect(back.entries[0].walkSeconds).toBeCloseTo(11.5, 6);

    const bad = parseJournalCsv('2026-01-01,Monday,abc,5,40\nnonsense,row\n2026-01-02,Monday,9,5,140');
    expect(bad.entries).toHaveLength(0);
    expect(bad.errors.length).toBe(3);
  });
});
