import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_SPECIAL, mergeSpecial, paletteVar, specialCssVars } from './specialFmt.ts';

test('缺省与乱数据回落到出厂色板', () => {
    assert.deepEqual(mergeSpecial(null), DEFAULT_SPECIAL);
    assert.deepEqual(mergeSpecial({}), DEFAULT_SPECIAL);
    assert.deepEqual(mergeSpecial({ strong: 'nope', marker: 3 }), DEFAULT_SPECIAL);
});

test('合法 key 保留，其余用默认', () => {
    const merged = mergeSpecial({ strong: 'soft-purple', extra: true });
    assert.equal(merged.strong, 'soft-purple');
    assert.equal(merged.marker, DEFAULT_SPECIAL.marker);
    assert.equal(merged.inlineCode, DEFAULT_SPECIAL.inlineCode);
});

test('写出的是 palette 变量，不是 hex', () => {
    const vars = specialCssVars(DEFAULT_SPECIAL);
    assert.equal(vars['--folio-fg-strong'], paletteVar('warm-red'));
    assert.equal(vars['--folio-fg-marker'], paletteVar('light-blue'));
    for (const v of Object.values(vars)) {
        assert.equal(v.includes('#'), false);
        assert.match(v, /var\(--folio-palette-/);
    }
});
