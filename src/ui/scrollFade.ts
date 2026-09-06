/**
 * 原生滚动条隐藏；自绘细条在上下滚动时淡入，静止后淡出。
 * 条叠在内容上，不占栏宽。
 */

const bars = new WeakMap<HTMLElement, { rail: HTMLElement; thumb: HTMLElement; timer: number }>();

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

function canScrollY(el: HTMLElement): boolean {
    return el.scrollHeight - el.clientHeight > 1;
}

function layout(el: HTMLElement, rail: HTMLElement, thumb: HTMLElement): void {
    const view = el.clientHeight;
    const all = el.scrollHeight;
    rail.style.top = `${el.scrollTop}px`;
    rail.style.height = `${view}px`;
    if (all <= view) {
        thumb.style.height = '0px';
        return;
    }
    const min = tokenPx('--folio-scrollbar-thumb-min', 12);
    const thumbH = Math.max(min, Math.round((view / all) * view));
    const maxTop = Math.max(0, view - thumbH);
    const range = all - view;
    const top = range <= 0 ? 0 : Math.round((el.scrollTop / range) * maxTop);
    thumb.style.height = `${thumbH}px`;
    thumb.style.top = `${top}px`;
}

function ensure(el: HTMLElement): { rail: HTMLElement; thumb: HTMLElement; timer: number } {
    const existing = bars.get(el);
    if (existing?.rail.isConnected) return existing;
    el.classList.add('folio-scroll');
    const rail = document.createElement('div');
    rail.className = 'folio-sb';
    rail.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('div');
    thumb.className = 'folio-sb-thumb';
    rail.append(thumb);
    el.append(rail);
    const rec = { rail, thumb, timer: 0 };
    bars.set(el, rec);
    return rec;
}

function onScroll(event: Event): void {
    const el = event.target;
    if (!(el instanceof HTMLElement) || el === document.body || el === document.documentElement) return;
    if (!canScrollY(el)) return;
    const rec = ensure(el);
    layout(el, rec.rail, rec.thumb);
    rec.rail.classList.add('is-on');
    window.clearTimeout(rec.timer);
    rec.timer = window.setTimeout(() => rec.rail.classList.remove('is-on'), tokenMs('--folio-scrollbar-hide', 1000));
}

export function attachScrollFade(): void {
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
}
