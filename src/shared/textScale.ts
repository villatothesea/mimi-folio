/**
 * 正文显示比例（工具栏 100%）。只放大 #doc-scroll 里的人读内容，侧栏不动。
 * 存 localStorage `folio-zoom`（以前误用在整页 html.zoom 上，读入后清掉）。
 */
export const TEXT_SCALE_KEY = 'folio-zoom';
export const TEXT_SCALE_DEFAULT = 1;
export const TEXT_SCALE_STEP = 0.1;
export const TEXT_SCALE_MIN = 0.5;
export const TEXT_SCALE_MAX = 2;

export function clampTextScale(value: number): number {
    const snapped = Math.round(value / TEXT_SCALE_STEP) * TEXT_SCALE_STEP;
    const clamped = Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, snapped));
    return Math.round(clamped * 100) / 100;
}

export function parseStoredScale(raw: string | null): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return TEXT_SCALE_DEFAULT;
    return clampTextScale(n);
}

export function formatTextScale(scale: number): string {
    return `${Math.round(clampTextScale(scale) * 100)}%`;
}

export function applyTextScale(scale: number): number {
    const next = clampTextScale(scale);
    document.documentElement.style.zoom = '';
    document.documentElement.style.setProperty('--folio-text-scale', String(next));
    localStorage.setItem(TEXT_SCALE_KEY, String(next));
    return next;
}

export function readTextScale(): number {
    return parseStoredScale(localStorage.getItem(TEXT_SCALE_KEY));
}

export function stepTextScale(deltaSteps: number): number {
    return applyTextScale(readTextScale() + deltaSteps * TEXT_SCALE_STEP);
}
