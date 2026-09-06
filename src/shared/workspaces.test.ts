import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    activateWorkspace,
    addWorkspace,
    parseWorkspaces,
    removeWorkspace,
    renameWorkspace,
    seedWorkspaces,
    shortWorkspaceDir,
    sameDir,
} from './workspaces.ts';

const seed = seedWorkspaces('D:/vault/reading', '阅读');

test('缺文件时用目录名做默认工作区', () => {
    assert.equal(seed.items[0].name, '阅读');
    assert.equal(seed.activeId, 'default');
});

test('乱数据不当工作区清单', () => {
    assert.equal(parseWorkspaces(''), null);
    assert.equal(parseWorkspaces('{'), null);
    assert.equal(parseWorkspaces('{"items":[]}'), null);
});

test('读清单并校正丢失的 activeId', () => {
    const parsed = parseWorkspaces(
        JSON.stringify({
            activeId: 'gone',
            items: [
                { id: 'a', name: '阅读', dir: 'D:/read' },
                { id: 'b', name: '编程', dir: 'D:/code' },
            ],
        }),
    );
    assert.equal(parsed?.activeId, 'a');
    assert.equal(parsed?.items.length, 2);
});

test('新建后切到新区；同目录拒绝', () => {
    const next = addWorkspace(seed, '编程', 'D:/code', 'ws-2');
    assert.equal(next.activeId, 'ws-2');
    assert.equal(next.items.length, 2);
    assert.throws(() => addWorkspace(next, '又一个', 'D:/code', 'ws-3'));
    assert.throws(() => addWorkspace(next, '又一个', 'd:/CODE/', 'ws-3'));
});

test('改名、删除最后一个不行、删当前则切到剩下的', () => {
    const two = addWorkspace(seed, '旅行', 'D:/trip', 'ws-trip');
    const named = renameWorkspace(two, 'default', '阅读笔记');
    assert.equal(named.items[0].name, '阅读笔记');
    assert.throws(() => removeWorkspace(seed, 'default'));
    const left = removeWorkspace(two, 'ws-trip');
    assert.equal(left.items.length, 1);
    assert.equal(left.activeId, 'default');
    const switched = activateWorkspace(two, 'ws-trip');
    const afterDel = removeWorkspace(switched, 'ws-trip');
    assert.equal(afterDel.activeId, 'default');
});

test('路径比较不认斜杠和大小写', () => {
    assert.equal(sameDir('D:\\a\\b', 'd:/a/b/'), true);
    assert.equal(sameDir('D:\\a', 'D:\\b'), false);
});

test('目录太长中间省略', () => {
    const long = 'D:/very/long/path/to/a/workspace/folder/here';
    const shown = shortWorkspaceDir(long, 20);
    assert.ok(shown.includes('…'));
    assert.ok(shown.length <= 20);
});
