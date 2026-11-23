import { describe, expect, it } from 'vitest';
import {
  extractDate,
  extractNumbers,
  findGame,
  parsePayload,
  validateCandidates,
} from '../src/scraper';

const NLA_STYLE_HTML = `
<html><body>
  <h2>Ghana Lotto Evening Results</h2>
  <h3>Monday Special</h3>
  <div class="result">
    <span class="date">2026-11-16</span>
    <div class="numbers"><b>45</b><b>1</b><b>54</b><b>82</b><b>34</b></div>
    <div class="machine"><span>Machine:</span> 37 51 71 87 61</div>
  </div>
  <h3>Lucky Tuesday</h3>
  <div class="result">
    <span class="date">17/11/2026</span>
    <div class="numbers"><b>71</b><b>29</b><b>83</b><b>63</b><b>58</b></div>
    <div class="machine"><span>Machine:</span> 57 70 86 33 61</div>
  </div>
</body></html>`;

const TABLE_HTML = `
<table>
  <tr><th>Date</th><th>Game</th><th>Winning</th><th>Machine</th></tr>
  <tr>
    <td>2026-11-18</td><td>Midweek</td>
    <td>15 82 51 85 34</td>
    <td>45 35 83 90 40</td>
  </tr>
  <tr>
    <td>2026-11-19</td><td>Fortune Thursday</td>
    <td>69 90 2 26 75</td>
    <td>35 83 44 87 27</td>
  </tr>
</table>`;

describe('extractDate', () => {
  it('understands ISO, day-first numeric and month-name dates', () => {
    expect(extractDate('Draw on 2026-11-21 at 19:50')).toBe('2026-11-21');
    expect(extractDate('Result 21/11/2026')).toBe('2026-11-21');
    expect(extractDate('Saturday 21 November 2026')).toBe('2026-11-21');
    expect(extractDate('Sat, Nov 21, 2026')).toBe('2026-11-21');
    expect(extractDate('no date here')).toBeNull();
  });

  it('infers the year for partial dates', () => {
    expect(extractDate('Sat 21 Nov', '2026-11-23')).toBe('2026-11-21');
  });
});

describe('extractNumbers', () => {
  it('pulls 1..90 integers and ignores years', () => {
    expect(extractNumbers('2026-11-21 45 1 54 82 34 37 51 71 87 61')).toEqual([
      45, 1, 54, 82, 34, 37, 51, 71, 87, 61,
    ]);
  });

  it('caps at the requested count', () => {
    expect(extractNumbers('1 2 3 4 5 6 7 8 9 10 11 12', 5)).toHaveLength(5);
  });
});

describe('findGame', () => {
  it('matches game names case-insensitively and normalises variants', () => {
    expect(findGame('MONDAY SPECIAL result')).toBe('Monday Special');
    expect(findGame('Mid - Week draw')).toBe('Midweek');
    expect(findGame('National Week Lotto')).toBe('National Weekly');
    expect(findGame('nothing here', 'Fortune Thursday')).toBe('Fortune Thursday');
    expect(findGame('nothing here')).toBeNull();
  });
});

describe('parsePayload — HTML', () => {
  it('parses heading-delimited result blocks', () => {
    const result = parsePayload(NLA_STYLE_HTML, 'text/html');
    expect(result.draws.length).toBeGreaterThanOrEqual(2);
    const monday = result.draws.find((d) => d.draw_date === '2026-11-16');
    expect(monday).toBeDefined();
    expect(monday!.winning).toEqual([45, 1, 54, 82, 34]);
    expect(monday!.machine).toEqual([37, 51, 71, 87, 61]);
    expect(monday!.game_name).toBe('Monday Special');
  });

  it('parses table rows', () => {
    const result = parsePayload(TABLE_HTML, 'text/html');
    const midweek = result.draws.find((d) => d.draw_date === '2026-11-18');
    expect(midweek).toBeDefined();
    expect(midweek!.winning).toEqual([15, 82, 51, 85, 34]);
    expect(midweek!.machine).toEqual([45, 35, 83, 90, 40]);
  });

  it('returns a helpful error for an unrecognisable page', () => {
    const result = parsePayload('<html><body><p>Nothing to see</p></body></html>', 'text/html');
    expect(result.draws).toHaveLength(0);
    expect(result.errors[0]).toMatch(/No draw rows recognised/i);
  });
});

describe('parsePayload — JSON', () => {
  it('parses an array of records with array fields', () => {
    const payload = JSON.stringify([
      { date: '2026-11-20', game: 'Friday Bonanza', winning: [42, 45, 88, 79, 89], machine: [80, 57, 69, 84, 36] },
    ]);
    const result = parsePayload(payload, 'application/json');
    expect(result.draws).toHaveLength(1);
    expect(result.draws[0].game_name).toBe('Friday Bonanza');
  });

  it('parses flat num1..mac5 rows and string numbers', () => {
    const payload = JSON.stringify({
      results: [
        {
          draw_date: '2026-11-21',
          game_name: 'National Weekly',
          num1: 23, num2: 38, num3: 80, num4: 50, num5: 82,
          mac1: 12, mac2: 4, mac3: 66, mac4: 7, mac5: 19,
        },
        {
          date: '2026-11-24',
          game: 'National Weekly',
          winning: '3,14,15,92,97'.replace('92', '92').replace('97', '97'), // 92/97 out of range on purpose
          machine: '1,2,3,4,5',
        },
      ],
    });
    const result = parsePayload(payload, 'application/json');
    expect(result.draws.some((d) => d.draw_date === '2026-11-21')).toBe(true);
    // The deliberately invalid row must be rejected, not silently stored.
    expect(result.draws.some((d) => d.draw_date === '2026-11-24')).toBe(false);
  });

  it('accepts a single ten-number array as one draw', () => {
    const result = validateCandidates(
      [{ draw_date: '2026-11-02', game_name: 'Midweek', winning: [1, 2, 3, 4, 5], machine: [6, 7, 8, 9, 10] }],
      {}
    );
    expect(result.draws).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });
});

describe('weekday schedule guard', () => {
  const monday = { winning: [1, 2, 3, 4, 5], machine: [6, 7, 8, 9, 10] };

  it('skips Sundays, where no 5/90 evening game is drawn', () => {
    const result = validateCandidates(
      [{ draw_date: '2026-11-22', game_name: 'Monday Special', ...monday }],
      {}
    );
    expect(result.draws).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/Sunday/i);
  });

  it('relabels a mislabelled weekday row from the calendar', () => {
    const result = validateCandidates(
      [{ draw_date: '2026-11-20', game_name: 'Monday Special', ...monday }],
      {}
    );
    expect(result.draws).toHaveLength(1);
    expect(result.draws[0].game_name).toBe('Friday Bonanza');
    expect(result.warnings.join(' ')).toMatch(/weekday schedule/i);
  });

  it('keeps the source label when respectSchedule is disabled', () => {
    const result = validateCandidates(
      [{ draw_date: '2026-11-20', game_name: 'Monday Special', ...monday }],
      { respectSchedule: false }
    );
    expect(result.draws[0].game_name).toBe('Monday Special');
    expect(result.warnings).toHaveLength(0);
  });

  it('applies the schedule through parsePayload too', () => {
    const html = `<h3>Monday Special</h3>
      <div><span>2026-11-19</span><div>4 19 33 58 71</div><div>Machine: 8 26 45 62 88</div></div>`;
    const result = parsePayload(html, 'text/html');
    expect(result.draws).toHaveLength(1);
    expect(result.draws[0].game_name).toBe('Fortune Thursday');
  });
});

describe('validation guardrails', () => {
  it('skips rows without machine numbers instead of storing half a draw', () => {
    const result = validateCandidates(
      [{ draw_date: '2026-11-02', game_name: 'Midweek', winning: [1, 2, 3, 4, 5], machine: [] }],
      {}
    );
    expect(result.draws).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/machine numbers/);
  });

  it('rejects overlaps between winning and machine numbers', () => {
    const result = validateCandidates(
      [{ draw_date: '2026-11-02', game_name: 'Midweek', winning: [1, 2, 3, 4, 5], machine: [5, 6, 7, 8, 9] }],
      {}
    );
    expect(result.draws).toHaveLength(0);
    expect(result.errors[0]).toMatch(/distinct/);
  });

  it('collapses identical rows found by two strategies without warning', () => {
    // Monday Special on a Monday, so the schedule guard has nothing to say —
    // this test is only about duplicate suppression.
    const candidate = {
      draw_date: '2026-11-02',
      game_name: 'Monday Special',
      winning: [1, 2, 3, 4, 5],
      machine: [6, 7, 8, 9, 10],
    };
    const result = validateCandidates([candidate, { ...candidate }], {});
    expect(result.draws).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('warns when two rows disagree for the same date', () => {
    const result = validateCandidates(
      [
        { draw_date: '2026-11-02', game_name: 'Midweek', winning: [1, 2, 3, 4, 5], machine: [6, 7, 8, 9, 10] },
        { draw_date: '2026-11-02', game_name: 'Midweek', winning: [11, 12, 13, 14, 15], machine: [16, 17, 18, 19, 20] },
      ],
      {}
    );
    expect(result.draws).toHaveLength(1);
    expect(result.warnings.join(' ')).toMatch(/conflicting rows/i);
  });
});
