import assert from 'node:assert/strict';
import test from 'node:test';

import { dirPickRows, joinRel, VAULT_ROOT, VAULT_ROOT_LABEL } from './dirPick.ts';

test('第一层是库根，子层按路径缩进', () => {
    const rows = dirPickRows(['links/docs/工人', 'memos', 'links']);
    assert.deepEqual(rows[0], { path: VAULT_ROOT, name: VAULT_ROOT_LABEL, depth: 0 });
    assert.deepEqual(
        rows.slice(1).map((r) => [r.path, r.name, r.depth]),
        [
            ['links', 'links', 1],
            ['links/docs/工人', '工人', 3],
            ['memos', 'memos', 1],
        ],
    );
});

test('空列表也有库根；joinRel 根目录不加斜杠', () => {
    assert.equal(dirPickRows([]).length, 1);
    assert.equal(joinRel('', 'a.md'), 'a.md');
    assert.equal(joinRel('notes', 'a.md'), 'notes/a.md');
});
