import { describe, expect, it } from 'vitest';
import {
  analyseTimingJournal,
  journalToCsv,
  parseJournalCsv,
  requiredEntries,
  detectableV,
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

describe('requiredEntries — how much timing a question needs', () => {
  it('demands more evenings for weaker associations', () => {
    expect(requiredEntries(0.25)).toBeLessThan(requiredEntries(0.15));
    expect(requiredEntries(0.15)).toBeLessThan(requiredEntries(0.10));
  });

  it('puts a strong link inside a season of draws, a weak one outside it', () => {
    // 177 evenings is about six months of nightly draws.
    expect(requiredEntries(0.25)).toBeGreaterThan(140);
    expect(requiredEntries(0.25)).toBeLessThan(220);
    // A 0.10 association is a multi-year project, which is the honest answer.
    expect(requiredEntries(0.10)).toBeGreaterThan(900);
  });

  it('never promises a verdict from a handful of entries', () => {
    expect(requiredEntries(0)).toBe(Number.POSITIVE_INFINITY);
    expect(detectableV(20)).toBeGreaterThan(0.5);
    expect(detectableV(200)).toBeLessThan(0.25);
  });

  it('reports the ladder on every journal result', () => {
    const report = analyseTimingJournal([]);
    expect(report.detectableV).toBe(1);
    expect(report.power.map((p) => p.v)).toEqual([0.1, 0.15, 0.25]);
  });
});
