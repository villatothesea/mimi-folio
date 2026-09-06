import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clampTextScale, formatTextScale, parseStoredScale, textScaleFont, textScaleZoom } from './textScale.ts';

test('默认与非法值都是 1（100%）', () => {
    assert.equal(parseStoredScale(null), 1);
    assert.equal(parseStoredScale(''), 1);
    assert.equal(parseStoredScale('nope'), 1);
});

test('夹在 50%–200%，按 10% 一档', () => {
    assert.equal(clampTextScale(0.2), 0.5);
    assert.equal(clampTextScale(3), 2);
    assert.equal(clampTextScale(1.04), 1);
    assert.equal(clampTextScale(1.06), 1.1);
});

test('显示成百分数', () => {
    assert.equal(formatTextScale(1), '100%');
    assert.equal(formatTextScale(1.1), '110%');
    assert.equal(formatTextScale(0.5), '50%');
});

test('缩小只缩字号，放大才 zoom', () => {
    assert.equal(textScaleZoom(1), 1);
    assert.equal(textScaleZoom(1.2), 1.2);
    assert.equal(textScaleZoom(0.8), 1);
    assert.equal(textScaleFont(1), 1);
    assert.equal(textScaleFont(1.2), 1);
    assert.equal(textScaleFont(0.8), 0.8);
    assert.equal(textScaleFont(0.5), 0.5);
});
