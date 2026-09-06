import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyViewFilters, nextViewFilters } from './viewFilters.ts';

const files = [
    { path: 'notes/a.md', kind: 'note' as const },
    { path: 'memos/b.md', kind: 'memo' as const },
    { path: 'links/c.md', kind: 'note' as const, linked: true },
    { path: 'notes/d.md', kind: 'note' as const, favorite: true },
];

test('空集合 = 全部', () => {
    assert.equal(applyViewFilters(files, []).length, 4);
});

test('单选只留该类', () => {
    assert.deepEqual(applyViewFilters(files, ['memos']).map((f) => f.path), ['memos/b.md']);
});

test('多选是并集同时展示', () => {
    const shown = applyViewFilters(files, ['notes', 'memos']).map((f) => f.path);
    assert.deepEqual(shown, ['notes/a.md', 'memos/b.md', 'links/c.md', 'notes/d.md']);
});

test('普通点击换成单选；Ctrl 点是加减', () => {
    assert.deepEqual([...nextViewFilters([], 'notes', false)], ['notes']);
    assert.deepEqual([...nextViewFilters(['notes'], 'memos', false)].sort(), ['memos']);
    assert.deepEqual([...nextViewFilters(['notes'], 'memos', true)].sort(), ['memos', 'notes']);
    assert.deepEqual([...nextViewFilters(['notes', 'memos'], 'notes', true)], ['memos']);
    assert.equal(nextViewFilters(['notes'], 'all', false).size, 0);
    assert.equal(nextViewFilters(['notes'], 'all', true).size, 0);
});
