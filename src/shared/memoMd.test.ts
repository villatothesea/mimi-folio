import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    bodySnippet,
    extractHashTags,
    hasCode,
    hasTask,
    hasWikilink,
    memoDayFromPath,
    memoStamp,
    newMemoMarkdown,
    newMemoPath,
    relativeTime,
    saveMemoMarkdown,
    toggleTaskAtLine,
} from './memoMd.ts';

test('文件名日期前缀，旧日记文件也认', () => {
    assert.equal(memoDayFromPath('memos/2026-09-05-14-03-11.md'), '2026-09-05');
    assert.equal(memoDayFromPath('memos/2026-09-05.md'), '2026-09-05');
    assert.equal(memoDayFromPath('notes/x.md'), null);
});

test('选了日历日则文件名跟那天，时分秒仍是现在', () => {
    const now = new Date('2026-09-05T15:04:06');
    assert.equal(memoStamp('2026-09-20', now), '2026-09-20-15-04-06');
    assert.equal(newMemoPath(null, now), 'memos/2026-09-05-15-04-06.md');
});

test('抽 #标签，不把 ATX 标题当标签', () => {
    assert.deepEqual(extractHashTags('忽然想到。 #灵感 #目录\n'), ['灵感', '目录']);
    assert.deepEqual(extractHashTags('# 这是标题\n\n正文\n'), []);
    assert.deepEqual(extractHashTags('见 ` #不是 ` 和 ```\n#也不\n```\n#真的\n'), ['真的']);
});

test('新建把 #标签写入 tags:，没有就不造 frontmatter', () => {
    const withTag = newMemoMarkdown('忽然想到目录。 #灵感');
    assert.match(withTag, /^---\ntags: \[灵感\]\n---\n/);
    assert.match(withTag, /忽然想到目录。 #灵感/);
    assert.equal(newMemoMarkdown('一句闲话'), '一句闲话\n');
});

test('就地保存并入新 #标签，不删原 tags:', () => {
    const original = '---\ntags: [灵感]\n---\n\n旧文\n';
    const next = saveMemoMarkdown(original, '旧文改了 #目录');
    assert.match(next, /tags: \[灵感, 目录\]/);
    assert.match(next, /旧文改了 #目录/);
});

test('勾任务只改那一行的方括号', () => {
    const md = '---\ntags: [a]\n---\n\n- [ ] 一\n- [x] 二\n';
    const on = toggleTaskAtLine(md, 1);
    assert.match(on, /- \[x\] 一/);
    const off = toggleTaskAtLine(on, 2);
    assert.match(off, /- \[ \] 二/);
});

test('派生特征与 snippet', () => {
    const md = '见 [[tagged]]\n\n- [ ] 做\n\n`code`\n';
    assert.equal(hasWikilink(md), true);
    assert.equal(hasTask(md), true);
    assert.equal(hasCode(md), true);
    assert.equal(bodySnippet('---\ntags: [a]\n---\n\n第一行正文\n第二\n'), '第一行正文');
});

test('相对时间', () => {
    const now = Date.parse('2026-09-05T12:00:00');
    assert.equal(relativeTime(now - 10_000, now), '刚刚');
    assert.equal(relativeTime(now - 120_000, now), '2 分钟前');
    assert.equal(relativeTime(now - 86_400_000, now), '昨天');
});
