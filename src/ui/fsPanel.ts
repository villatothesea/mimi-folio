/**
 * 外链导入面板：从左栏右侧伸出的文件树（替代弹窗选框），右缘可拖宽。
 * 从盘符根起懒加载展开。单击文件 = 链入 links/ 并打开（vault 内文件直接打开）；
 * 右键文件/文件夹出菜单选「加入外链」——读写回原路径、不拷贝正文。
 * DOM/类名复用左栏树（.tree-row/.folder-row/…），视觉差异只在 #fs-panel 容器层。
 */
import type { FolioBrowse } from '../host/types.ts';
import { showContextMenu } from './contextMenu';
import { icon } from './icons';
import { attachResizer } from './panelResize';

export type FsPanelOpts = {
    /** 目录数据源：host.browseDir 薄包装，mode 固定 'file'（目录 + md/html） */
    browse(dir: string | null): Promise<FolioBrowse>;
    /** abs 是否落在当前 vault 内（含 vault 本体）——是则不可链 */
    isInsideVault(abs: string): boolean;
    onLinkFile(abs: string): void;
    onLinkDir(abs: string): void;
    /** vault 内文件的单击直开（abs → 相对路径由调用方换算） */
    onOpenInside(abs: string): void;
    /** 轻提示（状态栏 saySave） */
    say(msg: string): void;
};

type FsEntry = FolioBrowse['entries'][number];

let panel: HTMLElement | null = null;

export function fsPanelOpen(): boolean {
    return panel !== null;
}

export function closeFsPanel(): void {
    panel?.remove();
    panel = null;
}

export function toggleFsPanel(opts: FsPanelOpts): void {
    if (panel) {
        closeFsPanel();
        return;
    }
    panel = document.createElement('aside');
    panel.id = 'fs-panel';

    const head = document.createElement('header');
    head.className = 'fs-head';
    const title = document.createElement('span');
    title.className = 'fs-title';
    title.textContent = '外链导入';
    const hint = document.createElement('span');
    hint.className = 'fs-hint';
    hint.textContent = '点击打开';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'icon-btn';
    close.innerHTML = icon('x');
    close.title = '关闭';
    close.addEventListener('click', closeFsPanel);
    head.append(title, hint, close);

    const tree = document.createElement('nav');
    tree.id = 'fs-tree';
    tree.setAttribute('aria-label', '外部文件树');
    tree.addEventListener('contextmenu', (e) => e.preventDefault());

    panel.append(head, tree);
    // 悬停区滚轮：滚在头部等不可滚子区时转发给树（与左栏 bindRegionWheel 同理）
    panel.addEventListener('wheel', (e) => {
        if (e.ctrlKey) return;
        if (e.target instanceof Node && tree.contains(e.target)) return;
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        tree.scrollTop += dy;
        e.preventDefault();
    }, { passive: false });
    document.getElementById('sidebar')?.after(panel);
    attachResizer(panel, 'right', 'folio-w-fspanel', 180, 520);
    void fillChildren(tree, null, 0, opts);
}

/** 竖向引导线对准折叠三角中心（与左栏 alignGuideLines 同算法）。 */
function alignGuide(row: HTMLElement, box: HTMLElement): void {
    requestAnimationFrame(() => {
        const svg = row.querySelector('.folder-toggle svg');
        if (!svg || !box.isConnected) return;
        const center = svg.getBoundingClientRect().left + svg.getBoundingClientRect().width / 2;
        box.style.setProperty('--line-o', `${Math.round(center - box.getBoundingClientRect().left)}px`);
    });
}

function indent(row: HTMLElement, depth: number): void {
    row.style.paddingLeft = `calc(var(--folio-space-1) + var(--tree-step) * ${depth})`;
}

function noteRow(text: string, depth: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tree-row fs-note-row';
    indent(row, depth);
    const main = document.createElement('span');
    main.className = 'row-main';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = text;
    main.append(name);
    row.append(main);
    return row;
}

async function fillChildren(box: HTMLElement, dir: string | null, depth: number, opts: FsPanelOpts): Promise<void> {
    try {
        const data = await opts.browse(dir);
        if (!box.isConnected) return;
        box.replaceChildren();
        if (data.entries.length === 0) box.append(noteRow('（无文档）', depth));
        for (const ent of data.entries) box.append(ent.dir ? dirRow(ent, depth, opts) : fileRow(ent, depth, opts));
    } catch (err) {
        if (box.isConnected) box.append(noteRow(`读取失败：${(err as Error).message}`, depth));
    }
}

function dirRow(ent: FsEntry, depth: number, opts: FsPanelOpts): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tree-row folder-row';
    indent(row, depth);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'icon-btn folder-toggle';
    toggle.innerHTML = icon('chevron-right');
    toggle.title = '展开';
    toggle.setAttribute('aria-expanded', 'false');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-main';
    const ic = document.createElement('span');
    ic.className = 'file-icon';
    ic.innerHTML = icon('folders');
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = ent.name;
    button.append(ic, name);
    button.title = `${ent.path}（右键出菜单）`;

    let loading = false;
    const flip = (expanded: boolean) => {
        toggle.innerHTML = icon(expanded ? 'chevron-down' : 'chevron-right');
        toggle.title = expanded ? '折叠' : '展开';
        toggle.setAttribute('aria-expanded', String(expanded));
    };
    const toggleDir = () => {
        if (loading) return;
        const next = row.nextElementSibling;
        if (next?.classList.contains('tree-children')) {
            next.remove();
            flip(false);
            return;
        }
        loading = true;
        const box = document.createElement('div');
        box.className = 'tree-children';
        box.append(noteRow('读取中…', depth + 1));
        row.after(box);
        flip(true);
        void fillChildren(box, ent.path, depth + 1, opts).finally(() => {
            loading = false;
            alignGuide(row, box);
        });
    };
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDir();
    });
    button.addEventListener('click', toggleDir);
    row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (opts.isInsideVault(ent.path)) {
            opts.say('vault 内的目录已在库里');
            return;
        }
        showContextMenu(e.clientX, e.clientY, [
            { ic: 'link', label: '加入外链（整个文件夹）', run: () => opts.onLinkDir(ent.path) },
        ]);
    });
    row.append(toggle, button);
    return row;
}

function fileRow(ent: FsEntry, depth: number, opts: FsPanelOpts): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tree-row';
    indent(row, depth);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-main';
    const ic = document.createElement('span');
    ic.className = 'file-icon';
    ic.innerHTML = icon('file-text');
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = ent.name;
    button.append(ic, name);
    button.title = `${ent.path}（点击打开）`;
    // 单击 = 打开：库外链入 links/ 再开（onLinkFile 内部已 open），库内直接开
    button.addEventListener('click', () => {
        if (opts.isInsideVault(ent.path)) opts.onOpenInside(ent.path);
        else opts.onLinkFile(ent.path);
    });
    row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (opts.isInsideVault(ent.path)) {
            opts.say('vault 内的文件已在库里');
            return;
        }
        showContextMenu(e.clientX, e.clientY, [
            { ic: 'link', label: '加入外链', run: () => opts.onLinkFile(ent.path) },
        ]);
    });
    row.append(button);
    return row;
}
