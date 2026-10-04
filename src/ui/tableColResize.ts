/**
 * 表格列宽拖拽（验收批）：列边界热区内显示拖柄，拖到后冻结全列为像素宽。
 * Markdown 不存列宽 → 这是视图偏好（与滚动位置同性质），按「文档路径#表格序号」记 localStorage。
 * 全部在页面层完成，不改 muya：给 table 插一个 folio-cols colgroup + table-layout:fixed。
 */
const STORE = 'folio-table-cols';
const HOT_PX = 6;   // 边界热区半径
const MIN_W = 48;   // 列最小宽（px）
const FALLBACK_W = 140;

type WidthMap = Record<string, number[]>; // '文档路径#表格序号' -> 各列 px 宽

function readStore(): WidthMap {
    try {
        return JSON.parse(localStorage.getItem(STORE) ?? '{}') as WidthMap;
    } catch {
        return {};
    }
}

function writeStore(map: WidthMap): void {
    try {
        localStorage.setItem(STORE, JSON.stringify(map));
    } catch { /* 配额满就算了，列宽是偏好 */ }
}

function tablesIn(wrap: HTMLElement): HTMLTableElement[] {
    return [...wrap.querySelectorAll<HTMLTableElement>('table.mu-table-inner')];
}

function colCount(table: HTMLTableElement): number {
    let n = 0;
    for (const row of table.rows) n = Math.max(n, row.cells.length);
    return n;
}

function ensureColgroup(table: HTMLTableElement, n: number): HTMLTableColElement[] {
    let cg = table.querySelector<HTMLElement>(':scope > colgroup.folio-cols');
    if (!cg) {
        cg = document.createElement('colgroup');
        cg.className = 'folio-cols';
        table.prepend(cg);
    }
    while (cg.children.length < n) cg.append(document.createElement('col'));
    return [...cg.children] as HTMLTableColElement[];
}

/** 当前各列渲染宽度（取首个满列行的 cell 边框盒宽）。 */
function measureCols(table: HTMLTableElement): number[] {
    const n = colCount(table);
    const row = [...table.rows].find((r) => r.cells.length === n);
    if (!row) return new Array<number>(n).fill(FALLBACK_W);
    return [...row.cells].map((c) => Math.round(c.getBoundingClientRect().width));
}

function applyWidths(table: HTMLTableElement, widths: number[]): void {
    const n = colCount(table);
    if (!n) return;
    const cols = ensureColgroup(table, n);
    table.style.tableLayout = 'fixed';
    for (let i = 0; i < n; i++) {
        cols[i].style.width = `${Math.max(widths[i] ?? FALLBACK_W, MIN_W)}px`;
    }
}

/**
 * 挂到编辑器容器（#editor-wrap 常驻，编辑器重建不受影响）。
 * getDoc 回当前文档路径，作存储键；null 时不持久化也不响应拖拽。
 */
export function attachTableColResize(wrap: HTMLElement, getDoc: () => string | null): void {
    const handle = document.createElement('div');
    handle.className = 'col-resize-hit';
    handle.hidden = true;
    document.body.append(handle);

    let target: { table: HTMLTableElement; col: number } | null = null;

    const hide = () => {
        if (!drag && !handle.matches(':hover')) handle.hidden = true;
    };

    wrap.addEventListener('mousemove', (e) => {
        if (drag) return;
        const cell = (e.target as HTMLElement).closest?.('td, th') as HTMLTableCellElement | null;
        const table = cell?.closest('table.mu-table-inner') as HTMLTableElement | null;
        if (!cell || !table || !wrap.contains(table)) {
            target = null;
            hide();
            return;
        }
        const n = colCount(table);
        const rect = cell.getBoundingClientRect();
        let boundaryX = 0;
        let col = -1;
        if (Math.abs(e.clientX - rect.right) <= HOT_PX && cell.cellIndex < n - 1) {
            boundaryX = rect.right;
            col = cell.cellIndex; // 拖的是边界左侧那列
        } else if (Math.abs(e.clientX - rect.left) <= HOT_PX && cell.cellIndex > 0) {
            boundaryX = rect.left;
            col = cell.cellIndex - 1;
        }
        if (col < 0) {
            target = null;
            hide();
            return;
        }
        target = { table, col };
        const tRect = table.getBoundingClientRect();
        handle.hidden = false;
        handle.style.left = `${boundaryX - HOT_PX + 2}px`;
        handle.style.top = `${tRect.top}px`;
        handle.style.height = `${tRect.height}px`;
    });
    wrap.addEventListener('mouseleave', hide);

    let drag: {
        table: HTMLTableElement;
        col: number;
        startX: number;
        widths: number[];
    } | null = null;

    function widthsKey(doc: string, table: HTMLTableElement): string {
        return `${doc}#${tablesIn(wrap).indexOf(table)}`;
    }

    function persist(): void {
        const doc = getDoc();
        if (!doc || !drag) return;
        const map = readStore();
        map[widthsKey(doc, drag.table)] = measureCols(drag.table);
        writeStore(map);
    }

    handle.addEventListener('mousedown', (e) => {
        if (!target || e.button !== 0) return;
        e.preventDefault();
        const n = colCount(target.table);
        const widths = measureCols(target.table);
        const cols = ensureColgroup(target.table, n);
        target.table.style.tableLayout = 'fixed';
        for (let i = 0; i < n; i++) cols[i].style.width = `${Math.max(widths[i], MIN_W)}px`;
        drag = { table: target.table, col: target.col, startX: e.clientX, widths };
        handle.classList.add('dragging');
    });

    window.addEventListener('mousemove', (e) => {
        if (!drag) return;
        const w = Math.max(drag.widths[drag.col] + (e.clientX - drag.startX), MIN_W);
        const cols = ensureColgroup(drag.table, colCount(drag.table));
        cols[drag.col].style.width = `${Math.round(w)}px`;
        const tRect = drag.table.getBoundingClientRect();
        handle.style.left = `${e.clientX - HOT_PX + 2}px`;
        handle.style.top = `${tRect.top}px`;
        handle.style.height = `${tRect.height}px`;
    });
    window.addEventListener('mouseup', () => {
        if (!drag) return;
        persist();
        drag = null;
        handle.classList.remove('dragging');
        handle.hidden = true;
    });

    // 滚动时拖柄留在原地会指错列：跟随表格重算；拖拽中同样校正
    wrap.closest('#doc-scroll')?.addEventListener('scroll', () => {
        const table = drag?.table ?? target?.table;
        if (!table || handle.hidden) return;
        const tRect = table.getBoundingClientRect();
        handle.style.top = `${tRect.top}px`;
        handle.style.height = `${tRect.height}px`;
    });

    // muya 重渲表格会换掉 DOM：监视到有表缺我们的 colgroup 时按存档补回
    let raf = 0;
    const observer = new MutationObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
            const doc = getDoc();
            if (!doc) return;
            const map = readStore();
            tablesIn(wrap).forEach((table, i) => {
                const saved = map[`${doc}#${i}`];
                if (saved && !table.querySelector(':scope > colgroup.folio-cols')) applyWidths(table, saved);
            });
        });
    });
    observer.observe(wrap, { childList: true, subtree: true });
}
