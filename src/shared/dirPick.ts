/** 目录选择：库根为第一层，其余按路径缩进。path 空串 = 库根。 */

export const VAULT_ROOT = '';
export const VAULT_ROOT_LABEL = '库根';

export type DirPickRow = { path: string; name: string; depth: number };

export function dirPickRows(dirs: Iterable<string>): DirPickRow[] {
    const set = new Set<string>();
    for (const raw of dirs) {
        const dir = raw.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
        if (dir) set.add(dir);
    }
    const rows: DirPickRow[] = [{ path: VAULT_ROOT, name: VAULT_ROOT_LABEL, depth: 0 }];
    for (const dir of [...set].sort((a, b) => a.localeCompare(b, 'zh'))) {
        const segs = dir.split('/').filter(Boolean);
        rows.push({ path: segs.join('/'), name: segs[segs.length - 1] ?? dir, depth: segs.length });
    }
    return rows;
}

export function joinRel(dir: string, name: string): string {
    return dir ? `${dir}/${name}` : name;
}
