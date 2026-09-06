/**
 * 正文显示比例（工具栏 100%）。只作用在 #doc-scroll 里的人读内容，侧栏不动。
 * 放大：CSS zoom（整栏变宽，维持原行为）。缩小：只缩字号，栏宽和位置不动。
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

/** 放大才用 zoom；缩小保持 1，避免栏变窄、往右挪。 */
export function textScaleZoom(scale: number): number {
    const s = clampTextScale(scale);
    return s >= 1 ? s : 1;
}

/** 缩小才缩字号；放大保持 1，避免和 zoom 叠乘。 */
export function textScaleFont(scale: number): number {
    const s = clampTextScale(scale);
    return s < 1 ? s : 1;
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
    document.documentElement.style.setProperty('--folio-text-zoom', String(textScaleZoom(next)));
    document.documentElement.style.setProperty('--folio-text-font', String(textScaleFont(next)));
    document.documentElement.style.removeProperty('--folio-text-scale');
    document.documentElement.style.removeProperty('--folio-text-scale-width');
    localStorage.setItem(TEXT_SCALE_KEY, String(next));
    return next;
}

export function readTextScale(): number {
    return parseStoredScale(localStorage.getItem(TEXT_SCALE_KEY));
}

export function stepTextScale(deltaSteps: number): number {
    return applyTextScale(readTextScale() + deltaSteps * TEXT_SCALE_STEP);
}
