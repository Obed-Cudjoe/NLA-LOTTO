import { describe, expect, it } from 'vitest';
import { describeGap, latencyToCsv, mergeSightings, summariseLatency } from '../src/resultLatency';

const draws = [
  { draw_date: '2026-11-24', game_name: 'Lucky Tuesday' },
  { draw_date: '2026-11-25', game_name: 'Midweek' },
];

describe('result latency — the one timing the app can measure alone', () => {
  it('stamps the gap from the 20:30 bell, and never rewrites a stamp', () => {
    const first = mergeSightings([], draws, '2026-11-25T20:44:00Z');
    expect(first).toHaveLength(2);
    const midweek = first.find((r) => r.game_name === 'Midweek')!;
    expect(midweek.minutesAfterClose).toBe(14);
    // A later poll must not move the first sighting.
    const second = mergeSightings(first, draws, '2026-11-26T09:00:00Z');
    expect(second).toHaveLength(2);
    expect(second.find((r) => r.game_name === 'Midweek')!.firstSeenAt).toBe('2026-11-25T20:44:00Z');
  });

  it('does not stamp the whole back catalogue on a first visit', () => {
    // A first-time browser sees 64 old draws at once; only the fresh one arrives.
    const archive = [
      { draw_date: '2026-09-10', game_name: 'National Weekly' },
      { draw_date: '2026-11-26', game_name: 'Fortune Thursday' },
    ];
    const rows = mergeSightings([], archive, '2026-11-27T02:10:00Z');
    expect(rows).toHaveLength(1);
    expect(rows[0].draw_date).toBe('2026-11-26');
  });

  it('never reports a negative gap for a next-day pull', () => {
    const rows = mergeSightings([], [{ draw_date: '2026-11-26', game_name: 'Fortune Thursday' }], '2026-11-26T09:00:00Z');
    expect(rows[0].minutesAfterClose).toBe(0);
  });

  it('summarises the median and flags genuinely late results', () => {
    const rows = mergeSightings(
      [],
      [
        { draw_date: '2026-11-20', game_name: 'Friday Bonanza' },
        { draw_date: '2026-11-21', game_name: 'National Weekly' },
      ],
      '2026-11-21T22:00:00Z'
    );
    const sum = summariseLatency(rows);
    expect(sum.records).toBe(2);
    expect(sum.late).toBe(1); // 20 Nov result seen a day late
    expect(sum.medianMinutes).not.toBeNull();
    expect(latencyToCsv(rows).split('\n')).toHaveLength(3);
  });

  it('words a gap without inventing precision', () => {
    expect(describeGap(0.4)).toBe('under a minute after the bell');
    expect(describeGap(14)).toBe('14 min after the bell');
    expect(describeGap(390)).toBe('6 h 30 min after the bell');
    expect(describeGap(120)).toBe('2 h after the bell');
  });

  it('stays empty and honest with nothing recorded', () => {
    const sum = summariseLatency([]);
    expect(sum.records).toBe(0);
    expect(sum.medianMinutes).toBeNull();
    expect(sum.fastest).toBeNull();
  });
});
