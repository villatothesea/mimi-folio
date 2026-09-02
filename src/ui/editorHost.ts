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
use(ImageEditTool, {});
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

export function currentEditor(): TMuya | null {
    return muya;
}

/** 挂载一篇 markdown；muya 会替换传入元素，故每次重建壳元素。 */
export function mountEditor(wrap: HTMLElement, markdown: string, onChange: (markdown: string) => void): void {
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
    });
    editor.locale(zhCN);
    editor.init();
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
