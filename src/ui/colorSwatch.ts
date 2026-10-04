/**
 * 色卡块（验收批）：```color / ```palette / ```色卡 代码块渲染成色卡网格。
 * 每行 = 色码 + 可选名字（`#0F4921 Emerald`）；空行 = 网格另起一行。卡面：有名两行（名字 / 色码），无名单行色码（统一显示 hex）。
 * 默认只显示色卡——源码与代码块底衬都隐掉；点色卡出弹出式色码输入（# 自带、
 * 六位跳格、空格断行、Backspace 删格），提交经 muya input 管道写回源码；
 * 键盘摸进代码块仍自动露源码。展示层：不改 muya、不进 md 正文格式。
 * 每行格数：板左上角 −/＋，按块记忆（键 = 文档路径#色卡块序号，同表格列宽的存法）；
 * 没有记忆按页面宽度档给默认（标准 4 / 加宽 8）。旧版的全局档数迁移成默认值。
 * 编辑态存 WeakSet：muya 重渲后 scan 会把 folio-editing 补回同一个 pre。
 */
const LANGS = new Set(['color', 'colors', 'palette', 'swatch', '色卡', '色块']);
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-zA-Z]+)\s*/;
const COLS_KEY = 'folio-swatch-cols';
const COLS_MIN = 2;
const COLS_MAX = 24;

type Swatch = { color: string; name: string };
/** 'br' = 源码里的空行 → 色块在网格里另起一行 */
type SwatchItem = Swatch | 'br';

function parseSwatches(text: string): SwatchItem[] {
    const out: SwatchItem[] = [];
    let pendingBreak = false;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) {
            if (out.length && out[out.length - 1] !== 'br') pendingBreak = true;
            continue;
        }
        const m = COLOR_RE.exec(line);
        if (!m || !CSS.supports('color', m[1])) continue; // 非色码行忽略，也不断行
        if (pendingBreak) {
            out.push('br');
            pendingBreak = false;
        }
        out.push({ color: m[1], name: line.slice(m[1].length).trim() });
    }
    return out;
}

/** WCAG 相对亮度（线性化后 0~1），决定卡上用深字还是浅字。 */
function luminance(color: string): number {
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return 0;
    probe.fillStyle = color;
    const computed = probe.fillStyle; // 归一化出 #rrggbb 或 rgb()/rgba()
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(computed);
    const f = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s]+([\d.]+))?/i.exec(computed);
    let ch = m
        ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
        : f ? [+f[1], +f[2], +f[3]] : null;
    if (!ch) return 0;
    if (f?.[4]) {
        const a = Number(f[4]); // 带透明度的先按白底合成再判断
        ch = ch.map((c) => Math.round(c * a + 255 * (1 - a)));
    }
    const lin = ch.map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** 归一成 hex 显示（#rrggbb / 带透明度 #rrggbbaa）；认不出的原样返回。 */
function hexText(color: string): string {
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return color;
    probe.fillStyle = color;
    const computed = probe.fillStyle;
    const m = /^#([0-9a-f]{6})/i.exec(computed);
    if (m) return `#${m[1]}`;
    const f = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s]+([\d.]+))?/i.exec(computed);
    if (!f) return color;
    const hex = [+f[1], +f[2], +f[3]].map((c) => c.toString(16).padStart(2, '0')).join('');
    const a = f[4] !== undefined ? Math.round(Number(f[4]) * 255) : 255;
    return a >= 255 ? `#${hex}` : `#${hex}${a.toString(16).padStart(2, '0')}`;
}

/** 每块一格数：{"文档#块序号": n}；旧版存的是裸数字全局档，读出来当默认值。 */
type ColsStore = { map: Record<string, number>; legacy: number };

function readColsStore(): ColsStore {
    try {
        const v: unknown = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null');
        if (v && typeof v === 'object') return { map: v as Record<string, number>, legacy: 0 };
        if (typeof v === 'number' && Number.isInteger(v)) return { map: {}, legacy: v };
    } catch { /* 无记录/坏数据 */ }
    return { map: {}, legacy: 0 };
}

function colsFor(store: ColsStore, key: string): number {
    const v = store.map[key];
    if (Number.isInteger(v) && v >= COLS_MIN && v <= COLS_MAX) return v;
    if (store.legacy >= COLS_MIN && store.legacy <= COLS_MAX) return store.legacy;
    return document.documentElement.dataset.width === 'wide' ? 8 : 4;
}

function renderBoard(swatches: SwatchItem[], cols: number): HTMLElement {
    const board = document.createElement('div');
    board.className = 'swatch-board';
    board.contentEditable = 'false';

    // 块左上：每行格数。−/＋ 之间是当前档（存数或按宽度档的默认）。
    const bar = document.createElement('div');
    bar.className = 'swatch-bar';
    const label = document.createElement('span');
    label.className = 'swatch-cols-label';
    label.textContent = '每行';
    const dec = document.createElement('button');
    dec.type = 'button';
    dec.className = 'swatch-cols-btn';
    dec.dataset.dir = '-1';
    dec.textContent = '−';
    dec.title = '每行少一格';
    const num = document.createElement('span');
    num.className = 'swatch-cols-num';
    num.textContent = String(cols);
    const inc = document.createElement('button');
    inc.type = 'button';
    inc.className = 'swatch-cols-btn';
    inc.dataset.dir = '1';
    inc.textContent = '＋';
    inc.title = '每行多一格';
    bar.append(label, dec, num, inc);
    board.append(bar);

    const grid = document.createElement('div');
    grid.className = 'swatch-grid';
    grid.style.setProperty('--sw-cols', String(cols));
    if (!swatches.length) {
        const hint = document.createElement('div');
        hint.className = 'swatch-empty';
        hint.textContent = '每行一个色码，可跟名字，如 #0F4921 Emerald';
        grid.append(hint);
    }
    for (const s of swatches) {
        if (s === 'br') {
            const br = document.createElement('div');
            br.className = 'swatch-break';
            grid.append(br);
            continue;
        }
        const card = document.createElement('div');
        card.className = 'swatch-card';
        card.style.setProperty('--sw', s.color);
        // 卡上深字/浅字按卡色 WCAG 亮度选：L>0.18 时深字比浅字对比度高
        if (luminance(s.color) > 0.18) card.classList.add('swatch-light');
        if (s.name) {
            card.classList.add('swatch-named');
            const name = document.createElement('span');
            name.className = 'swatch-name';
            name.textContent = s.name;
            card.append(name);
        }
        const code = document.createElement('span');
        code.className = 'swatch-code';
        code.textContent = hexText(s.color);
        card.append(code);
        grid.append(card);
    }
    board.append(grid);
    return board;
}

/**
 * 把代码块源码整段换掉。Не через DOM/execCommand: у stamped-листа
 * `codeblock.content` сеттер .text сам диспатчит jsonState.editOperation
 * (ot-text diff) → модель → json-change → автосохранение. DOM сеттер не
 * трогает — leaf.update() перерендеривает лист. Проверено в живой странице:
 * getMarkdown обновляется синхронно, файл сохраняется.
 */
type MuyaContentLeaf = {
    blockName?: string;
    text?: string;
    outContainer?: unknown;
    update?: () => void;
    firstContentInDescendant?: () => MuyaContentLeaf | null;
    nextContentInContext?: () => MuyaContentLeaf | null;
};

function codeContentLeaf(pre: HTMLElement): MuyaContentLeaf | null {
    const container = (pre as unknown as { __MUYA_BLOCK__?: MuyaContentLeaf }).__MUYA_BLOCK__;
    let leaf = container?.firstContentInDescendant?.() ?? null;
    for (let i = 0; leaf && i < 12; i += 1) {
        if (leaf.blockName === 'codeblock.content' && leaf.outContainer === container) return leaf;
        leaf = leaf.nextContentInContext?.() ?? null;
    }
    return null;
}

function writeCodeText(pre: HTMLElement, text: string): boolean {
    const leaf = codeContentLeaf(pre);
    if (!leaf || typeof leaf.text !== 'string') return false;
    leaf.text = text;
    // сеттер пишет в jsonState, но не рендерит DOM — руками перерендерить лист,
    // иначе scan прочитает старый .mu-code и доска не обновится до перезагрузки
    leaf.update?.();
    return true;
}

const HEX_RE = /[^0-9a-fA-F]/g;

/**
 * 色卡弹出式编辑：点色卡板浮出一层横排输入格——# 自带不用打，
 * 六位码自动跳下一格，空格 = 源码里的空行（断行符），Backspace 删格，
 * Enter/点外提交，Esc 放弃。格子带原名，提交时色码后补回名字。
 */
function openSwatchEditor(pre: HTMLElement, x: number, y: number): void {
    const codeEl = pre.querySelector<HTMLElement>('.mu-code');
    if (!codeEl) return;
    const items = parseSwatches(codeEl.textContent ?? '');

    const pop = document.createElement('div');
    pop.className = 'swatch-editor';
    pop.title = '每格一个色码（# 不用打），六位自动跳下一格；留空 = 断行，Backspace 删格；Enter 提交，Esc 取消';

    const inputs: HTMLInputElement[] = [];
    const addCell = (hex: string, name: string): HTMLInputElement => {
        const cell = document.createElement('label');
        cell.className = 'swatch-edit-cell';
        const hash = document.createElement('span');
        hash.className = 'swatch-edit-hash';
        hash.textContent = '#';
        const inp = document.createElement('input');
        inp.value = hex;
        inp.dataset.name = name;
        inp.maxLength = 8;
        inp.spellcheck = false;
        inp.autocomplete = 'off';
        cell.append(hash, inp);
        pop.append(cell);
        inputs.push(inp);
        return inp;
    };
    for (const it of items) {
        if (it === 'br') addCell('', '');
        else addCell(hexText(it.color).replace(/^#/, ''), it.name);
    }
    addCell('', ''); // 末尾留一格空白续写

    const ensureTail = () => {
        if (inputs.length === 0 || inputs[inputs.length - 1].value.trim()) addCell('', '');
    };
    const focusAt = (i: number) => inputs[Math.max(0, Math.min(inputs.length - 1, i))]?.focus();

    pop.addEventListener('input', (e) => {
        const inp = e.target as HTMLInputElement;
        const cleaned = inp.value.replace(HEX_RE, '');
        if (inp.value !== cleaned) inp.value = cleaned;
        ensureTail();
        if (inp.value.length >= 6) focusAt(inputs.indexOf(inp) + 1);
    });
    pop.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
        } else if (e.key === 'Backspace') {
            const inp = e.target as HTMLInputElement;
            if (inp.tagName !== 'INPUT' || inp.value !== '') return;
            const i = inputs.indexOf(inp);
            if (i < 0) return;
            e.preventDefault();
            inputs.splice(i, 1);
            inp.parentElement?.remove();
            ensureTail();
            focusAt(i - 1);
        }
    });

    let done = false;
    const close = () => {
        if (done) return;
        done = true;
        document.removeEventListener('pointerdown', onOutside, true);
        pop.remove();
    };
    const commit = () => {
        // 空输入 = 断行；连续/收尾空行合并裁掉；格子原名补回色码后
        const lines: string[] = [];
        for (const inp of inputs) {
            const v = inp.value.trim();
            if (!v) {
                if (lines.length && lines[lines.length - 1] !== '') lines.push('');
                continue;
            }
            const nm = inp.dataset.name;
            lines.push(`#${v}${nm ? ` ${nm}` : ''}`);
        }
        while (lines.length && lines[lines.length - 1] === '') lines.pop();
        const text = lines.join('\n');
        if (text !== (codeEl.textContent ?? '')) writeCodeText(pre, text);
        close();
    };
    const onOutside = (e: Event) => {
        if (e.target instanceof Node && pop.contains(e.target)) return;
        commit();
    };
    document.addEventListener('pointerdown', onOutside, true);

    document.body.append(pop);
    // 贴在点击处，出界回夹（与 ctx-menu 同款定位）
    const rect = pop.getBoundingClientRect();
    pop.style.left = `${Math.min(x, innerWidth - rect.width - 8)}px`;
    pop.style.top = `${Math.min(y, innerHeight - rect.height - 8)}px`;
    inputs[0]?.focus();
}

export function attachColorSwatches(wrap: HTMLElement, docKey: () => string): void {
    const editing = new WeakSet<HTMLElement>();
    const store = readColsStore();

    const scan = () => {
        let idx = 0; // 只数色卡块：普通代码块不占序号
        for (const pre of wrap.querySelectorAll<HTMLElement>('pre.mu-code-block')) {
            const lang = pre.querySelector('.mu-language-input')?.textContent?.trim().toLowerCase() ?? '';
            const codeEl = pre.querySelector<HTMLElement>('.mu-code');
            if (!LANGS.has(lang)) {
                pre.classList.remove('folio-swatched', 'folio-editing');
                pre.querySelector(':scope > .swatch-board')?.remove();
                continue;
            }
            const key = `${docKey()}#${idx++}`;
            const cols = colsFor(store, key);
            const text = codeEl?.textContent ?? '';
            const swatches = parseSwatches(text);
            const sig = `${cols}|${JSON.stringify(swatches)}`;
            let board = pre.querySelector<HTMLElement>(':scope > .swatch-board');
            if (!board || board.dataset.sig !== sig || board.dataset.colsKey !== key) {
                board?.remove();
                board = renderBoard(swatches, cols);
                board.dataset.sig = sig;
                board.dataset.colsKey = key;
                pre.append(board);
            }
            pre.classList.add('folio-swatched');
            if (editing.has(pre)) pre.classList.add('folio-editing');
        }
    };

    const setCols = (key: string, n: number) => {
        store.map[key] = Math.min(COLS_MAX, Math.max(COLS_MIN, n));
        localStorage.setItem(COLS_KEY, JSON.stringify(store.map));
        scan();
    };

    let raf = 0;
    new MutationObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(scan);
    }).observe(wrap, { childList: true, subtree: true, characterData: true });
    scan();

    wrap.addEventListener('mousedown', (e) => {
        const target = e.target as HTMLElement;
        const stepper = target.closest<HTMLElement>('.swatch-cols-btn');
        const boardKey = stepper?.closest<HTMLElement>('.swatch-board')?.dataset.colsKey;
        if (stepper && boardKey) {
            e.preventDefault();
            setCols(boardKey, colsFor(store, boardKey) + Number(stepper.dataset.dir));
            return;
        }
        // 点色卡板 → 弹出式色码输入（不碰源码；键盘摸进代码块仍自动露源码）
        const board = target.closest('.swatch-board');
        const pre = board?.closest<HTMLElement>('pre.mu-code-block');
        if (!board || !pre) return;
        e.preventDefault();
        openSwatchEditor(pre, e.clientX, e.clientY);
    }, true);

    wrap.addEventListener('focusout', (e) => {
        const pre = (e.target as HTMLElement).closest?.<HTMLElement>('pre.mu-code-block.folio-editing');
        if (pre && !(e.relatedTarget instanceof Node && pre.contains(e.relatedTarget))) {
            pre.classList.remove('folio-editing');
            editing.delete(pre);
        }
    });

    // 光标进出都要跟：键盘摸进代码块露出源码（不然在隐藏区盲打），
    // 选择移到别块延迟回色卡（防抖，点色卡放选区落地前别急着收）
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    document.addEventListener('selectionchange', () => {
        const node = document.getSelection()?.anchorNode;
        const el = node?.nodeType === 1 ? node as Element : node?.parentElement ?? null;
        const pre = el?.closest?.<HTMLElement>('pre.mu-code-block.folio-swatched') ?? null;
        if (pre) {
            editing.add(pre);
            pre.classList.add('folio-editing');
            clearTimeout(hideTimer);
            return;
        }
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            const anchor = document.getSelection()?.anchorNode ?? null;
            for (const p of wrap.querySelectorAll('pre.folio-editing')) {
                if (!anchor || !p.contains(anchor)) {
                    p.classList.remove('folio-editing');
                    editing.delete(p as HTMLElement);
                }
            }
        }, 150);
    });
}
