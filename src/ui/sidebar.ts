/**
 * 侧栏（单元 5 起）：目录即分组——notes/、memos/ 及其子文件夹原样成组，
 * 不另做分组表、不做文件夹树（docs/计划.md 单元 5 纪律）。
 */
import type { FolioListItem } from '../host/types.ts';
import { icon } from './icons';

export type SidebarOptions = {
    activePath: string | null;
    onOpen: (path: string, button: HTMLButtonElement) => void;
    /** 点文件夹标题 = 选中该目录（bug4 2.2：只选中不过滤） */
    selectedDir?: string | null;
    onDirSelect?: (dir: string | null) => void;
    /** 拖拽移动文档（待评估 14） */
    onMove?: (from: string, toDir: string) => void;
    /** 文件夹右键菜单（bug5） */
    onFolderContext?: (dir: string, x: number, y: number) => void;
};

/** 文档类型图标：外链 > 速记 > 笔记。 */
function fileIcon(file: FolioListItem): string {
    if (file.linked) return icon('link');
    return icon(file.kind === 'memo' ? 'bolt' : 'file-text');
}

type DirNode = { dir: string; name: string; children: Map<string, DirNode>; files: FolioListItem[] };

function buildTree(files: FolioListItem[]): DirNode {
    const root: DirNode = { dir: '', name: '', children: new Map(), files: [] };
    for (const file of files) {
        const segs = file.path.split('/');
        let node = root;
        for (let i = 0; i < segs.length - 1; i++) {
            const name = segs[i];
            if (!node.children.has(name)) {
                node.children.set(name, { dir: node.dir ? `${node.dir}/${name}` : name, name, children: new Map(), files: [] });
            }
            node = node.children.get(name)!;
        }
        node.files.push(file);
    }
    return root;
}

/** 折叠状态（模块级，会话内保持） */
const collapsedDirs = new Set<string>();

/**
 * 清单 = 文件夹树（bug4 2.1-2.6）：文件夹图标点击折叠/展开、标题点击只选中；
 * 子级有 1px 层级引导线；计数右对齐；星标行内显示，不设星标组；无横向滚动。
 */
export function renderSidebar(nav: HTMLElement, files: FolioListItem[], opts: SidebarOptions): void {
    nav.replaceChildren();
    renderTree(nav, buildTree(files), 0, opts);
    alignGuideLines(nav);
}

/** 渲染后对位（清单1 补充 2/3）：竖线钉到折叠三角中心；文件图标对齐同级文件夹图标。 */
function alignGuideLines(nav: HTMLElement): void {
    requestAnimationFrame(() => {
        for (const row of nav.querySelectorAll<HTMLElement>('.folder-row')) {
            // 竖线对位基准 = 折叠三角中心（不是文件夹图标）
            const svg = row.querySelector('.folder-toggle svg');
            const children = row.nextElementSibling as HTMLElement | null;
            if (!svg || !children?.classList.contains('tree-children')) continue;
            const svgRect = svg.getBoundingClientRect();
            const center = svgRect.left + svgRect.width / 2;
            children.style.setProperty('--line-o', `${Math.round(center - children.getBoundingClientRect().left)}px`);
        }
    });
}

function renderTree(host: HTMLElement, node: DirNode, depth: number, opts: SidebarOptions): void {
    for (const dir of [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))) {
        host.append(renderFolderRow(dir, depth, opts));
        if (!collapsedDirs.has(dir.dir)) {
            const children = document.createElement('div');
            children.className = 'tree-children';
            renderTree(children, dir, depth + 1, opts);
            host.append(children);
        }
    }
    host.append(renderGroup(node.files, opts, depth));
}

function renderFolderRow(dir: DirNode, depth: number, opts: SidebarOptions): HTMLElement {
    const row = document.createElement('div');
    row.className = 'tree-row folder-row';
    // 高亮贯穿左右：负 margin 抵消父级缩进；行内 padding 还原层级（清单1 补充）
    row.style.marginLeft = `calc(-1 * var(--tree-step) * ${depth})`;
    row.style.paddingLeft = `calc(6px + var(--tree-step) * ${depth})`;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'icon-btn folder-toggle';
    toggle.innerHTML = icon(collapsedDirs.has(dir.dir) ? 'chevron-right' : 'chevron-down');
    toggle.title = collapsedDirs.has(dir.dir) ? '展开' : '折叠';
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (collapsedDirs.has(dir.dir)) collapsedDirs.delete(dir.dir);
        else collapsedDirs.add(dir.dir);
        opts.onDirSelect?.(opts.selectedDir ?? null); // 触发重渲染
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-main';
    const count = dir.files.length + [...dir.children.values()].reduce((sum, ch) => sum + ch.files.length, 0);
    button.innerHTML = `${icon('folders')}<span class="file-name">${dir.name}</span><span class="folder-count">${count}</span>`;
    button.title = dir.dir;
    button.dataset.dir = dir.dir;
    if (dir.dir === opts.selectedDir) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => opts.onDirSelect?.(dir.dir));
    row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        opts.onFolderContext?.(dir.dir, e.clientX, e.clientY);
    });

    // 拖文件到此文件夹 = 移动
    row.addEventListener('dragover', (e) => {
        e.preventDefault();
        row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drop-target');
        const from = e.dataTransfer?.getData('text/folio-path');
        if (from) opts.onMove?.(from, dir.dir);
    });

    row.append(toggle, button);
    return row;
}

function renderGroup(files: FolioListItem[], opts: SidebarOptions, _depth: number): DocumentFragment {
    const frag = document.createDocumentFragment();
    for (const file of files) {
        const row = document.createElement('div');
        row.className = 'tree-row';
        row.style.marginLeft = `calc(-1 * var(--tree-step) * ${_depth})`;
        row.style.paddingLeft = `calc(6px + var(--tree-step) * ${_depth})`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'row-main';
        button.draggable = true;
        const ic = document.createElement('span');
        ic.className = 'file-icon';
        ic.innerHTML = fileIcon(file);
        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = file.title;
        button.append(ic, name);
        // bug4 2.6：星标行内靠右，不设星标组
        if (file.favorite) {
            const star = document.createElement('span');
            star.className = 'row-star';
            star.textContent = '★';
            star.title = '已收藏';
            button.append(star);
        }
        if (file.linked) {
            const badge = document.createElement('span');
            badge.className = 'linked-badge';
            badge.textContent = '⌗';
            badge.title = '库外链入文档，读写回原文件';
            button.append(badge);
        }
        button.title = file.path;
        button.dataset.path = file.path;
        if (file.path === opts.activePath) button.setAttribute('aria-current', 'true');
        button.addEventListener('click', () => opts.onOpen(file.path, button));
        button.addEventListener('dragstart', (e) => {
            e.dataTransfer?.setData('text/folio-path', file.path);
            e.dataTransfer!.effectAllowed = 'move';
        });
        row.append(button);
        frag.append(row);
    }
    return frag;
}

export function markCurrent(nav: HTMLElement, path: string | null): void {
    nav.querySelectorAll('button').forEach((button) => {
        if (button.dataset.path === path) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
    });
}

/**
 * 标签条（单元 6）：frontmatter tags 的并集，点一个筛一层；一条可多标签。
 * 数据来自 host.list() 的 tags 字段，不搞 [[标签页]]（AGENTS.md 不做清单）。
 */
export function renderTagBar(
    bar: HTMLElement,
    files: FolioListItem[],
    activeTag: string | null,
    onToggle: (tag: string) => void,
    applyColor?: (el: HTMLElement, tag: string) => void,
): void {
    const tags = new Set<string>();
    for (const file of files) for (const tag of file.tags ?? []) tags.add(tag);

    bar.replaceChildren();
    if (tags.size === 0) return;

    for (const tag of [...tags].sort((a, b) => a.localeCompare(b, 'zh'))) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tag-chip';
        chip.textContent = tag;
        chip.dataset.tag = tag;
        if (tag === activeTag) chip.setAttribute('aria-pressed', 'true');
        applyColor?.(chip, tag);
        chip.addEventListener('click', () => onToggle(tag));
        bar.append(chip);
    }
}

/**
 * 速记时间线（单元 8）：memos/ 按文件名倒序（约定文件名带日期前缀），
 * 标题旁挂标签。是同一座 vault 的一种看法，不是嵌 memos。
 */
export function renderMemoTimeline(
    nav: HTMLElement,
    files: FolioListItem[],
    opts: SidebarOptions,
): void {
    nav.replaceChildren();
    const sorted = [...files].sort((a, b) => b.path.localeCompare(a.path, 'zh'));
    for (const file of sorted) {
        const row = document.createElement('div');
        row.className = 'memo-row';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'memo-open';
        button.innerHTML = `<span class="file-icon">${fileIcon(file)}</span><span class="file-name">${file.title}</span>`;
        button.title = file.path;
        button.dataset.path = file.path;
        if (file.path === opts.activePath) button.setAttribute('aria-current', 'true');
        button.addEventListener('click', () => opts.onOpen(file.path, button));
        row.append(button);

        const tags = document.createElement('span');
        tags.className = 'memo-tags';
        tags.textContent = file.tags?.length ? file.tags.join(' · ') : '';
        row.append(tags);

        nav.append(row);
    }
    if (sorted.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'side-group';
        empty.textContent = 'memos/ 还没有速记';
        nav.append(empty);
    }
}
