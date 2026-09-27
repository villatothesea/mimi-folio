import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchDocPath, matchHeadingIndex, parseDeepLink } from './deepLink.ts';

// ==== 参数解析 ====

test('doc 与 anchor 都解码取出', () => {
    const link = parseDeepLink('?token=abc&host=mimi&doc=notes%2F%E8%89%B2%E5%8D%A1.md&anchor=%E6%A0%87%E9%A2%98');
    assert.equal(link.doc, 'notes/色卡.md');
    assert.equal(link.anchor, '标题');
});

test('不带参数就是双 null，与现状等价', () => {
    const link = parseDeepLink('?token=abc');
    assert.equal(link.doc, null);
    assert.equal(link.anchor, null);
});

test('只有 doc 没 anchor', () => {
    const link = parseDeepLink('?doc=notes/a.md');
    assert.equal(link.doc, 'notes/a.md');
    assert.equal(link.anchor, null);
});

test('空白参数当不存在', () => {
    const link = parseDeepLink('?doc=%20%20&anchor=');
    assert.equal(link.doc, null);
    assert.equal(link.anchor, null);
});

test('坏编码不炸：解不出就原样拿着，匹配不上走默认流程', () => {
    const link = parseDeepLink('?doc=%zz%%');
    assert.equal(link.doc, '%zz%%');
});

test('open 参数（桌面壳双击文件传入的绝对路径）解码取出', () => {
    const link = parseDeepLink('?open=D%3A%5Cdocs%5C%E7%AC%94%E8%AE%B0.md');
    assert.equal(link.open, 'D:\\docs\\笔记.md');
    assert.equal(link.doc, null);
    const none = parseDeepLink('?doc=notes/a.md');
    assert.equal(none.open, null);
});

// ==== doc 匹配 ====

const FILES = [{ path: 'notes/色卡.md' }, { path: 'memos/2026-09-07-10-20-30.md' }, { path: 'links/周报\\存档.md' }];

test('原样精确命中', () => {
    assert.equal(matchDocPath(FILES, 'notes/色卡.md'), 'notes/色卡.md');
});

test('反斜杠分隔符归一化后命中', () => {
    assert.equal(matchDocPath(FILES, 'notes\\色卡.md'), 'notes/色卡.md');
    assert.equal(matchDocPath(FILES, 'links/周报\\存档.md'), 'links/周报\\存档.md');
});

test('清单里没有的路径（含穿越串）一律 miss', () => {
    assert.equal(matchDocPath(FILES, 'notes/不存在.md'), null);
    assert.equal(matchDocPath(FILES, '../../../etc/passwd'), null);
    assert.equal(matchDocPath(FILES, ''), null);
});

// ==== anchor 匹配 ====

const HEADINGS = ['', '前言', '第一章 色卡的收集', '第二章 小结\n与回顾'];

test('精确命中', () => {
    assert.equal(matchHeadingIndex(HEADINGS, '前言'), 1);
});

test('子串命中：anchor 比标题短（模型只记得半截）', () => {
    assert.equal(matchHeadingIndex(HEADINGS, '色卡的收集'), 2);
});

test('子串命中：anchor 比标题长（模型带上了转述）', () => {
    assert.equal(matchHeadingIndex(HEADINGS, '前言（旧稿）'), 1);
});

test('空白归一化后命中', () => {
    assert.equal(matchHeadingIndex(HEADINGS, '第二章  小结 与回顾'), 3);
    assert.equal(matchHeadingIndex(HEADINGS, '第二章\t小结\n与回顾'), 3);
});

test('miss 与空值回 -1（调用方退化到文档顶）', () => {
    assert.equal(matchHeadingIndex(HEADINGS, '不存在的标题'), -1);
    assert.equal(matchHeadingIndex(HEADINGS, '   '), -1);
    assert.equal(matchHeadingIndex([], '前言'), -1);
});
