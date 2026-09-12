/**
 * 特殊格式色：加粗 / 斜体 / 编号 / 行内代码 / 代码块。
 * 色值只在 tokens.css 的 --folio-palette-*；这里只记色板 key。
 */
export const PALETTE_KEYS = [
    'warm-red',
    'orange-red',
    'base-yellow',
    'light-green',
    'cyan-blue',
    'light-blue',
    'soft-purple',
] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];

export const PALETTE_LABELS: Record<PaletteKey, string> = {
    'warm-red': '暖红',
    'orange-red': '橙红',
    'base-yellow': '基黄',
    'light-green': '浅绿',
    'cyan-blue': '青蓝',
    'light-blue': '浅蓝',
    'soft-purple': '柔紫',
};

export type SpecialFmt = {
    strong: PaletteKey;
    em: PaletteKey;
    marker: PaletteKey;
    inlineCode: PaletteKey;
    codeBlock: PaletteKey;
};

export const DEFAULT_SPECIAL: SpecialFmt = {
    strong: 'warm-red',
    em: 'orange-red',
    marker: 'light-blue',
    inlineCode: 'cyan-blue',
    codeBlock: 'soft-purple',
};

export const SPECIAL_ROLES: Array<[keyof SpecialFmt, string]> = [
    ['strong', '加粗'],
    ['em', '斜体'],
    ['marker', '编号'],
    ['inlineCode', '行内代码'],
    ['codeBlock', '代码块'],
];

export function isPaletteKey(v: unknown): v is PaletteKey {
    return typeof v === 'string' && (PALETTE_KEYS as readonly string[]).includes(v);
}

export function mergeSpecial(raw: unknown): SpecialFmt {
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const pick = (k: keyof SpecialFmt): PaletteKey => (isPaletteKey(o[k]) ? o[k] : DEFAULT_SPECIAL[k]);
    return {
        strong: pick('strong'),
        em: pick('em'),
        marker: pick('marker'),
        inlineCode: pick('inlineCode'),
        codeBlock: pick('codeBlock'),
    };
}

export function paletteVar(key: PaletteKey): string {
    return `var(--folio-palette-${key})`;
}

/** 写到 html 上的 CSS 变量（值仍是 var()/color-mix，不含 hex）。 */
export function specialCssVars(cfg: SpecialFmt): Record<string, string> {
    const inline = paletteVar(cfg.inlineCode);
    const block = paletteVar(cfg.codeBlock);
    return {
        '--folio-fg-strong': paletteVar(cfg.strong),
        '--folio-fg-em': paletteVar(cfg.em),
        '--folio-fg-marker': paletteVar(cfg.marker),
        '--folio-fg-inline-code': inline,
        '--folio-inline-code-bg': `color-mix(in srgb, ${inline} 16%, var(--folio-bg))`,
        '--folio-code-bg': `color-mix(in srgb, ${block} 14%, var(--folio-bg-alt))`,
    };
}
