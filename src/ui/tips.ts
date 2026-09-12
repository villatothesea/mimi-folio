/**
 * 全局 tooltip：挂在 body 上用 fixed，避开工具栏/flex 子项把 ::after 裁掉。
 */
const GAP = 6;
const EDGE = 8;

let tip: HTMLDivElement | null = null;
let current: HTMLElement | null = null;

function ensureTip(): HTMLDivElement {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.id = 'folio-tip';
    tip.hidden = true;
    document.body.append(tip);
    return tip;
}

function hideTip(): void {
    if (!tip) return;
    tip.hidden = true;
    current = null;
}

function preferBelow(el: HTMLElement): boolean {
    return Boolean(el.closest('#toolbar, #page-head, #sidebar-head, #bar-left-actions, #toc-host, #expand-hints'));
}

function place(el: HTMLElement): void {
    const node = ensureTip();
    const text = el.dataset.tip?.trim();
    if (!text) {
        hideTip();
        return;
    }
    current = el;
    node.textContent = text;
    node.hidden = false;
    const rect = el.getBoundingClientRect();
    const tw = node.offsetWidth;
    const th = node.offsetHeight;
    const below = preferBelow(el) || el.dataset.tipSide === 'below';
    let top = below ? rect.bottom + GAP : rect.top - th - GAP;
    if (top + th > window.innerHeight - EDGE) top = rect.top - th - GAP;
    if (top < EDGE) top = rect.bottom + GAP;
    let left = rect.left + rect.width / 2 - tw / 2;
    if (el.dataset.tipAlign === 'start') left = rect.left;
    else if (el.id === 'toc-fab' || el.closest('#toc-host')) left = rect.right - tw;
    left = Math.min(window.innerWidth - tw - EDGE, Math.max(EDGE, left));
    node.style.top = `${Math.round(top)}px`;
    node.style.left = `${Math.round(left)}px`;
}

export function attachTips(): void {
    ensureTip();
    document.addEventListener('pointerover', (event) => {
        const el = (event.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null;
        if (!el?.dataset.tip) return;
        if (el === current) return;
        place(el);
    });
    document.addEventListener('pointerout', (event) => {
        if (!current) return;
        const next = (event.relatedTarget as Element | null)?.closest?.('[data-tip]');
        if (next === current) return;
        hideTip();
    });
    document.addEventListener('pointerdown', hideTip);
    window.addEventListener('scroll', hideTip, true);
}