import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tocLabel } from './toc.ts';

test('普通标题原样保留', () => {
    assert.equal(tocLabel('Chapter 1: Defining Models'), 'Chapter 1: Defining Models');
    assert.equal(tocLabel('  前言  '), '前言');
});

test('标题里的换行收成空格', () => {
    assert.equal(tocLabel('Foo\nBar'), 'Foo Bar');
});

test('横线被当成 setext 时，整段带多行换行的正文不进目录', () => {
    const dumped = [
        '- [Linux fork](https://man7.org/)',
        '- [Apache Arrow](https://arrow.apache.org/)',
        '- [Go Memory Model](https://go.dev/ref/mem)',
    ].join('\n');
    assert.equal(tocLabel(dumped), null);
});

test('空串不要', () => {
    assert.equal(tocLabel(''), null);
    assert.equal(tocLabel('   \n  '), null);
});
