import assert from 'node:assert/strict';
import { test } from 'node:test';

import { joinOsAbs } from './osPath.ts';

test('Windows 根拼出带盘符的绝对路径', () => {
    assert.equal(
        joinOsAbs('D:\\MyWords\\folio-vault', 'Z-米米/Andrew Ng - AI Engineering Skills Map'),
        'D:\\MyWords\\folio-vault\\Z-米米\\Andrew Ng - AI Engineering Skills Map',
    );
    assert.equal(
        joinOsAbs('D:\\vault\\', 'notes/a.md'),
        'D:\\vault\\notes\\a.md',
    );
});

test('库根本身就是绝对路径', () => {
    assert.equal(joinOsAbs('D:\\vault'), 'D:\\vault');
    assert.equal(joinOsAbs('D:\\vault\\', ''), 'D:\\vault');
});

test('斜杠写的盘符根也归一成反斜杠', () => {
    assert.equal(
        joinOsAbs('D:/MyWords/folio-vault', 'Z-米米/Andrew Ng - AI Engineering Skills Map'),
        'D:\\MyWords\\folio-vault\\Z-米米\\Andrew Ng - AI Engineering Skills Map',
    );
});

test('POSIX 根跟斜杠', () => {
    assert.equal(joinOsAbs('/home/me/vault', 'notes/a.md'), '/home/me/vault/notes/a.md');
});
