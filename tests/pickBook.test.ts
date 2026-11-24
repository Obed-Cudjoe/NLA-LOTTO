import { describe, expect, it } from 'vitest';
import {
  PAIR_CHANCE,
  isDrawPast,
  emptyReport,
  lockPick,
  pickBookToCsv,
  pickFromDeduction,
  scorePickBook,
  type PickRecord,
} from '../src/pickBook';
import { DEFAULT_CONFIG, deduce } from '../src/mathEngine';
import seed from '../data/draws.json';

const draws = seed as any[];
const line = (over: Partial<PickRecord> = {}): PickRecord => ({
  draw_date: '2026-11-24',
  game: 'Lucky Tuesday',
  five: [1, 34, 76, 37, 78],
  pair: [1, 34],
  trio: [1, 34, 76],
  locked_at: '2026-11-24T12:00:00.000Z',
  ...over,
});

describe('pick book', () => {
  it('takes the line from the deduction it is showing', () => {
    const d = deduce(draws, DEFAULT_CONFIG, 'Lucky Tuesday');
    const pick = pickFromDeduction(d, '2026-11-24T09:00:00.000Z');
    expect(pick.five).toHaveLength(5);
    expect(pick.pair).toEqual(pick.five.slice(0, 2));
    expect(pick.trio).toHaveLength(3);
    expect(pick.draw_date).toBe(d.next.date);
    expect(pick.game).toBe(d.next.game);
    expect(pick.locked_at).toBe('2026-11-24T09:00:00.000Z');
  });

  it('replaces a re-locked line instead of duplicating it', () => {
    const book = lockPick([], line());
    const relocked = lockPick(book, line({ five: [5, 6, 7, 8, 9], pair: [5, 6] }));
    expect(relocked).toHaveLength(1);
    expect(relocked[0].five).toEqual([5, 6, 7, 8, 9]);
  });

  it('scores a hit only when the numbers actually came out', () => {
    // A draw where both pair numbers and all five appear.
    const win = {
      draw_date: '2026-11-24',
      game_name: 'Lucky Tuesday',
      winning: [1, 34, 76, 37, 78],
      machine: [2, 3, 4, 5, 6],
    };
    const { rows, report } = scorePickBook([line()], [win as any]);
    expect(rows[0].matches).toHaveLength(5);
    expect(rows[0].pair_hit).toBe(true);
    expect(rows[0].trio_hit).toBe(true);
    expect(report.resolved).toBe(1);
    expect(report.fiveHits).toBe(1);
    expect(report.verdict).toContain('too few to say anything');
  });

  it('does not score a line whose draw has not happened', () => {
    const { rows, report } = scorePickBook([line({ draw_date: '2099-01-01' })], draws);
    expect(rows[0].drawn).toBeNull();
    expect(rows[0].five_hit).toBe(false);
    expect(report.resolved).toBe(0);
    expect(report.verdict).toContain('waiting for the draw');
  });

  it('ignores a draw whose game name disagrees with the pick', () => {
    const wrongGame = {
      draw_date: '2026-11-24',
      game_name: 'Monday Special',
      winning: [1, 34, 76, 37, 78],
      machine: [2, 3, 4, 5, 6],
    };
    const { report } = scorePickBook([line()], [wrongGame as any]);
    expect(report.resolved).toBe(0);
  });

  it('counts a miss as a miss', () => {
    const miss = {
      draw_date: '2026-11-24',
      game_name: 'Lucky Tuesday',
      winning: [2, 3, 4, 5, 6],
      machine: [7, 8, 9, 10, 11],
    };
    const { rows, report } = scorePickBook([line()], [miss as any]);
    expect(rows[0].matches).toHaveLength(0);
    expect(rows[0].pair_hit).toBe(false);
    expect(report.matches).toBe(0);
    expect(report.expectedMatches).toBeCloseTo(0.2778, 4);
  });

  it('refuses to treat a past draw as lockable', () => {
    // 24 Nov 2026, 20:29 GMT — still before the close.
    expect(isDrawPast('2026-11-24', Date.parse('2026-11-24T20:29:00Z'))).toBe(false);
    // 20:30 GMT — the draw is over.
    expect(isDrawPast('2026-11-24', Date.parse('2026-11-24T20:30:00Z'))).toBe(true);
    // Next day is definitely past.
    expect(isDrawPast('2026-11-24', Date.parse('2026-11-25T09:00:00Z'))).toBe(true);
    // A future draw is not.
    expect(isDrawPast('2026-11-25', Date.parse('2026-11-24T22:00:00Z'))).toBe(false);
    // Garbage dates never block a lock.
    expect(isDrawPast('not-a-date')).toBe(false);
  });

  it('states the expected rates the record is measured against', () => {
    expect(PAIR_CHANCE).toBeCloseTo(1 / 400.5, 6);
    expect(emptyReport().verdict).toContain('No line has been locked yet');
  });

  it('exports the book as CSV with the scoring columns', () => {
    const win = {
      draw_date: '2026-11-24',
      game_name: 'Lucky Tuesday',
      winning: [1, 34, 76, 37, 78],
      machine: [2, 3, 4, 5, 6],
    };
    const { rows } = scorePickBook([line()], [win as any]);
    const csv = pickBookToCsv(rows);
    expect(csv.split('\n')[0]).toContain('five_hit');
    expect(csv).toContain('2026-11-24');
    expect(csv).toContain('yes');
  });
});
