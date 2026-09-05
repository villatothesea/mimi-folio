import assert from 'node:assert/strict';
import { test } from 'node:test';

import { monthCells, WEEKDAYS } from './memoCalendar.ts';

test('九月网格周一开头，计数挂在日期上', () => {
    const counts = new Map([['2026-09-20', 3], ['2026-09-05', 1]]);
    const cells = monthCells(2026, 8, counts);
    assert.equal(WEEKDAYS.length, 7);
    assert.equal(cells.length % 7, 0);
    assert.equal(cells[0]?.iso, '2026-08-31');
    assert.equal(cells[0]?.inMonth, false);
    const day1 = cells.find((c) => c.iso === '2026-09-01');
    assert.equal(day1?.inMonth, true);
    assert.equal(day1?.date, 1);
    assert.equal(cells.find((c) => c.iso === '2026-09-20')?.count, 3);
    assert.equal(cells.find((c) => c.iso === '2026-09-05')?.count, 1);
    const last = cells.find((c) => c.iso === '2026-09-30');
    assert.equal(last?.inMonth, true);
});
