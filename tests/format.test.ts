import { describe, expect, it } from 'vitest';
import { daysBetween, drawWhen, stalenessNote, targetHeading } from '../src/client/format';

const target = { date: '2026-11-23', game: 'Monday Special' };

describe('target wording', () => {
  it('says "tonight" when the next undrawn game is today', () => {
    expect(targetHeading(target, '2026-11-23')).toBe("Tonight's draw — Monday Special");
    expect(drawWhen(target.date, '2026-11-23')).toBe('tonight');
  });

  it('says "next" when tonight\'s game is already in the history', () => {
    const tuesday = { date: '2026-11-24', game: 'Lucky Tuesday' };
    expect(targetHeading(tuesday, '2026-11-23')).toBe('Next draw — Lucky Tuesday');
    expect(drawWhen(tuesday.date, '2026-11-23')).toBe('tomorrow');
  });

  it('counts further ahead in days', () => {
    expect(drawWhen('2026-11-27', '2026-11-23')).toBe('in 4 days');
    expect(daysBetween('2026-11-23', '2026-11-27')).toBe(4);
  });

  it('flags history that has stopped short of today', () => {
    expect(stalenessNote(target, '2026-11-23')).toBe('');
    expect(stalenessNote(target, '2026-11-26')).toContain('3 days before today');
    expect(drawWhen(target.date, '2026-11-26')).toBe('3 days ago');
  });
});
