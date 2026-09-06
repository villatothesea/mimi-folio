import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseLastView } from './lastView.ts';

test('空或乱数据不当上次页', () => {
    assert.equal(parseLastView(null), null);
    assert.equal(parseLastView(''), null);
    assert.equal(parseLastView('{'), null);
    assert.equal(parseLastView('{"v":"file"}'), null);
    assert.equal(parseLastView('{"v":"file","path":"../etc/passwd"}'), null);
});

test('记住速记看法与一篇路径', () => {
    assert.deepEqual(parseLastView('{"v":"memos"}'), { v: 'memos' });
    assert.deepEqual(parseLastView('{"v":"file","path":"notes/欢迎.md"}'), { v: 'file', path: 'notes/欢迎.md' });
    assert.deepEqual(parseLastView('{"v":"file","path":"links\\\\a.html"}'), { v: 'file', path: 'links/a.html' });
});
