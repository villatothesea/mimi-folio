/**
 * 工作区：人用来分组翻不同目录的镜头。清单只在本机配置里，
 * 不写进 md、不是第三种分类，米米找东西仍扫各目录自己的文件。
 */

export type FolioWorkspace = {
    id: string;
    name: string;
    dir: string;
};

export type FolioWorkspaceState = {
    items: FolioWorkspace[];
    activeId: string;
};

export function sameDir(a: string, b: string): boolean {
    const na = a.trim().replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
    const nb = b.trim().replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
    return na === nb;
}

export function parseWorkspaces(raw: string): FolioWorkspaceState | null {
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const rec = parsed as { items?: unknown; activeId?: unknown };
        if (!Array.isArray(rec.items) || rec.items.length === 0) return null;
        const items: FolioWorkspace[] = [];
        for (const item of rec.items) {
            if (!item || typeof item !== 'object') continue;
            const row = item as { id?: unknown; name?: unknown; dir?: unknown };
            if (typeof row.id !== 'string' || !row.id.trim()) continue;
            if (typeof row.name !== 'string' || !row.name.trim()) continue;
            if (typeof row.dir !== 'string' || !row.dir.trim()) continue;
            items.push({ id: row.id.trim(), name: row.name.trim(), dir: row.dir.trim() });
        }
        if (items.length === 0) return null;
        const activeId = typeof rec.activeId === 'string' && items.some((w) => w.id === rec.activeId)
            ? rec.activeId
            : items[0].id;
        return { items, activeId };
    } catch {
        return null;
    }
}

export function seedWorkspaces(dir: string, name?: string): FolioWorkspaceState {
    const id = 'default';
    const base = name?.trim() || dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '默认';
    return { items: [{ id, name: base, dir }], activeId: id };
}

export function addWorkspace(
    state: FolioWorkspaceState,
    name: string,
    dir: string,
    id: string,
): FolioWorkspaceState {
    const trimmedName = name.trim();
    const trimmedDir = dir.trim();
    if (!trimmedName || !trimmedDir) throw new Error('需要名称和目录');
    if (state.items.some((w) => sameDir(w.dir, trimmedDir))) throw new Error('这个目录已经是一个工作区');
    const item: FolioWorkspace = { id, name: trimmedName, dir: trimmedDir };
    return { items: [...state.items, item], activeId: id };
}

export function renameWorkspace(state: FolioWorkspaceState, id: string, name: string): FolioWorkspaceState {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('名称不能空');
    if (!state.items.some((w) => w.id === id)) throw new Error('工作区不存在');
    return {
        ...state,
        items: state.items.map((w) => (w.id === id ? { ...w, name: trimmed } : w)),
    };
}

export function removeWorkspace(state: FolioWorkspaceState, id: string): FolioWorkspaceState {
    if (state.items.length <= 1) throw new Error('至少留一个工作区');
    if (!state.items.some((w) => w.id === id)) throw new Error('工作区不存在');
    const items = state.items.filter((w) => w.id !== id);
    const activeId = state.activeId === id ? items[0].id : state.activeId;
    return { items, activeId };
}

export function activateWorkspace(state: FolioWorkspaceState, id: string): FolioWorkspaceState {
    if (!state.items.some((w) => w.id === id)) throw new Error('工作区不存在');
    return { ...state, activeId: id };
}

export function activeWorkspace(state: FolioWorkspaceState): FolioWorkspace {
    return state.items.find((w) => w.id === state.activeId) ?? state.items[0];
}

/** 给卡片小字用：盘符路径原样，太长中间省略。 */
export function shortWorkspaceDir(dir: string, keep = 42): string {
    const text = dir.trim();
    if (text.length <= keep) return text;
    const head = Math.ceil((keep - 1) / 2);
    const tail = Math.floor((keep - 1) / 2);
    return `${text.slice(0, head)}…${text.slice(-tail)}`;
}
