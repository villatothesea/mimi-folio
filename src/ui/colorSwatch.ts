/**
 * 色卡块（验收批）：```color / ```palette / ```色卡 代码块渲染成色卡网格。
 * 每行 = 色码 + 可选名字（`#0F4921 Emerald`）；格子两行：名字 / 色码（无名时第二行给 rgb）。
 * 默认只显示色卡——源码与代码块底衬都隐掉；点色卡进源码编辑态（色卡仍在下方实时预览），
 * 光标离开代码块回色卡。纯展示层：不改 muya、不进 md 正文格式。
 * 每行格数：板左上角 −/＋，存 localStorage；默认按页面宽度档（标准 4 / 加宽 8）。
 * 编辑态存 WeakSet：muya 重渲后 scan 会把 folio-editing 补回同一个 pre。
 */
const LANGS = new Set(['color', 'colors', 'palette', 'swatch', '色卡', '色块']);
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-zA-Z]+)\s*/;
const COLS_KEY = 'folio-swatch-cols';
const COLS_MIN = 2;
const COLS_MAX = 24;

type Swatch = { color: string; name: string };

function parseSwatches(text: string): Swatch[] {
    const out: Swatch[] = [];
    for (const line of text.split('\n')) {
        const m = COLOR_RE.exec(line.trim());
        if (!m) continue;
        const color = m[1];
        if (!CSS.supports('color', color)) continue; // 任意 CSS 色码都行，不合法的词自然出局
        out.push({ color, name: line.trim().slice(color.length).trim() });
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

function rgbText(color: string): string {
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return color;
    probe.fillStyle = color;
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(probe.fillStyle);
    return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : color;
}

function effCols(): number {
    const saved = Number(localStorage.getItem(COLS_KEY));
    if (Number.isInteger(saved) && saved >= COLS_MIN && saved <= COLS_MAX) return saved;
    return document.documentElement.dataset.width === 'wide' ? 8 : 4;
}

function renderBoard(swatches: Swatch[], cols: number): HTMLElement {
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
        const card = document.createElement('div');
        card.className = 'swatch-card';
        card.style.setProperty('--sw', s.color);
        // 卡上深字/浅字按卡色 WCAG 亮度选：L>0.18 时深字比浅字对比度高
        if (luminance(s.color) > 0.18) card.classList.add('swatch-light');
        const name = document.createElement('span');
        name.className = 'swatch-name';
        name.textContent = s.name || s.color;
        const code = document.createElement('span');
        code.className = 'swatch-code';
        code.textContent = s.name ? s.color : rgbText(s.color);
        card.append(name, code);
        grid.append(card);
    }
    board.append(grid);
    return board;
}

/** 真选区落进代码尾部——合成鼠标事件搬不动原生光标（isTrusted=false），Selection API 可以。 */
function placeCaretInCode(pre: HTMLElement): void {
    requestAnimationFrame(() => {
        const code = pre.querySelector<HTMLElement>('.mu-code');
        const sel = document.getSelection();
        if (!code || !sel) return;
        const r = document.createRange();
        r.selectNodeContents(code);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
    });
}

export function attachColorSwatches(wrap: HTMLElement): void {
    const editing = new WeakSet<HTMLElement>();
    let cols = effCols();

    const scan = () => {
        for (const pre of wrap.querySelectorAll<HTMLElement>('pre.mu-code-block')) {
            const lang = pre.querySelector('.mu-language-input')?.textContent?.trim().toLowerCase() ?? '';
            const codeEl = pre.querySelector<HTMLElement>('.mu-code');
            if (!LANGS.has(lang)) {
                pre.classList.remove('folio-swatched', 'folio-editing');
                pre.querySelector(':scope > .swatch-board')?.remove();
                continue;
            }
            const text = codeEl?.textContent ?? '';
            const swatches = parseSwatches(text);
            const sig = `${cols}|${JSON.stringify(swatches)}`;
            let board = pre.querySelector<HTMLElement>(':scope > .swatch-board');
            if (!board || board.dataset.sig !== sig) {
                board?.remove();
                board = renderBoard(swatches, cols);
                board.dataset.sig = sig;
                pre.append(board);
            }
            pre.classList.add('folio-swatched');
            if (editing.has(pre)) pre.classList.add('folio-editing');
        }
    };

    const setCols = (n: number) => {
        cols = Math.min(COLS_MAX, Math.max(COLS_MIN, n));
        localStorage.setItem(COLS_KEY, String(cols));
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
        if (stepper?.closest('.swatch-board')) {
            e.preventDefault();
            setCols(cols + Number(stepper.dataset.dir));
            return;
        }
        // 点色卡板 → 露出源码并把真光标放进代码末尾
        const board = target.closest('.swatch-board');
        const pre = board?.closest<HTMLElement>('pre.mu-code-block');
        if (!board || !pre) return;
        e.preventDefault();
        editing.add(pre);
        pre.classList.add('folio-editing');
        placeCaretInCode(pre);
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
