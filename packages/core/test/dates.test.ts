import { describe, expect, test } from 'bun:test';
import { dateFromFilename, findDates } from '../src/parse/dates.ts';

describe('findDates', () => {
  test('recognizes common absolute formats', () => {
    const text =
      'ISO 2026-09-20, slash 2026/9/5, long September 20, 2026, short Sep 3rd 2026, dmy 15 Oct 2026, us 10/15/2026, dmy-num 25/12/2026';
    const found = findDates(text).map((d) => d.iso);
    expect(found).toEqual([
      '2026-09-20',
      '2026-09-05',
      '2026-09-20',
      '2026-09-03',
      '2026-10-15',
      '2026-10-15',
      '2026-12-25',
    ]);
  });

  test('month and quarter precision', () => {
    const found = findDates('Planned for November 2026, then Q1 2027 and 2027Q3, also Q4 FY26.');
    expect(found.map((d) => [d.iso, d.precision])).toEqual([
      ['2026-11-01', 'month'],
      ['2027-01-01', 'quarter'],
      ['2027-07-01', 'quarter'],
      ['2026-10-01', 'quarter'],
    ]);
  });

  test('longest match wins on overlap and invalid dates are skipped', () => {
    const found = findDates('September 31, 2026 and September 30, 2026 (2026-09-30)');
    expect(found.map((d) => d.iso)).toEqual(['2026-09-30', '2026-09-30']);
    expect(findDates('2026-09-30 and 30, 2026').map((d) => d.text)).toEqual(['2026-09-30']);
  });

  test('positions are correct', () => {
    const text = 'Meeting on 2026-09-20 at noon';
    const [d] = findDates(text);
    expect(text.slice(d?.start, d?.end)).toBe('2026-09-20');
  });
});

describe('dateFromFilename', () => {
  test('dashed, underscored and compact', () => {
    expect(dateFromFilename('sprint-2026-09-20.md')).toBe('2026-09-20');
    expect(dateFromFilename('notes_2026_09_21.md')).toBe('2026-09-21');
    expect(dateFromFilename('20260922-standup.md')).toBe('2026-09-22');
    expect(dateFromFilename('roadmap-v2.md')).toBeNull();
    expect(dateFromFilename('PROJ-20261399.md')).toBeNull();
  });
});
