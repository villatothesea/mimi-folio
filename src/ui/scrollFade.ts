/**
 * 原生滚动条隐藏；自绘细条在上下滚动时淡入，静止后淡出。
 * 条用 fixed 叠在对应滚动区右侧，不跟内容滚走。
 */

type BarRec = {
    rail: HTMLElement;
    thumb: HTMLElement;
    timer: number;
    ro: ResizeObserver;
};

const bars = new WeakMap<HTMLElement, BarRec>();

function tokenPx(name: string, fallback: number): number {
    const n = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(n) ? n : fallback;
}

function tokenMs(name: string, fallback: number): number {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (raw.endsWith('ms')) {
        const n = Number.parseFloat(raw);
        return Number.isFinite(n) ? n : fallback;
    }
    if (raw.endsWith('s')) {
        const n = Number.parseFloat(raw);
        return Number.isFinite(n) ? n * 1000 : fallback;
    }
    return fallback;
}

function railWidth(el: HTMLElement): number {
    if (el.id === 'files') return tokenPx('--folio-files-scrollbar-size', 1);
    if (el.id === 'toc-list' || el.classList.contains('ctx-sub') || el.classList.contains('folio-modal-list')) return tokenPx('--folio-toc-scrollbar-size', 1);
    return tokenPx('--folio-scrollbar-size', 8);
}

function railEnd(el: HTMLElement): number {
    if (el.id === 'files') return tokenPx('--folio-files-scrollbar-end', 3);
    if (el.id === 'toc-list' || el.classList.contains('ctx-sub') || el.classList.contains('folio-modal-list')) return tokenPx('--folio-toc-scrollbar-end', 2);
    return tokenPx('--folio-scrollbar-end', 2);
}

function canScrollY(el: HTMLElement): boolean {
    return el.scrollHeight - el.clientHeight > 1;
}

function layout(el: HTMLElement, rail: HTMLElement, thumb: HTMLElement): void {
    if (!el.isConnected) return;
    const rect = el.getBoundingClientRect();
    const view = el.clientHeight;
    const all = el.scrollHeight;
    const w = railWidth(el);
    const end = railEnd(el);

    if (rect.width < 1 || rect.height < 1 || !canScrollY(el)) {
        thumb.style.height = '0px';
        thumb.style.transform = 'translateY(0px)';
        rail.style.visibility = 'hidden';
        return;
    }

    rail.style.visibility = 'visible';
    rail.style.width = `${w}px`;
    rail.style.height = `${rect.height}px`;
    rail.style.left = `${Math.round(rect.right - end - w)}px`;
    rail.style.top = `${Math.round(rect.top)}px`;

    const min = tokenPx('--folio-scrollbar-thumb-min', 12);
    const thumbH = Math.max(min, (view / all) * view);
    const maxTop = Math.max(0, view - thumbH);
    const range = all - view;
    const top = range <= 0 ? 0 : (el.scrollTop / range) * maxTop;
    thumb.style.height = `${thumbH}px`;
    thumb.style.transform = `translateY(${top}px)`;
}

function ensure(el: HTMLElement): BarRec {
    const existing = bars.get(el);
    if (existing?.rail.isConnected) return existing;

    el.classList.add('folio-scroll');
    el.dataset.folioSb = '1';

    const rail = document.createElement('div');
    rail.className = el.classList.contains('ctx-sub') || el.classList.contains('folio-modal-list') ? 'folio-sb is-float' : 'folio-sb';
    rail.dataset.scrollFor = el.id || el.className;
    rail.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('div');
    thumb.className = 'folio-sb-thumb';
    rail.append(thumb);
    document.body.append(rail);

    const rec: BarRec = {
        rail,
        thumb,
        timer: 0,
        ro: new ResizeObserver(() => layout(el, rail, thumb)),
    };
    rec.ro.observe(el);
    bars.set(el, rec);
    return rec;
}

function paint(el: HTMLElement): void {
    if (!canScrollY(el)) return;
    const rec = ensure(el);
    layout(el, rec.rail, rec.thumb);
    rec.rail.classList.add('is-on');
    window.clearTimeout(rec.timer);
    if (el.classList.contains('ctx-sub') || el.classList.contains('folio-modal-list')) return;
    rec.timer = window.setTimeout(() => rec.rail.classList.remove('is-on'), tokenMs('--folio-scrollbar-hide', 1000));
}

function onScroll(event: Event): void {
    const el = event.target;
    if (!(el instanceof HTMLElement) || el === document.body || el === document.documentElement) return;
    paint(el);
}

function relayoutAll(): void {
    document.querySelectorAll<HTMLElement>('[data-folio-sb="1"]').forEach((el) => {
        const rec = bars.get(el);
        if (rec) layout(el, rec.rail, rec.thumb);
    });
}

export function attachScrollFade(): void {
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', relayoutAll, { passive: true });
}

/** 弹出层刚显示时立刻画一条（不必等用户先滚一下）。 */
export function bindScrollFade(el: HTMLElement): void {
    paint(el);
}

export function unbindScrollFade(el: HTMLElement): void {
    const rec = bars.get(el);
    if (!rec) return;
    rec.ro.disconnect();
    window.clearTimeout(rec.timer);
    rec.rail.remove();
    bars.delete(el);
    delete el.dataset.folioSb;
    el.classList.remove('folio-scroll');
}
