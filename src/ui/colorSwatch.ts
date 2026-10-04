/**
 * 色卡块（验收批）：```color / ```palette / ```色卡 代码块渲染成色卡。
 * 每行 = 色码 + 可选名字（`#0F4921 Emerald`）；卡片两行：名字 / 色码（无名时第二行给 rgb）。
 * 纯展示层：不改 muya、不进 md 正文格式——源码还在代码块里，点色卡板露出源码编辑，
 * 焦点离开代码块即回到色卡。所有模块挂 #editor-wrap 常驻容器上，编辑器重建不受影响。
 */
const LANGS = new Set(['color', 'colors', 'palette', 'swatch', '色卡', '色块']);
const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-zA-Z]+)\s*/;

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

/** 感知亮度（WCAG 相对亮度简化版），决定卡上用深字还是浅字。 */
function luminance(color: string): number {
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return 0;
    probe.fillStyle = color;
    const computed = probe.fillStyle; // 归一化出 #rrggbb 或 #rgb
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(computed);
    const f = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(computed);
    const ch = m
        ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
        : f ? [+f[1], +f[2], +f[3]] : null;
    if (!ch) return 0;
    return (0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]) / 255;
}

function rgbText(color: string): string {
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return color;
    probe.fillStyle = color;
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(probe.fillStyle);
    return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : color;
}

function renderBoard(swatches: Swatch[]): HTMLElement {
    const board = document.createElement('div');
    board.className = 'swatch-board';
    board.contentEditable = 'false';
    if (!swatches.length) {
        const hint = document.createElement('div');
        hint.className = 'swatch-empty';
        hint.textContent = '每行一个色码，可跟名字，如 #0F4921 Emerald';
        board.append(hint);
        return board;
    }
    for (const s of swatches) {
        const card = document.createElement('div');
        card.className = 'swatch-card';
        card.style.setProperty('--sw', s.color);
        if (luminance(s.color) > 0.45) card.classList.add('swatch-light');
        const name = document.createElement('span');
        name.className = 'swatch-name';
        name.textContent = s.name || s.color;
        const code = document.createElement('span');
        code.className = 'swatch-code';
        code.textContent = s.name ? s.color : rgbText(s.color);
        card.append(name, code);
        board.append(card);
    }
    return board;
}

export function attachColorSwatches(wrap: HTMLElement): void {
    const scan = () => {
        for (const pre of wrap.querySelectorAll<HTMLElement>('pre.mu-code-block')) {
            const lang = pre.querySelector('.mu-language-input')?.textContent?.trim().toLowerCase() ?? '';
            const codeEl = pre.querySelector<HTMLElement>('.mu-code');
            if (!LANGS.has(lang)) {
                pre.classList.remove('folio-swatched');
                pre.querySelector(':scope > .swatch-board')?.remove();
                continue;
            }
            const text = codeEl?.textContent ?? '';
            const sig = JSON.stringify(parseSwatches(text));
            let board = pre.querySelector<HTMLElement>(':scope > .swatch-board');
            if (!board || board.dataset.sig !== sig) {
                board?.remove();
                board = renderBoard(parseSwatches(text));
                board.dataset.sig = sig;
                pre.append(board);
            }
            pre.classList.add('folio-swatched');
        }
    };

    let raf = 0;
    new MutationObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(scan);
    }).observe(wrap, { childList: true, subtree: true, characterData: true });
    scan();

    // 点色卡板 → 露出源码并把光标放进代码里；焦点离开整块 → 回到色卡
    wrap.addEventListener('mousedown', (e) => {
        const board = (e.target as HTMLElement).closest?.('.swatch-board');
        const pre = board?.closest('pre.mu-code-block');
        if (!board || !pre) return;
        e.preventDefault();
        pre.classList.add('folio-editing');
        const content = pre.querySelector<HTMLElement>('.mu-codeblock-content') ?? pre.querySelector<HTMLElement>('.mu-code');
        if (!content) return;
        requestAnimationFrame(() => {
            const r = content.getBoundingClientRect();
            const opts = { bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 8 };
            content.dispatchEvent(new MouseEvent('mousedown', opts));
            content.dispatchEvent(new MouseEvent('mouseup', opts));
            content.dispatchEvent(new MouseEvent('click', opts));
        });
    }, true);
    wrap.addEventListener('focusout', (e) => {
        const pre = (e.target as HTMLElement).closest?.('pre.mu-code-block.folio-editing');
        if (pre && !(e.relatedTarget instanceof Node && pre.contains(e.relatedTarget))) {
            pre.classList.remove('folio-editing');
        }
    });

    // 光标进出都要跟：键盘摸进代码块露出源码（不然在隐藏区盲打），
    // 选择移到别块延迟回色卡（防抖，点色卡的合成点击落地前别急着收）
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    document.addEventListener('selectionchange', () => {
        const node = document.getSelection()?.anchorNode;
        const el = node?.nodeType === 1 ? node as Element : node?.parentElement ?? null;
        const pre = el?.closest?.('pre.mu-code-block.folio-swatched') ?? null;
        if (pre) {
            pre.classList.add('folio-editing');
            clearTimeout(hideTimer);
            return;
        }
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            const anchor = document.getSelection()?.anchorNode ?? null;
            for (const p of wrap.querySelectorAll('pre.folio-editing')) {
                if (!anchor || !p.contains(anchor)) p.classList.remove('folio-editing');
            }
        }, 150);
    });
}
