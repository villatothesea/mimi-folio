/**
 * 上次打开的页：刷新或再进米素时回到同一篇（md / html）或速记看法。
 * 只记看法，不改盘上的 md。
 */

export const LAST_VIEW_KEY = 'folio-last-view';

export type LastView = { v: 'memos' } | { v: 'file'; path: string };

export function parseLastView(raw: string | null): LastView | null {
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const rec = parsed as { v?: unknown; path?: unknown };
        if (rec.v === 'memos') return { v: 'memos' };
        if (rec.v === 'file' && typeof rec.path === 'string') {
            const path = rec.path.trim().replaceAll('\\', '/');
            if (!path || path.includes('..') || path.startsWith('/')) return null;
            return { v: 'file', path };
        }
        return null;
    } catch {
        return null;
    }
}

export function readLastView(): LastView | null {
    try {
        return parseLastView(localStorage.getItem(LAST_VIEW_KEY));
    } catch {
        return null;
    }
}

export function writeLastView(view: LastView | null): void {
    try {
        if (!view) localStorage.removeItem(LAST_VIEW_KEY);
        else localStorage.setItem(LAST_VIEW_KEY, JSON.stringify(view));
    } catch {
        /* 配额或隐私模式 */
    }
}

const LAST_VIEW_MAP_KEY = 'folio-last-view-map';

function readLastViewMap(): Record<string, LastView> {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(LAST_VIEW_MAP_KEY) ?? '{}');
        if (!parsed || typeof parsed !== 'object') return {};
        const out: Record<string, LastView> = {};
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
            const view = parseLastView(JSON.stringify(value));
            if (view) out[id] = view;
        }
        return out;
    } catch {
        return {};
    }
}

export function readLastViewFor(workspaceId: string): LastView | null {
    return readLastViewMap()[workspaceId] ?? null;
}

export function writeLastViewFor(workspaceId: string, view: LastView | null): void {
    try {
        const map = readLastViewMap();
        if (!view) delete map[workspaceId];
        else map[workspaceId] = view;
        localStorage.setItem(LAST_VIEW_MAP_KEY, JSON.stringify(map));
        writeLastView(view);
    } catch {
        writeLastView(view);
    }
}
