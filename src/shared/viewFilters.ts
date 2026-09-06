/**
 * 底栏看法筛选：默认单选；Ctrl/Cmd 点选为并集（同时展示）。
 * 「全部」= 空集合。
 */

export type ViewFilterKey = 'notes' | 'memos' | 'links' | 'fav';

export type ViewFilterFile = {
    kind?: string;
    linked?: boolean;
    favorite?: boolean;
};

export function nextViewFilters(current: Iterable<string>, key: string, multi: boolean): Set<string> {
    if (key === 'all' || !multi) return key === 'all' ? new Set() : new Set([key]);
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
}

export function applyViewFilters<T extends ViewFilterFile>(files: T[], filters: Iterable<string>): T[] {
    const set = new Set(filters);
    if (set.size === 0) return files;
    return files.filter((file) =>
        (set.has('notes') && file.kind === 'note')
        || (set.has('memos') && file.kind === 'memo')
        || (set.has('links') && Boolean(file.linked))
        || (set.has('fav') && Boolean(file.favorite)));
}
