import {
    CodeBlockLanguageSelector,
    EmojiSelector,
    FootnoteTool,
    ImageEditTool,
    ImageResizeBar,
    ImageToolBar,
    InlineFormatToolbar,
    LinkTools,
    Muya,
    ParagraphFrontButton,
    ParagraphFrontMenu,
    ParagraphQuickInsertMenu,
    PreviewToolBar,
    TableChessboard,
    TableColumnToolbar,
    TableDragBar,
    TableRowColumMenu,
    zhCN,
} from '@muyajs/core';
import type { Muya as TMuya } from '@muyajs/core';
import { MENU_CONFIG } from '@muyajs/core/ui/paragraphQuickInsertMenu/config.ts';

import type { FolioHost } from '../host/types.ts';
import { splitFrontmatter } from '../shared/frontmatter.ts';
import '../theme/muya.css';

/**
 * 单元 2：斜杠菜单裁剪与内容开关（AGENTS.md 硬规则 5：默认不出网、开放 HTML 不进斜杠）。
 * MENU_CONFIG 是 muya 模块级常量，ParagraphQuickInsertMenu 构造时引用同一份，
 * 在注册插件前原地剔除即可，不改 muya 源码。
 */
const BANNED_LABELS = new Set(['html-block', 'diagram plantuml']);
for (const group of MENU_CONFIG) {
    group.children = group.children.filter((item) => !BANNED_LABELS.has(item.label));
}
for (let i = MENU_CONFIG.length - 1; i >= 0; i--) {
    if (MENU_CONFIG[i].children.length === 0) MENU_CONFIG.splice(i, 1);
}

/**
 * Muya 宿主：注册 UI 插件（examples/main.ts 是权威接线）、挂载/重建编辑器、
 * 把内容变化抛给 app 层存盘。单元 2 在此叠菜单裁剪与开关，单元 4 叠 imageAction。
 */

/** 一次注册即可（静态注册表，作用于所有实例）。 */
// TS7 对部分 muya 插件构造器/静态字段的推断比 TS6 严，这里统一收口 cast。
function use(plugin: unknown, options: Record<string, unknown> = {}): void {
    Muya.use(plugin as Parameters<typeof Muya.use>[0], options);
}

use(EmojiSelector);
use(FootnoteTool);
use(InlineFormatToolbar);
use(ImageEditTool, { imagePathPicker: pickImageFile });
use(ImageToolBar);
use(ImageResizeBar);
use(CodeBlockLanguageSelector);
use(LinkTools, {
    jumpClick: (linkInfo: { href?: string } | null) => {
        const href = linkInfo?.href;
        if (href && /^https?:\/\//.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
    },
});
use(ParagraphFrontButton);
use(ParagraphFrontMenu);
use(ParagraphQuickInsertMenu);
use(TableChessboard);
use(TableColumnToolbar);
use(TableDragBar);
use(TableRowColumMenu);
use(PreviewToolBar);

let muya: TMuya | null = null;
/** 图片选择器落盘用的 host（mountEditor 时更新）。 */
let mediaHost: FolioHost | null = null;

/** 浏览器文件选择框 → host.saveImage 落盘 → 回相对路径（muya 直接写进 md）。 */
function pickImageFile(): Promise<string> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('cancel', () => resolve(''));
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file || !mediaHost) return resolve('');
            try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                const { src } = await mediaHost.saveImage(bytes, file.name);
                resolve(src);
            } catch {
                resolve('');
            }
        });
        input.click();
    });
}

export function currentEditor(): TMuya | null {
    return muya;
}

/** 挂载一篇 markdown；muya 会替换传入元素，故每次重建壳元素。 */
export function mountEditor(wrap: HTMLElement, markdown: string, host: FolioHost, onChange: (markdown: string) => void): void {
    mediaHost = host;
    const fresh = document.createElement('div');
    wrap.replaceChildren(fresh);
    const editor = new Muya(fresh, {
        markdown,
        // 内容开关：数学/Mermaid/脚注/frontmatter 开；PlantUML 指向死地址，杜绝公网
        math: true,
        frontMatter: true,
        footnote: true,
        disableHtml: false,
        plantumlServer: 'http://127.0.0.1:9',
        mermaidTheme: 'default',
        vegaTheme: 'latimes',
        // 粘贴/拖放的位图经此落盘（单元 4），md 里只留相对路径
        imageAction: async (state) => {
            if (!state.src.startsWith('data:')) return state.src;
            const bytes = new Uint8Array(await (await fetch(state.src)).arrayBuffer());
            const hint = state.alt || state.title || `image-${Date.now()}.png`;
            const { src } = await host.saveImage(bytes, hint);
            return src;
        },
    });
    editor.locale(zhCN);
    editor.init();
    focusEditorBody(editor);
    editor.on('json-change', () => {
        if (muya === editor) onChange(editor.getMarkdown());
    });
    muya = editor;
    // 供自动化测试与调试用
    (window as unknown as { __muya?: TMuya }).__muya = editor;
}

export function destroyEditor(): void {
    muya?.destroy();
    muya = null;
}

type ContentLeaf = {
    blockName?: string;
    parent?: ContentLeaf | null;
    setCursor: (start: number, end: number, keep: boolean) => void;
    nextContentInContext?: () => ContentLeaf | null;
};

function isInsideFrontmatter(leaf: ContentLeaf): boolean {
    for (let node: ContentLeaf | null | undefined = leaf; node; node = node.parent) {
        if (node.blockName === 'frontmatter') return true;
    }
    return false;
}

function firstBodyLeaf(editor: TMuya): ContentLeaf | null {
    const page = (editor as unknown as { editor?: { scrollPage?: { firstContentInDescendant?: () => ContentLeaf | null } } }).editor?.scrollPage;
    let leaf = page?.firstContentInDescendant?.() ?? null;
    while (leaf && isInsideFrontmatter(leaf)) leaf = leaf.nextContentInContext?.() ?? null;
    return leaf;
}

/** YAML 在视图里 display:none，光标不能停在里面，否则粘贴进隐藏块、正文看起来没进去。 */
export function focusEditorBody(editor: TMuya): void {
    firstBodyLeaf(editor)?.setCursor(0, 0, true);
}

export function selectionInFrontmatter(editor: TMuya): boolean {
    const sel = (editor as unknown as { editor?: { selection?: { getSelection?: () => { anchor?: { block?: ContentLeaf } } | null } } }).editor?.selection?.getSelection?.();
    const block = sel?.anchor?.block;
    return block ? isInsideFrontmatter(block) : false;
}

type MuyaClip = { pasteHandler: (event: ClipboardEvent, text?: string, html?: string) => Promise<void> };

/** 把 markdown 源插进正文。有粘贴事件就走 Muya 管道（空 html，避免 GitHub 的残缺 HTML）；否则拼进当前篇。 */
export function insertMarkdown(editor: TMuya, text: string, event?: ClipboardEvent): void {
    if (selectionInFrontmatter(editor)) focusEditorBody(editor);
    const clip = (editor as unknown as { editor?: { clipboard?: MuyaClip } }).editor?.clipboard;
    if (clip && event?.clipboardData && !selectionInFrontmatter(editor)) {
        void clip.pasteHandler(event, text, '');
        return;
    }
    const cur = splitFrontmatter(editor.getMarkdown());
    const incoming = splitFrontmatter(text);
    const article = (incoming.body.trim() ? incoming.body : text).replace(/^\n+/, '');
    const yaml = cur.frontmatter ? `---\n${cur.frontmatter}\n---\n\n` : '';
    const existing = cur.body.replace(/^\n+/, '').replace(/\n+$/, '');
    const mid = existing ? `${existing}\n\n` : '';
    editor.replaceContent(yaml + mid + article);
}
