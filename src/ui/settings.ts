/**
 * 设置弹窗（验收清单 7）：顶部居中 + 灰蒙层，左项目右内容。
 * 默认格式 = 编号系统开关（CSS counters，见 app.css）；特殊格式 = 加粗/编号/代码色板；
 * 主题 = 页面色卡 + 文字主题 JSON。选择存 localStorage，只挂 html data-* / 覆写 --folio-*。
 */
import type { FolioFileAssoc } from '../host/types.ts';
import { htmlPreviewScriptsEnabled, setHtmlPreviewScriptsEnabled } from '../shared/htmlPreview.ts';
import {
    DEFAULT_SPECIAL,
    PALETTE_KEYS,
    PALETTE_LABELS,
    SPECIAL_ROLES,
    mergeSpecial,
    paletteVar,
    specialCssVars,
    type SpecialFmt,
} from '../shared/specialFmt.ts';
import { icon } from './icons';
import { lockAppOverlay } from './overlayLock.ts';

export type HeadNum = 'none' | 'outline' | 'cjk' | 'cjk-paren' | 'dec' | 'dec-paren' | 'dot' | 'paren';
export type BodyNum = 'none' | 'cjk' | 'cjk-paren' | 'dec-paren' | 'dot' | 'paren';

export type FmtSettings = {
    numHead: HeadNum;
    numBody: BodyNum;
    ul: ('disc' | 'circle' | 'square' | 'dash' | 'star' | 'plus')[];
};

export type TypeTheme = {
    em?: string;
    strong?: string;
    del?: string;
    marker?: string;
    h1?: string;
    h2?: string;
    h3?: string;
    codeBg?: string;
    inlineCodeBg?: string;
};

const FMT_KEY = 'folio-fmt';
const TYPE_KEY = 'folio-type';
const ACCENT_KEY = 'folio-accent';
const SPECIAL_KEY = 'folio-special';

const DEFAULT_FMT: FmtSettings = { numHead: 'none', numBody: 'none', ul: ['disc', 'circle', 'square'] };

/** 页面色卡：单色 hue，实时覆写面板类 token（米米主题的单色化版本）。 */
const ACCENTS: Record<string, { label: string; h: number | null }> = {
    stone: { label: '石墨', h: null },
    sand: { label: '暖砂', h: 30 },
    blue: { label: '黛蓝', h: 215 },
    green: { label: '苔绿', h: 145 },
    plum: { label: '绛紫', h: 320 },
};

function readJSON<T>(key: string, fallback: T): T {
    try {
        return { ...fallback, ...(JSON.parse(localStorage.getItem(key) ?? '{}') as T) };
    } catch {
        return fallback;
    }
}

export function applyFmt(fmt: FmtSettings): void {
    const html = document.documentElement;
    html.dataset.numH = fmt.numHead;
    html.dataset.numB = fmt.numBody;
    for (let i = 0; i < 3; i++) html.dataset[`ul${i + 1}`] = fmt.ul[i] ?? 'disc';
}

export function applyType(theme: TypeTheme): void {
    const root = document.documentElement.style;
    const map: Array<[keyof TypeTheme, string]> = [
        ['em', '--folio-fg-em'],
        ['strong', '--folio-fg-strong'],
        ['del', '--folio-fg-del'],
        ['marker', '--folio-fg-marker'],
        ['h1', '--folio-fg-h1'],
        ['h2', '--folio-fg-h2'],
        ['h3', '--folio-fg-h3'],
        ['codeBg', '--folio-code-bg'],
        ['inlineCodeBg', '--folio-inline-code-bg'],
    ];
    for (const [k, cssVar] of map) root.setProperty(cssVar, theme[k] || '');
}

export function applySpecial(cfg: SpecialFmt): void {
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(specialCssVars(cfg))) root.setProperty(k, v);
}

function readSpecial(): SpecialFmt {
    try {
        return mergeSpecial(JSON.parse(localStorage.getItem(SPECIAL_KEY) ?? 'null'));
    } catch {
        return DEFAULT_SPECIAL;
    }
}

function persistSpecial(cfg: SpecialFmt): void {
    localStorage.setItem(SPECIAL_KEY, JSON.stringify(cfg));
    applySpecial(cfg);
}

export function applyAccent(key: string): void {
    const root = document.documentElement.style;
    const acc = ACCENTS[key];
    if (!acc || acc.h === null) {
        for (const v of ['--folio-panel', '--folio-bg-alt', '--folio-hover', '--folio-hover-active', '--folio-selection', '--folio-border', '--folio-border-strong', '--folio-primary']) root.removeProperty(v);
        return;
    }
    const h = acc.h;
    root.setProperty('--folio-panel', `hsl(${h} 18% 95%)`);
    root.setProperty('--folio-bg-alt', `hsl(${h} 16% 93%)`);
    root.setProperty('--folio-hover', `hsl(${h} 18% 90%)`);
    root.setProperty('--folio-hover-active', `hsl(${h} 20% 86%)`);
    root.setProperty('--folio-selection', `hsl(${h} 25% 85%)`);
    root.setProperty('--folio-border', `hsl(${h} 12% 82%)`);
    root.setProperty('--folio-border-strong', `hsl(${h} 12% 65%)`);
    root.setProperty('--folio-primary', `hsl(${h} 30% 32%)`);
}

export function initSettings(): void {
    applyFmt(readJSON(FMT_KEY, DEFAULT_FMT));
    applyType(readJSON(TYPE_KEY, {}));
    applySpecial(readSpecial());
    applyAccent(localStorage.getItem(ACCENT_KEY) ?? 'stone');
}

function select(label: string, options: Array<[string, string]>, value: string, onChange: (v: string) => void): HTMLLabelElement {
    const row = document.createElement('label');
    row.className = 'set-row';
    const span = document.createElement('span');
    span.textContent = label;
    const sel = document.createElement('select');
    for (const [v, text] of options) {
        const option = document.createElement('option');
        option.value = v;
        option.textContent = text;
        sel.append(option);
    }
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    row.append(span, sel);
    return row;
}

/** 库 = vault 下固定的子目录；count 为 null 表示该库不是文档目录（数不出来）。 */
export type VaultInfo = {
    vault: { name: string; dir: string };
    libraries: { label: string; dir: string; count: number | null }[];
    /** 桌面壳才有：.md 默认程序的状态探测与注册；没有就当浏览器模式隐藏按钮。 */
    fileAssoc?: {
        status(): Promise<FolioFileAssoc>;
        register(): Promise<FolioFileAssoc>;
    };
};

export function openSettings(info?: VaultInfo): void {
    document.querySelector('#settings-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'settings-overlay';

    const panel = document.createElement('div');
    panel.className = 'settings-panel';

    // 左：设置项目
    const nav = document.createElement('nav');
    nav.className = 'settings-nav';
    const content = document.createElement('div');
    content.className = 'settings-content';

    const sections: Array<[string, () => void]> = [];
    const addSection = (name: string, build: () => void) => sections.push([name, build]);
    const unlockApp = lockAppOverlay();
    const close = () => {
        overlay.remove();
        unlockApp();
    };

    addSection('默认格式', () => {
        const fmt = readJSON(FMT_KEY, DEFAULT_FMT);
        const box = document.createElement('div');
        const headOpts: Array<[string, string]> = [
            ['none', '不编号'],
            ['outline', '一、（一）1.（1）大纲'],
            ['cjk', '一、二、三'],
            ['cjk-paren', '（一）（二）（三）'],
            ['dec', '1. 2. 3.'],
            ['dec-paren', '（1）（2）（3）'],
            ['dot', '1. / 1.1 / 1.1.1'],
            ['paren', '(1) (1.1) 半角括号'],
        ];
        const bodyOpts: Array<[string, string]> = [
            ['none', '默认（1. 2. 3.）'],
            ['cjk', '一、二、三'],
            ['cjk-paren', '（一）（二）（三）'],
            ['dec-paren', '（1）（2）（3）'],
            ['dot', '1.1 多级'],
            ['paren', '(1.1) 半角括号'],
        ];
        const ulOpts: Array<[string, string]> = [['disc', '● 实心圆'], ['circle', '○ 空心圆'], ['square', '■ 方块'], ['dash', '– 短横'], ['star', '* 星号'], ['plus', '+ 加号']];
        box.append(select('有序编号 · 标题', headOpts, fmt.numHead, (v) => {
            fmt.numHead = v as FmtSettings['numHead'];
            localStorage.setItem(FMT_KEY, JSON.stringify(fmt));
            applyFmt(fmt);
        }));
        box.append(select('有序编号 · 正文', bodyOpts, fmt.numBody, (v) => {
            fmt.numBody = v as FmtSettings['numBody'];
            localStorage.setItem(FMT_KEY, JSON.stringify(fmt));
            applyFmt(fmt);
        }));
        box.append(select('无序编号 · 一级', ulOpts, fmt.ul[0], (v) => {
            fmt.ul[0] = v as FmtSettings['ul'][number];
            localStorage.setItem(FMT_KEY, JSON.stringify(fmt));
            applyFmt(fmt);
        }));
        box.append(select('无序编号 · 二级', ulOpts, fmt.ul[1], (v) => {
            fmt.ul[1] = v as FmtSettings['ul'][number];
            localStorage.setItem(FMT_KEY, JSON.stringify(fmt));
            applyFmt(fmt);
        }));
        box.append(select('无序编号 · 三级', ulOpts, fmt.ul[2], (v) => {
            fmt.ul[2] = v as FmtSettings['ul'][number];
            localStorage.setItem(FMT_KEY, JSON.stringify(fmt));
            applyFmt(fmt);
        }));
        box.append(select('页面宽度', [['std', '标准（800 固定列宽）'], ['wide', '加宽（距两侧 10px）']], localStorage.getItem('folio-width') ?? 'std', (v) => {
            localStorage.setItem('folio-width', v);
            document.documentElement.dataset.width = v;
        }));
        if ((localStorage.getItem('folio-width') ?? 'std') === 'wide') document.documentElement.dataset.width = 'wide';
        const note = document.createElement('p');
        note.className = 'set-note';
        note.textContent = '编号是渲染层样式，md 落盘仍是标准语法；Alt+1..6 快速设标题层级。';
        box.append(note);
        content.replaceChildren(box);
    });

    addSection('特殊格式', () => {
        const cfg = readSpecial();
        const box = document.createElement('div');
        const title = document.createElement('p');
        title.className = 'set-group-title';
        title.textContent = '加粗、斜体、编号、代码的颜色';
        box.append(title);

        const rows = document.createElement('div');
        for (const [role, label] of SPECIAL_ROLES) {
            const row = document.createElement('div');
            row.className = 'set-fmt-row';
            const name = document.createElement('span');
            name.textContent = label;
            const dots = document.createElement('div');
            dots.className = 'set-fmt-swatches';
            dots.setAttribute('role', 'group');
            dots.setAttribute('aria-label', label);
            for (const key of PALETTE_KEYS) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'set-fmt-dot';
                b.title = PALETTE_LABELS[key];
                b.setAttribute('aria-label', PALETTE_LABELS[key]);
                if (cfg[role] === key) b.setAttribute('aria-pressed', 'true');
                b.style.setProperty('--swatch', paletteVar(key));
                b.addEventListener('click', () => {
                    cfg[role] = key;
                    persistSpecial(cfg);
                    dots.querySelectorAll('button').forEach((x) => x.removeAttribute('aria-pressed'));
                    b.setAttribute('aria-pressed', 'true');
                });
                dots.append(b);
            }
            row.append(name, dots);
            rows.append(row);
        }
        box.append(rows);

        const preview = document.createElement('div');
        preview.className = 'set-fmt-preview';
        const strong = document.createElement('strong');
        strong.textContent = '加粗';
        const em = document.createElement('em');
        em.textContent = '斜体';
        const num = document.createElement('span');
        num.className = 'set-fmt-num';
        num.textContent = '1. 编号';
        const code = document.createElement('code');
        code.textContent = '行内代码';
        const pre = document.createElement('pre');
        pre.className = 'set-fmt-codeblock';
        pre.textContent = '代码块';
        preview.append(strong, document.createTextNode(' '), em, document.createTextNode(' '), num, document.createTextNode(' '), code, pre);
        box.append(preview);

        const actions = document.createElement('div');
        actions.className = 'set-actions';
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.textContent = '恢复默认';
        reset.addEventListener('click', () => {
            const next = { ...DEFAULT_SPECIAL };
            persistSpecial(next);
            Object.assign(cfg, next);
            for (const [i, [role]] of SPECIAL_ROLES.entries()) {
                const dots = rows.children[i]?.querySelectorAll('button');
                dots?.forEach((btn, j) => {
                    if (PALETTE_KEYS[j] === next[role]) btn.setAttribute('aria-pressed', 'true');
                    else btn.removeAttribute('aria-pressed');
                });
            }
        });
        actions.append(reset);
        box.append(actions);
        const hint = document.createElement('p');
        hint.className = 'set-note';
        hint.textContent = '只改显示颜色，md 落盘仍是普通加粗/代码。色值在主题 token，这里只选色板。';
        box.append(hint);
        content.replaceChildren(box);
    });

    addSection('主题', () => {
        const box = document.createElement('div');
        const label1 = document.createElement('p');
        label1.className = 'set-group-title';
        label1.textContent = '页面主题（面板色，实时生效）';
        box.append(label1);
        const swatches = document.createElement('div');
        swatches.className = 'set-swatches';
        const current = localStorage.getItem(ACCENT_KEY) ?? 'stone';
        for (const [key, acc] of Object.entries(ACCENTS)) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'set-swatch';
            if (key === current) b.setAttribute('aria-pressed', 'true');
            b.textContent = acc.label;
            if (acc.h !== null) b.style.setProperty('--swatch', `hsl(${acc.h} 25% 70%)`);
            else b.style.setProperty('--swatch', 'var(--folio-fg-muted)');
            b.addEventListener('click', () => {
                localStorage.setItem(ACCENT_KEY, key);
                applyAccent(key);
                swatches.querySelectorAll('button').forEach((x) => x.removeAttribute('aria-pressed'));
                b.setAttribute('aria-pressed', 'true');
            });
            swatches.append(b);
        }
        box.append(swatches);

        const label2 = document.createElement('p');
        label2.className = 'set-group-title';
        label2.textContent = '文字主题（JSON，颜色留空 = 继承）';
        box.append(label2);
        const ta = document.createElement('textarea');
        ta.className = 'set-json';
        ta.spellcheck = false;
        ta.value = JSON.stringify(readJSON(TYPE_KEY, {} as TypeTheme), null, 2);
        box.append(ta);
        const applyRow = document.createElement('div');
        applyRow.className = 'set-actions';
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.textContent = '应用';
        applyBtn.addEventListener('click', () => {
            try {
                const theme = JSON.parse(ta.value || '{}') as TypeTheme;
                localStorage.setItem(TYPE_KEY, JSON.stringify(theme));
                applyType(theme);
                applySpecial(readSpecial());
            } catch {
                ta.classList.add('set-json-bad');
                setTimeout(() => ta.classList.remove('set-json-bad'), 600);
            }
        });
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.textContent = '重置';
        resetBtn.addEventListener('click', () => {
            ta.value = '{}';
            localStorage.removeItem(TYPE_KEY);
            applyType({});
            applySpecial(readSpecial());
        });
        applyRow.append(applyBtn, resetBtn);
        box.append(applyRow);
        const keys = document.createElement('p');
        keys.className = 'set-note';
        keys.textContent = '可用键：del h1 h2 h3（值为色值）。加粗/斜体/编号/代码请到「特殊格式」。';
        box.append(keys);
        content.replaceChildren(box);
    });

    addSection('网页预览', () => {
        const box = document.createElement('div');
        const row = document.createElement('label');
        row.className = 'set-row';
        const span = document.createElement('span');
        span.textContent = '允许预览页运行脚本';
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = htmlPreviewScriptsEnabled();
        check.addEventListener('change', () => {
            setHtmlPreviewScriptsEnabled(check.checked);
            window.dispatchEvent(new Event('folio-html-scripts'));
        });
        row.append(span, check);
        const note = document.createElement('p');
        note.className = 'set-note';
        note.textContent = '默认开启，接近用浏览器打开这份 html。脚本跑在沙箱里，摸不到米素界面和笔记库；仍可能访问外网、弹窗、占资源。不信任的页面请关掉。';
        box.append(row, note);
        content.replaceChildren(box);
    });

    addSection('库', () => {
        const box = document.createElement('div');
        const head = document.createElement('p');
        head.className = 'set-group-title';
        head.textContent = info?.vault.name ? `当前工作区：${info.vault.name}` : '当前工作区';
        box.append(head);
        const table = document.createElement('table');
        table.className = 'set-libs';
        for (const lib of info?.libraries ?? []) {
            const tr = document.createElement('tr');
            const name = document.createElement('td');
            name.textContent = lib.label;
            const dir = document.createElement('td');
            dir.textContent = lib.dir;
            const count = document.createElement('td');
            count.textContent = lib.count === null ? '—' : `${lib.count} 篇`;
            tr.append(name, dir, count);
            table.append(tr);
        }
        box.append(table);
        const note = document.createElement('p');
        note.className = 'set-note';
        note.textContent = '库 = vault 下的固定子目录：长文写进 notes/，速记写进 memos/，库外文件链进 links/，图片附件分别落 pics/ 与 attachments/。';
        if (info?.vault.dir) note.textContent += ` 当前 vault：${info.vault.dir}`;
        box.append(note);
        content.replaceChildren(box);
    });

    addSection('系统', () => {
        const box = document.createElement('div');
        const head = document.createElement('p');
        head.className = 'set-group-title';
        head.textContent = '双击 .md 用米素打开';
        const status = document.createElement('p');
        status.className = 'set-note';
        status.textContent = '正在读取当前关联…';
        const actions = document.createElement('div');
        actions.className = 'set-actions';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '设为默认打开方式';
        actions.append(btn);
        const hint = document.createElement('p');
        hint.className = 'set-note';
        hint.textContent = '写入注册表立即生效，不用管理员。若 .md 已默认给别的程序，Windows 会要求到「设置 → 默认应用」里再确认一步——按钮会直接把那页打开。';
        box.append(head, status, actions, hint);

        const render = (s: FolioFileAssoc | undefined) => {
            if (!s?.supported) {
                status.textContent = '仅桌面版（mimi-folio.exe）可用。';
                btn.disabled = true;
                return;
            }
            if (s.isDefault) {
                status.textContent = '当前状态：已是 .md 默认打开方式。';
            } else if (s.registered) {
                status.textContent = '关联已写入；系统里 .md 还指向别的程序，请在刚打开的系统「默认应用」页里把它选为米素 Folio。';
            } else {
                status.textContent = '当前状态：未设为默认。';
            }
        };
        if (info?.fileAssoc) {
            void info.fileAssoc.status().then(render).catch(() => {
                status.textContent = '读取关联状态失败。';
            });
        } else {
            render(undefined);
        }
        btn.addEventListener('click', async () => {
            const assoc = info?.fileAssoc;
            if (!assoc) return;
            btn.disabled = true;
            try {
                render(await assoc.register());
            } catch (err) {
                status.textContent = `注册失败：${err instanceof Error ? err.message : String(err)}`;
            } finally {
                btn.disabled = !info?.fileAssoc;
            }
        });
        content.replaceChildren(box);
    });

    addSection('关于', () => {
        const box = document.createElement('div');
        box.className = 'about';
        box.innerHTML = `
<p class="about-title">米素 <span>folio</span></p>
<p>米米的记忆底座：人看、米米整理的本地 markdown 系统。预览即编辑，落盘仍是 .md。</p>
<table>
<tr><td>编辑核</td><td><a href="https://github.com/marktext/marktext" target="_blank" rel="noopener noreferrer">Muya（@muyajs/core）</a></td><td>MIT</td></tr>
<tr><td>速记交互</td><td><a href="https://github.com/usememos/memos" target="_blank" rel="noopener noreferrer">Memos</a></td><td>MIT</td></tr>
<tr><td>图标</td><td><a href="https://tabler.io/icons" target="_blank" rel="noopener noreferrer">Tabler Icons</a></td><td>MIT</td></tr>
<tr><td>构建</td><td>Vite · TypeScript</td><td>MIT / Apache-2.0</td></tr>
</table>
<p class="set-note">速记看法参照 Memos 官方交互（左栏日历筛日、中区卡片流），未嵌其代码。感谢以上开源库的贡献者。</p>`;
        content.replaceChildren(box);
    });

    for (const [name, build] of sections) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = name;
        b.addEventListener('click', () => {
            nav.querySelectorAll('button').forEach((x) => x.removeAttribute('aria-current'));
            b.setAttribute('aria-current', 'true');
            build();
        });
        nav.append(b);
    }
    sections[0][1]();
    nav.querySelector('button')?.setAttribute('aria-current', 'true');

    const head = document.createElement('div');
    head.className = 'settings-head';
    head.append(Object.assign(document.createElement('span'), { textContent: '设置' }));
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'icon-btn';
    x.innerHTML = icon('x');
    x.addEventListener('click', close);
    head.append(x);

    const body = document.createElement('div');
    body.className = 'settings-body';
    body.append(nav, content);
    panel.append(head, body);
    overlay.append(panel);
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) close();
    });
    document.body.append(overlay);
}
