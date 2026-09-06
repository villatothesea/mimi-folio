import { wordCount } from '@muyajs/core';
import { applyTextScale, readTextScale } from './shared/textScale.ts';
import { createHost } from './host/index.ts';
import { currentEditor, destroyEditor, mountEditor } from './ui/editorHost.ts';
import { attachMediaHandlers } from './ui/mediaPaste.ts';
import { attachImageFallback } from './ui/imageFallback.ts';
import { renderSidebar, setSiblingFoldersCollapsed, siblingFolderFoldState } from './ui/sidebar.ts';
import { focusComposer, isMemoBusy, paintMemoView } from './ui/memoView.ts';
import { attachInlineEmbeds } from './ui/embeds.ts';
import { highlightActive, renderToc } from './ui/toc.ts';
import { attachWikilinkHandlers } from './ui/wikilink.ts';
import { displayTitle, fileName, fileNameStem, newNoteMarkdown, renamedPath, setDisplayTitle, yamlTitle } from './shared/docTitle.ts';
import { htmlPreviewSandbox, htmlPreviewScriptsEnabled, isHtmlPath, previewFrameHref, previewSrc } from './shared/htmlPreview.ts';
import { readLastView, readLastViewFor, writeLastView as persistView, writeLastViewFor } from './shared/lastView.ts';
import { applyViewFilters, nextViewFilters } from './shared/viewFilters.ts';
import { setScalar, setTags, splitFrontmatter } from './shared/frontmatter.ts';
import { applyTagColor, tagColorIndex } from './ui/tagColors.ts';
import { attachSearchPalette } from './ui/searchPalette.ts';
import { attachWikiAutocomplete, attachWikilinkDecor } from './ui/wikilinkDecor.ts';
import { blockNativeContextMenu, showContextMenu } from './ui/contextMenu.ts';
import { folioConfirm, folioPick, folioPrompt } from './ui/dialogs.ts';
import { attachTips } from './ui/tips.ts';
import { attachWorkspaceMenu } from './ui/workspaces.ts';
import { attachScrollFade } from './ui/scrollFade.ts';
import { buildToolbar } from './ui/toolbar.ts';
import { initSettings, openSettings } from './ui/settings.ts';
import { icon } from './ui/icons.ts';
import type { FolioListItem } from './host/types.ts';

/**
 * 页面编排：侧栏选文件 → host.read → Muya 编辑 → json-change 防抖 → host.write。
 * 真源是盘上的 md；编辑器只是视图（AGENTS.md 硬规则 3）。
 */
const host = createHost();

let activeWorkspaceId = '';

function writeLastView(view: Parameters<typeof persistView>[0]): void {
    if (activeWorkspaceId) writeLastViewFor(activeWorkspaceId, view);
    else persistView(view);
}

const nav = document.querySelector<HTMLElement>('#files')!;
const breadcrumbEl = document.querySelector<HTMLElement>('#breadcrumb')!;
const favoriteBtn = document.querySelector<HTMLButtonElement>('#favorite-toggle')!;
const filterbar = document.querySelector<HTMLElement>('#filterbar')!;
const btnFilterMenu = document.querySelector<HTMLButtonElement>('#btn-filter-menu')!;
const sidebarEl = document.querySelector<HTMLElement>('#sidebar')!;
const tocHost = document.querySelector<HTMLElement>('#toc-host')!;
const tocFab = document.querySelector<HTMLButtonElement>('#toc-fab')!;
const tocPanel = document.querySelector<HTMLElement>('#toc')!;
const tocEl = document.querySelector<HTMLElement>('#toc-list')!;
const wrap = document.querySelector<HTMLElement>('#editor-wrap')!;
const docScroll = document.querySelector<HTMLElement>('#doc-scroll')!;
const htmlFrame = document.querySelector<HTMLIFrameElement>('#html-frame')!;
const saveStateEl = document.querySelector<HTMLElement>('#save-state')!;

let openFile: string | null = null;
let lastSaved = '';
/** 读到的文件 mtime：写回带 If-Match，别人改过就 409 而不是静默覆盖（米米建议 2） */
let docMtime: number | undefined;
let docCtime: number | undefined;
let lastLinks: { outgoing: string[]; backlinks: string[] } = { outgoing: [], backlinks: [] };
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let allFiles: FolioListItem[] = [];
/** 底栏五枚筛选：默认单选；Ctrl/Cmd 点选为并集。空集合 = 全部。 */
let activeFilters = new Set<string>();
let selectedDir: string | null = null;

function saySave(message: string): void {
    saveStateEl.textContent = message;
}

async function saveNow(markdown: string): Promise<void> {
    if (!openFile || isHtmlPath(openFile)) return;
    if (markdown === lastSaved) return;
    try {
        await host.write(openFile, markdown, docMtime);
        // 写成功后取新 mtime（响应头），否则下次 If-Match 拿旧值误报 409（bug3.6）
        const fresh = await host.read(openFile).catch(() => null);
        docMtime = fresh?.mtimeMs ?? docMtime;
        lastSaved = markdown;
        saySave(`已存 ${new Date().toLocaleTimeString()}`);
        void refreshList();
        void refreshBacklinks();
    } catch (err) {
        if ((err as { status?: number }).status === 409 && openFile) {
            saySave('文件已在别处被修改，已重载最新版');
            await open(openFile);
        } else {
            saySave(`存失败：${(err as Error).message}`);
        }
    }
}

function setTocOpen(open: boolean): void {
    tocPanel.hidden = !open;
    tocFab.setAttribute('aria-expanded', String(open));
    syncTocHostBox();
}

function syncTocHostBox(): void {
    if (tocPanel.hidden) {
        tocHost.style.removeProperty('width');
        tocHost.style.removeProperty('height');
        return;
    }
    const fab = tokenPx('--folio-toc-fab-size', 20);
    const gap = tokenPx('--folio-space-1', 4);
    tocHost.style.width = `${Math.round(tocPanel.offsetWidth)}px`;
    tocHost.style.height = `${Math.round(fab + gap + tocPanel.offsetHeight)}px`;
}

function syncTocGutter(): void {
    const gutter = Math.max(0, docScroll.offsetWidth - docScroll.clientWidth);
    tocHost.style.setProperty('--folio-toc-scrollbar', `${gutter}px`);
}

/**
 * 文档头：YAML title:（行业通用的文档标题）+ 属性。
 * 只经标题栏和左栏右键改；不改正文 H1、不改操作系统文件名。
 */
function renderTitle(): void {
    const editor = currentEditor();
    titleEl.replaceChildren();
    if (!openFile || !editor) {
        hideDocHead();
        return;
    }
    titleEl.hidden = false;
    docHead.hidden = false;

    const titleRow = document.createElement('div');
    titleRow.className = 'doc-title-row';
    const titleInput = document.createElement('input');
    titleInput.className = 'doc-title-input';
    titleInput.placeholder = fileName(openFile);
    titleInput.setAttribute('aria-label', '文档标题');
    titleInput.value = yamlTitle(editor.getMarkdown()) ?? '';
    titleInput.addEventListener('change', () => {
        const ed = currentEditor();
        if (!ed || !openFile) return;
        const next = titleInput.value.trim();
        if (!next) return;
        ed.replaceContent(setDisplayTitle(ed.getMarkdown(), next));
        onEditorChange(ed.getMarkdown());
        void refreshList();
    });
    titleRow.append(titleInput);
    titleEl.append(titleRow);
}

function syncTitleFromBody(markdown: string): void {
    const input = titleEl.querySelector<HTMLInputElement>('.doc-title-input');
    if (!input || document.activeElement === input) return;
    const next = yamlTitle(markdown) ?? '';
    if (input.value !== next) input.value = next;
}

function hideDocHead(): void {
    docHead.hidden = true;
    titleEl.hidden = true;
    propsEl.hidden = true;
    propsFoldSlot.hidden = true;
    paintToc();
}

/**
 * 属性区（Ob 式文件头）：跟标题栏、正文同一列，不是独立灰面板。
 * tags 行是芯片可增删，其余键只读展示；编辑器里的 frontmatter 块仍收起。
 */
function renderProps(): void {
    const editor = currentEditor();
    propsEl.replaceChildren();
    if (!openFile || !editor) {
        hideDocHead();
        return;
    }
    propsEl.hidden = propsCollapsed;
    docHead.hidden = false;
    propsEl.classList.toggle('collapsed', propsCollapsed);
    paintPropsFold();
    if (propsCollapsed) return;

    const commit = (next: string[]) => {
        const ed = currentEditor();
        if (!ed || !openFile) return;
        ed.replaceContent(setTags(ed.getMarkdown(), next));
        onEditorChange(ed.getMarkdown());
    };

    const { frontmatter } = splitFrontmatter(editor.getMarkdown());

    const row = (key: string, value: Node): void => {
        const line = document.createElement('div');
        line.className = 'prop-row';
        const k = document.createElement('span');
        k.className = 'prop-key';
        k.textContent = key;
        line.append(k, value);
        propsEl.append(line);
    };

    for (const lineText of (frontmatter ?? '').split('\n')) {
        const pair = lineText.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
        if (!pair || ['tags', 'title', 'favorite'].includes(pair[1].toLowerCase())) continue;
        const v = document.createElement('span');
        v.className = 'prop-value';
        v.textContent = pair[2] || '—';
        row(pair[1], v);
    }

    // tags 行：芯片（点击换色）+ ＋，固定最下
    const tagsValue = document.createElement('span');
    tagsValue.className = 'prop-tags';
    const tags = allFiles.find((f) => f.path === openFile)?.tags ?? [];
    for (const tag of tags) {
        const chip = document.createElement('span');
        chip.className = 'doc-tag';
        chip.append(document.createTextNode(tag));
        applyTagColor(chip, tag);
        chip.title = '点击换色';
        chip.addEventListener('click', (event) => openTagPopover(tag, chip, event));
        const remove = document.createElement('button');
        remove.className = 'doc-tag-x';
        remove.type = 'button';
        remove.textContent = '×';
        remove.title = `移除 ${tag}`;
        remove.addEventListener('click', () => commit(tags.filter((t) => t !== tag)));
        chip.append(remove);
        tagsValue.append(chip);
    }
    const add = document.createElement('button');
    add.className = 'doc-tag-add';
    add.type = 'button';
    add.textContent = '＋';
    add.title = '加标签';
    add.addEventListener('click', () => {
        const input = document.createElement('input');
        input.className = 'doc-tag-input';
        input.placeholder = '标签名';
        add.replaceWith(input);
        input.focus();
        const done = (ok: boolean) => {
            const value = input.value.trim();
            input.remove();
            if (ok && value && !tags.includes(value)) commit([...tags, value]);
            else renderProps();
        };
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') done(true);
            if (event.key === 'Escape') done(false);
        });
        input.addEventListener('blur', () => done(Boolean(input.value.trim())));
    });
    tagsValue.append(add);
    row('tags', tagsValue);
}

let propsCollapsed = localStorage.getItem('folio-props-fold') === 'true';

/** 标签芯片弹层（验收清单 12.2）：色板，默认 HEX，可自定义。 */
let tagPopover: HTMLDivElement | null = null;

function closeTagPopover(): void {
    tagPopover?.remove();
    tagPopover = null;
}

function tagHex(tag: string): string {
    const stored = (JSON.parse(localStorage.getItem('folio-tag-colors') ?? '{}') as Record<string, unknown>)[tag];
    if (typeof stored === 'string' && stored.startsWith('#')) return stored;
    const cs = getComputedStyle(document.documentElement);
    return cs.getPropertyValue(`--folio-tag-${tagColorIndex(tag)}`).trim() || '#888888';
}

function setTagColorHex(tag: string, hex: string | null): void {
    const map = JSON.parse(localStorage.getItem('folio-tag-colors') ?? '{}') as Record<string, unknown>;
    if (hex === null) delete map[tag];
    else map[tag] = hex;
    localStorage.setItem('folio-tag-colors', JSON.stringify(map));
}

function openTagPopover(tag: string, chip: HTMLElement, event: MouseEvent): void {
    event.stopPropagation();
    closeTagPopover();
    const pop = document.createElement('div');
    pop.className = 'tag-pop';
    tagPopover = pop;

    const color = document.createElement('input');
    color.type = 'color';
    color.className = 'tag-color-input';
    color.value = tagHex(tag);
    const hexLabel = document.createElement('span');
    hexLabel.className = 'tag-hex-label';
    hexLabel.textContent = color.value.toUpperCase();
    color.addEventListener('input', () => {
        hexLabel.textContent = color.value.toUpperCase();
    });
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'doc-tag-add';
    ok.textContent = '应用';
    ok.addEventListener('click', () => {
        setTagColorHex(tag, color.value);
        closeTagPopover();
        renderTitle();
        renderProps();
        void refreshList();
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'doc-tag-add';
    reset.textContent = '散列';
    reset.title = '按名字散列取色';
    reset.addEventListener('click', () => {
        setTagColorHex(tag, null);
        closeTagPopover();
        renderTitle();
        renderProps();
        void refreshList();
    });
    pop.append(color, hexLabel, ok, reset);

    const rect = chip.getBoundingClientRect();
    pop.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;
    pop.style.top = `${rect.bottom + 6}px`;
    document.body.append(pop);
}

document.addEventListener('click', (event) => {
    if (tagPopover && !tagPopover.contains(event.target as Node)) closeTagPopover();
});

async function refreshBacklinks(): Promise<void> {
    if (!openFile || !host.index) return;
    try {
        const index = await host.index(openFile);
        lastLinks = index;
        renderCenterBar();
    } catch {
        lastLinks = { outgoing: [], backlinks: [] };
        renderCenterBar();
    }
}

/** 链接弹层（bug2.5）：出链、反链各自弹自己的清单。 */
function openLinksPop(anchor: HTMLElement, kind: 'outgoing' | 'backlinks'): void {
    document.querySelector('#links-pop')?.remove();
    const pop = document.createElement('div');
    pop.id = 'links-pop';
    const paths = kind === 'outgoing' ? lastLinks.outgoing : lastLinks.backlinks;
    const title = document.createElement('div');
    title.className = 'bl-heading';
    title.textContent = kind === 'outgoing' ? `出链 ${paths.length}` : `反链 ${paths.length}`;
    pop.append(title);
    if (paths.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'bl-heading';
        empty.textContent = '（无）';
        pop.append(empty);
    }
    for (const path of paths) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'bl-chip';
        chip.textContent = allFiles.find((f) => f.path === path)?.title ?? path.replace(/\.md$/i, '');
        chip.title = path;
        chip.addEventListener('click', () => {
            pop.remove();
            void open(path);
        });
        pop.append(chip);
    }
    const rect = anchor.getBoundingClientRect();
    pop.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
    pop.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    document.body.append(pop);
    setTimeout(() => {
        const close = (e: MouseEvent) => {
            if (!pop.contains(e.target as Node) && e.target !== anchor) {
                pop.remove();
                document.removeEventListener('mousedown', close);
            }
        };
        document.addEventListener('mousedown', close);
    });
}

/** 中区底栏（验收清单 10.3 + bug2.5）：时间 + 出链/反链各自按钮、各自弹层。 */
function renderCenterBar(): void {
    const meta = document.querySelector<HTMLElement>('#doc-meta');
    if (!meta) return;
    meta.replaceChildren();
    if (!openFile) return;
    const fmt = (ms?: number) => (ms ? new Date(ms).toLocaleString('sv').slice(0, 16).replace('T', ' ') : '—');
    const text = (s: string): HTMLSpanElement => {
        const el = document.createElement('span');
        el.textContent = s;
        return el;
    };
    meta.append(text(`创建 ${fmt(docCtime)} · 修改 ${fmt(docMtime)}`));
    if (isHtmlPath(openFile)) return;
    meta.append(text(' · '));
    const seg = (label: string, kind: 'outgoing' | 'backlinks'): void => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'link-like link-seg';
        b.textContent = `${label} ${kind === 'outgoing' ? lastLinks.outgoing.length : lastLinks.backlinks.length}`;
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (document.querySelector('#links-pop')?.contains?.(document.activeElement)) return;
            openLinksPop(b, kind);
        });
        meta.append(b);
    };
    seg('出链', 'outgoing');
    meta.append(text(' · '));
    seg('反链', 'backlinks');
}

/** 点击未命中的 wikilink → 在 notes/ 建页并打开（Foam 规则）。 */
async function createAndOpen(path: string): Promise<void> {
    const name = path.replace(/^notes\//, '').replace(/\.md$/i, '');
    await host.write(path, newNoteMarkdown(name));
    await open(path);
    void refreshList();
}

function onEditorChange(markdown: string): void {
    syncTitleFromBody(markdown);
    renderBreadcrumb(markdown);
    renderStatusbar(markdown);
    if (markdown === lastSaved) return;
    saySave('改动中…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveNow(markdown), 400);
}

/** 底栏（单元 12）：篇数 + 当前文档字数；TOC 随内容重算也挂在这。 */
let tocTimer: ReturnType<typeof setTimeout> | undefined;

function renderStatusbar(markdown?: string): void {
    statCount.textContent = allFiles.length ? `${allFiles.length} 篇` : '';
    if (openFile && isHtmlPath(openFile)) {
        statWords.textContent = '网页预览';
        return;
    }
    const md = markdown ?? currentEditor()?.getMarkdown();
    if (md !== undefined) {
        const { word } = wordCount(md);
        statWords.textContent = `${word} 字`;
    }
    clearTimeout(tocTimer);
    tocTimer = setTimeout(() => paintToc(), 300);
}

function paintToc(): void {
    const md = currentEditor()?.getMarkdown();
    const title = openFile && md !== undefined ? displayTitle(openFile, md) : undefined;
    renderToc(tocEl, currentEditor(), title);
}

function clearHtmlPreview(): void {
    htmlFrame.removeAttribute('src');
    htmlFrame.removeAttribute('srcdoc');
}

function mountHtmlPreview(path: string): void {
    const rel = host.previewUrl?.(path) ?? previewSrc(path);
    htmlFrame.removeAttribute('src');
    htmlFrame.removeAttribute('srcdoc');
    htmlFrame.setAttribute('sandbox', htmlPreviewSandbox(htmlPreviewScriptsEnabled()));
    htmlFrame.src = previewFrameHref(rel, location.origin);
}

function openHtmlInBrowserTab(path: string): void {
    const rel = host.previewUrl?.(path) ?? previewSrc(path);
    window.open(rel, '_blank', 'noopener,noreferrer');
}

async function open(path: string): Promise<void> {
    try {
        if (openFile && currentEditor()) await saveNow(currentEditor()!.getMarkdown());
        clearTimeout(saveTimer);
        const root = document.querySelector<HTMLElement>('#app')!;
        root.classList.remove('memo-mode');

        if (isHtmlPath(path)) {
            destroyEditor();
            hideDocHead();
            setTocOpen(false);
            root.classList.add('html-mode');
            const doc = await host.read(path);
            openFile = doc.path;
            lastSaved = '';
            docMtime = doc.mtimeMs;
            docCtime = doc.ctimeMs;
            lastLinks = { outgoing: [], backlinks: [] };
            if (selectedDir !== null) {
                selectedDir = null;
                nav.querySelectorAll('.row-main[aria-current][data-dir]').forEach((b) => b.removeAttribute('aria-current'));
            }
            writeLastView({ v: 'file', path: doc.path });
            mountHtmlPreview(doc.path);
            renderCenterBar();
            renderBreadcrumb('');
            renderStatusbar();
            saySave('预览');
            nav.querySelectorAll<HTMLButtonElement>('button[data-path]').forEach((b) => {
                if (b.dataset.path === openFile) b.setAttribute('aria-current', 'true');
                else b.removeAttribute('aria-current');
            });
            return;
        }

        root.classList.remove('html-mode');
        clearHtmlPreview();
        const doc = await host.read(path);
        openFile = doc.path;
        if (selectedDir !== null) {
            selectedDir = null;
            nav.querySelectorAll('.row-main[aria-current][data-dir]').forEach((b) => b.removeAttribute('aria-current'));
        }
        lastSaved = doc.markdown;
        docMtime = doc.mtimeMs;
        docCtime = doc.ctimeMs;
        renderCenterBar();
        renderBreadcrumb(doc.markdown);
        syncFavoriteBtn();
        saySave('');
        writeLastView({ v: 'file', path: doc.path });
        mountEditor(wrap, doc.markdown, host, onEditorChange);
        renderTitle();
        renderProps();
        renderStatusbar(doc.markdown);
        paintToc();
        restoreScroll(doc.path);
        requestAnimationFrame(syncTocGutter);
        nav.querySelectorAll<HTMLButtonElement>('button[data-path]').forEach((b) => {
            if (b.dataset.path === openFile) b.setAttribute('aria-current', 'true');
            else b.removeAttribute('aria-current');
        });
        void refreshBacklinks();
    } catch (err) {
        saySave(`读失败：${(err as Error).message}`);
    }
}

/** 面包屑（单元 13）：路径逐级可点，点哪层就把清单筛到哪层。 */
function renderBreadcrumb(markdown?: string): void {
    breadcrumbEl.replaceChildren();
    if (!openFile) {
        breadcrumbEl.textContent = '未打开';
        return;
    }
    const path = openFile;
    const md = markdown ?? currentEditor()?.getMarkdown() ?? lastSaved;
    const segments = path.split('/');
    segments.forEach((seg, i) => {
        const isLast = i === segments.length - 1;
        if (!isLast) {
            const crumb = document.createElement('button');
            crumb.type = 'button';
            crumb.className = 'crumb';
            crumb.textContent = seg;
            const dir = segments.slice(0, i + 1).join('/');
            crumb.addEventListener('click', () => {
                selectedDir = dir;
                void refreshList();
            });
            const sep = document.createElement('span');
            sep.className = 'crumb-sep';
            sep.textContent = '/';
            breadcrumbEl.append(crumb, sep);
        } else {
            const crumb = document.createElement('span');
            crumb.className = 'crumb-file';
            crumb.textContent = isHtmlPath(path) ? fileName(path) : displayTitle(path, md);
            crumb.title = fileName(path);
            breadcrumbEl.append(crumb);
        }
    });
}

/** 收藏（单元 13）：frontmatter favorite: true；星标组置顶在清单。 */
function syncFavoriteBtn(): void {
    const fav = allFiles.find((f) => f.path === openFile)?.favorite ?? false;
    favoriteBtn.textContent = fav ? '★' : '☆';
    favoriteBtn.setAttribute('aria-pressed', String(fav));
}

favoriteBtn.addEventListener('click', () => {
    const editor = currentEditor();
    if (!editor || !openFile) return;
    const fav = allFiles.find((f) => f.path === openFile)?.favorite ?? false;
    editor.replaceContent(setScalar(editor.getMarkdown(), 'favorite', fav ? null : true));
    onEditorChange(editor.getMarkdown());
    // 乐观更新星标，落盘后 refreshList 校准
    favoriteBtn.textContent = fav ? '☆' : '★';
    void refreshList();
});

const propsEl = document.querySelector<HTMLElement>('#props')!;
const propsFoldSlot = document.querySelector<HTMLElement>('#props-fold-slot')!;
const propsFoldBtn = document.querySelector<HTMLButtonElement>('#props-fold')!;
const titleEl = document.querySelector<HTMLElement>('#doc-title')!;
const docHead = document.querySelector<HTMLElement>('#doc-head')!;
const statCount = document.querySelector<HTMLElement>('#stat-count')!;
const statWords = document.querySelector<HTMLElement>('#stat-words')!;
const findbarEl = document.querySelector<HTMLElement>('#findbar')!;
const findInput = document.querySelector<HTMLInputElement>('#find-input')!;
const findCount = document.querySelector<HTMLElement>('#find-count')!;
const replaceInput = document.querySelector<HTMLInputElement>('#replace-input')!;

function paintPropsFold(): void {
    if (!openFile) {
        propsFoldSlot.hidden = true;
        return;
    }
    propsFoldSlot.hidden = false;
    propsFoldBtn.innerHTML = icon(propsCollapsed ? 'chevron-down' : 'chevron-up');
    const tip = propsCollapsed ? '展开文档属性' : '收起文档属性';
    propsFoldBtn.title = tip;
    propsFoldBtn.dataset.tip = tip;
    propsFoldBtn.setAttribute('aria-label', tip);
    propsFoldBtn.classList.toggle('breathe', propsCollapsed);
}

propsFoldBtn.addEventListener('click', () => {
    propsCollapsed = !propsCollapsed;
    localStorage.setItem('folio-props-fold', String(propsCollapsed));
    renderTitle();
    renderProps();
});

let lastListSig = '';
let lastShown: FolioListItem[] = [];

function listSignature(files: { path: string; title: string; favorite?: boolean; mtimeMs?: number; tags?: string[] }[]): string {
    return `${[...activeFilters].sort().join(',')}|${selectedDir ?? ''}|${openFile ?? ''}|`
        + files.map((f) => `${f.path}\0${f.title}\0${f.favorite ? 1 : 0}\0${f.mtimeMs ?? 0}\0${(f.tags ?? []).join(',')}`).join('\n');
}

function isMemoView(): boolean {
    return activeFilters.size === 1 && activeFilters.has('memos');
}

async function openMemoInNote(path: string): Promise<void> {
    activeFilters = new Set();
    document.querySelector<HTMLElement>('#app')?.classList.remove('memo-mode');
    await open(path);
    await refreshList();
}

async function enterMemos(): Promise<void> {
    activeFilters = new Set(['memos']);
    await refreshList();
    focusComposer();
}

async function syncMemoMode(): Promise<void> {
    const root = document.querySelector<HTMLElement>('#app')!;
    if (isMemoView()) {
        if (!root.classList.contains('memo-mode')) {
            if (openFile && currentEditor()) await saveNow(currentEditor()!.getMarkdown());
            openFile = null;
            destroyEditor();
            hideDocHead();
            setTocOpen(false);
            root.classList.remove('html-mode');
            clearHtmlPreview();
            root.classList.add('memo-mode');
            writeLastView({ v: 'memos' });
            breadcrumbEl.textContent = '速记';
            lastLinks = { outgoing: [], backlinks: [] };
            renderCenterBar();
        }
        await paintMemoView({
            host,
            files: allFiles,
            say: saySave,
            confirm: folioConfirm,
            openInNote: (path) => void openMemoInNote(path),
            refresh: refreshList,
        });
    } else if (root.classList.contains('memo-mode')) {
        root.classList.remove('memo-mode');
        if (!openFile) {
            breadcrumbEl.textContent = '未打开';
            writeLastView(null);
        }
    }
}

function paintNav(files: FolioListItem[] = lastShown): void {
    lastShown = files;
    if (isMemoView()) return;
    renderSidebar(nav, files, {
        activePath: selectedDir ? null : openFile,
        onOpen: (p) => void open(p),
        selectedDir,
        onDirSelect: (dir) => {
            selectedDir = dir;
            nav.querySelectorAll<HTMLElement>('.row-main[data-dir]').forEach((b) => {
                if (b.dataset.dir === dir) b.setAttribute('aria-current', 'true');
                else b.removeAttribute('aria-current');
            });
            nav.querySelectorAll('.row-main[data-path][aria-current]').forEach((b) => b.removeAttribute('aria-current'));
            lastListSig = listSignature(allFiles);
        },
        onFolderContext: (dir, x, y) => folderContextMenu(dir, x, y),
        onMove: (from, toDir) => void (async () => {
            if (!host.moveDoc) return;
            const name = from.split('/').pop()!;
            const to = `${toDir}/${name}`;
            if (to === from) return;
            try {
                await host.moveDoc(from, to);
                void refreshList();
            } catch (err) {
                saySave(`移动失败：${(err as Error).message}`);
            }
        })(),
    });
}

async function refreshList(): Promise<void> {
    try {
        const files = await host.list();
        allFiles = files;
        const sig = listSignature(files);
        if (sig === lastListSig) return;
        if (nav.querySelector('input:focus, textarea:focus') || titleEl.querySelector('input:focus') || isMemoBusy()) return;
        lastListSig = sig;
        const shown = applyViewFilters(files, activeFilters);
        renderPills();
        renderStatusbar();
        paintNav(shown);
        await syncMemoMode();
        if (!isMemoView()) {
            renderTitle();
            renderProps();
            syncFavoriteBtn();
        }
    } catch (err) {
        saySave(`列目录失败：${(err as Error).message}`);
    }
}

/** 筛选 pills（验收批）：全部/笔记/速记/外链，图标在文字左，带计数。 */
const PILL_ICONS: Record<string, string> = { all: 'all', notes: 'note', memos: 'memo', links: 'link', fav: 'star' };
const PILL_LABELS: Record<string, string> = { all: '全部', notes: '笔记', memos: '速记', links: '外链', fav: '星标' };
const PILL_KEYS = ['all', 'notes', 'memos', 'links', 'fav'] as const;

function pillCounts(): Record<string, number> {
    return {
        all: allFiles.length,
        notes: allFiles.filter((f) => f.kind === 'note').length,
        memos: allFiles.filter((f) => f.kind === 'memo').length,
        links: allFiles.filter((f) => f.linked).length,
        fav: allFiles.filter((f) => f.favorite).length,
    };
}

function pillPressed(key: string): boolean {
    return key === 'all' ? activeFilters.size === 0 : activeFilters.has(key);
}

function applyFilter(key: string, multi: boolean): void {
    activeFilters = nextViewFilters(activeFilters, key, multi);
    void refreshList();
}

function renderPills(): void {
    const counts = pillCounts();
    const activeLabel = activeFilters.size === 0
        ? '全部'
        : [...activeFilters].map((key) => PILL_LABELS[key] ?? key).join('·');
    btnFilterMenu.dataset.tip = `筛选 · ${activeLabel}`;
    btnFilterMenu.setAttribute('aria-pressed', String(activeFilters.size > 0));
    filterbar.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach((button) => {
        const key = button.dataset.view ?? 'all';
        button.innerHTML = icon(PILL_ICONS[key] ?? 'all');
        button.dataset.tip = `${PILL_LABELS[key] ?? ''} ${counts[key] ?? 0}`;
        button.setAttribute('aria-pressed', String(pillPressed(key)));
    });
    document.querySelectorAll<HTMLButtonElement>('#filter-menu button[data-view]').forEach((button) => {
        const key = button.dataset.view ?? 'all';
        button.setAttribute('aria-pressed', String(pillPressed(key)));
        button.querySelector('.filter-menu-count')!.textContent = String(counts[key] ?? 0);
    });
}

function openFilterMenu(anchor: HTMLButtonElement): void {
    document.querySelector('#filter-menu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'filter-menu';
    menu.setAttribute('role', 'menu');
    const counts = pillCounts();
    for (const key of PILL_KEYS) {
        const item = document.createElement('button');
        item.type = 'button';
        item.dataset.view = key;
        item.setAttribute('role', 'menuitemcheckbox');
        item.innerHTML = `${icon(PILL_ICONS[key])}<span>${PILL_LABELS[key]}</span><span class="filter-menu-count">${counts[key] ?? 0}</span>`;
        item.setAttribute('aria-pressed', String(pillPressed(key)));
        item.addEventListener('click', (event) => {
            applyFilter(key, event.ctrlKey || event.metaKey);
            renderPills();
            if (!(event.ctrlKey || event.metaKey)) {
                menu.remove();
                anchor.setAttribute('aria-expanded', 'false');
            }
        });
        menu.append(item);
    }
    const rect = anchor.getBoundingClientRect();
    menu.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    menu.style.left = `${rect.left}px`;
    document.body.append(menu);
    anchor.setAttribute('aria-expanded', 'true');
    setTimeout(() => {
        const close = (event: MouseEvent) => {
            if (menu.contains(event.target as Node)) return;
            menu.remove();
            anchor.setAttribute('aria-expanded', 'false');
            document.removeEventListener('mousedown', close);
        };
        document.addEventListener('mousedown', close);
    });
}

btnFilterMenu.innerHTML = icon('menu');
btnFilterMenu.addEventListener('click', (event) => {
    event.stopPropagation();
    if (document.querySelector('#filter-menu')) {
        document.querySelector('#filter-menu')?.remove();
        btnFilterMenu.setAttribute('aria-expanded', 'false');
        return;
    }
    openFilterMenu(event.currentTarget as HTMLButtonElement);
});

filterbar.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-view]');
    if (!button) return;
    const key = button.dataset.view ?? 'all';
    if (event.ctrlKey || event.metaKey) event.preventDefault();
    applyFilter(key, event.ctrlKey || event.metaKey);
});

function stamp(): string {
    return new Date()
        .toLocaleString('sv', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .replace(/[\s:]/g, '-');
}

/** 新建速记：进入看法，落盘走 composer（Ctrl+Enter → memos/<时间戳>.md）。 */
async function newMemo(): Promise<void> {
    await enterMemos();
}

/** 新建动作（验收清单 7/10.4）：统一收进标题栏加号下拉。 */
async function newNote(): Promise<void> {
    const path = `notes/${stamp()}.md`;
    await host.write(path, newNoteMarkdown());
    await open(path);
    void refreshList();
}

async function newFolder(): Promise<void> {
    const name = await folioPrompt('新文件夹名（建在 notes/ 下）');
    if (!name) return;
    const safe = name.trim().replace(/[\\/:*?"<>|]/g, '_');
    const path = `notes/${safe}/未命名笔记.md`;
    try {
        await host.write(path, newNoteMarkdown());
        selectedDir = `notes/${safe}`;
        await open(path);
        void refreshList();
    } catch (err) {
        saySave(`建文件夹失败：${(err as Error).message}`);
    }
}

async function linkOutside(): Promise<void> {
    if (!host.linkOutside) return;
    const source = await folioPrompt('库外 md 的绝对路径（读写都会回这个文件，不拷贝）');
    if (!source) return;
    try {
        const path = await host.linkOutside(source.trim().replace(/^["']|["']$/g, ''));
        await open(path);
        void refreshList();
    } catch (err) {
        saySave(`链入失败：${(err as Error).message}`);
    }
}

/** 导入 md（bug4 2.8）：文件窗选择 → 拷贝入 vault（浏览器拿不到盘路径，只能拷贝）。 */
async function importMdByPicker(): Promise<void> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.md,.markdown,.html';
        input.addEventListener('cancel', () => resolve());
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (file) {
                try {
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    await host.write(`notes/${file.name}`, new TextDecoder().decode(bytes));
                    await open(`notes/${file.name}`);
                    void refreshList();
                } catch (err) {
                    saySave(`导入失败：${(err as Error).message}`);
                }
            }
            resolve();
        });
        input.click();
    });
}

/** 导入文件夹：系统选文件夹窗 → links/<原名>/ 链入，不拷贝。 */
async function importFolderLink(): Promise<void> {
    if (!host.pickFolder || !host.linkFolder) return;
    const source = await host.pickFolder();
    if (!source) return;
    try {
        const out = await host.linkFolder(source);
        saySave(`已链接 ${out.count} 篇 → ${out.dir}`);
        void refreshList();
    } catch (err) {
        saySave(`导入文件夹失败：${(err as Error).message}`);
    }
}

async function relinkFolder(dir: string): Promise<void> {
    if (!host.pickFolder || !host.relinkFolder) return;
    const source = await host.pickFolder();
    if (!source) return;
    try {
        const out = await host.relinkFolder(dir, source);
        saySave(`已更换路径 → ${out.dir}`);
        await refreshList();
        if (openFile?.startsWith(`${dir}/`) && !allFiles.some((f) => f.path === openFile)) {
            openFile = null;
            destroyEditor();
            breadcrumbEl.textContent = '未打开';
            hideDocHead();
            renderCenterBar();
            writeLastView(null);
        }
    } catch (err) {
        saySave(`更换路径失败：${(err as Error).message}`);
    }
}

/** 标题栏加号下拉（验收清单 7）。 */
function openPlusMenu(anchor: HTMLElement): void {
    document.querySelector('#plus-menu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'plus-menu';
    const items: Array<[string, string, () => void]> = [
        ['file-plus', '新建笔记', () => void newNote()],
        ['bolt', '新建速记', () => void newMemo()],
        ['folder-plus', '新建文件夹', () => void newFolder()],
        ['external-link', '链入外部 md（路径）', () => void linkOutside()],
        ['file-export', '导入 md（文件窗）', () => void importMdByPicker()],
        ['folders', '导入文件夹（链接）', () => void importFolderLink()],
    ];
    for (const [ic, label, run] of items) {
        const item = document.createElement('button');
        item.type = 'button';
        item.innerHTML = `${icon(ic)}<span>${label}</span>`;
        item.addEventListener('click', () => {
            menu.remove();
            run();
        });
        menu.append(item);
    }
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;
    document.body.append(menu);
    setTimeout(() => {
        const close = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node)) {
                menu.remove();
                document.removeEventListener('mousedown', close);
            }
        };
        document.addEventListener('mousedown', close);
    });
}

document.querySelector<HTMLButtonElement>('#btn-plus')!.innerHTML = icon('plus');
document.querySelector<HTMLButtonElement>('#btn-plus')!.addEventListener('click', (e) => {
    e.stopPropagation();
    if (document.querySelector('#plus-menu')) document.querySelector('#plus-menu')?.remove();
    else openPlusMenu(e.currentTarget as HTMLElement);
});
document.querySelector<HTMLButtonElement>('#btn-settings')!.innerHTML = icon('settings');
document.querySelector<HTMLButtonElement>('#btn-settings')!.addEventListener('click', () => openSettings());

window.addEventListener('beforeunload', (event) => {
    if (openFile && currentEditor() && currentEditor()!.getMarkdown() !== lastSaved) {
        event.preventDefault();
    }
});
window.addEventListener('pagehide', () => {
    if (openFile && currentEditor()) void saveNow(currentEditor()!.getMarkdown());
    destroyEditor();
});

// 查找替换（单元 11）：muya.search/find/replace 的页面壳。
let findTimer: ReturnType<typeof setTimeout> | undefined;

function doSearch(): void {
    const editor = currentEditor();
    if (!editor) return;
    editor.search(findInput.value, { selectHighlight: true });
    const hits = (editor as unknown as { editor?: { searchModule?: { matches: unknown[] } } }).editor?.searchModule?.matches?.length ?? 0;
    findCount.textContent = findInput.value ? `${hits} 处` : '';
}

function findbarShow(): void {
    if (!openFile) return;
    findbarEl.hidden = false;
    findInput.focus();
    findInput.select();
    doSearch();
}

function findbarHide(): void {
    findbarEl.hidden = true;
    currentEditor()?.search('');
    findCount.textContent = '';
}

document.querySelector<HTMLButtonElement>('#find-close')!.addEventListener('click', findbarHide);
document.querySelector<HTMLButtonElement>('#find-prev')!.addEventListener('click', () => currentEditor()?.find('previous'));
document.querySelector<HTMLButtonElement>('#find-next')!.addEventListener('click', () => currentEditor()?.find('next'));
findInput.addEventListener('input', () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(doSearch, 200);
});
findbarEl.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        findbarHide();
        return;
    }
    if (event.target !== findInput) return;
    if (event.key === 'Enter') {
        event.preventDefault();
        currentEditor()?.find(event.shiftKey ? 'previous' : 'next');
    }
});
document.querySelector<HTMLButtonElement>('#replace-one')!.addEventListener('click', () => {
    currentEditor()?.replace(replaceInput.value, { isSingle: true, isRegexp: false });
    doSearch();
});
document.querySelector<HTMLButtonElement>('#replace-all')!.addEventListener('click', () => {
    currentEditor()?.replace(replaceInput.value, { isSingle: false, isRegexp: false });
    doSearch();
});
// Ctrl+F 归全局搜索面板（验收批）：取代浏览器原生搜索，任何状态都拦
const searchPalette = attachSearchPalette({
    search: async (q) => (host.search ? await host.search(q) : []),
    onOpen: (p) => void open(p),
    getFiles: () => allFiles,
});
window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchPalette.show();
    }
});

// [[wikilink]] 点击直达 / 未命中弹新建芯片（单元 7，按验收反馈改为点击即开）
attachWikilinkHandlers(wrap, {
    getPages: () => allFiles.map((f) => f.path),
    onOpen: (p) => void open(p),
    onCreate: (p) => void createAndOpen(p),
});

// 音视频/图片文件的粘贴与拖放落盘（单元 4）；外壳常驻，编辑器重建不受影响
attachMediaHandlers(wrap, host, currentEditor);

// muya 在浏览器里把相对图片路径转成 file:// 必然失败，宿主层兜底补同源 img
attachImageFallback(wrap);

// 白名单视频链接内嵌正文流（单元 9，按验收反馈从底部面板改入正文）
attachInlineEmbeds(wrap);

// ==== 右键菜单（验收清单 4/14）====
blockNativeContextMenu(document.body);

/** 左栏文档右键。 */
nav.addEventListener('contextmenu', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-path]');
    if (!button) return;
    event.preventDefault();
    const path = button.dataset.path!;
    const item = allFiles.find((f) => f.path === path);

    const dirsOf = () => {
        const dirs = new Set<string>(['notes', 'memos']);
        for (const f of allFiles) {
            const dir = f.path.split('/').slice(0, -1).join('/');
            if (dir) dirs.add(dir);
        }
        return [...dirs].sort((a, b) => a.localeCompare(b, 'zh'));
    };
    const targetOf = async (verb: string) => {
        const dirs = dirsOf();
        const current = path.split('/').slice(0, -1).join('/') || undefined;
        const dir = await folioPick(`${verb}到…`, dirs, current);
        if (!dir) return null;
        const name = path.split('/').pop()!;
        return `${dir}/${name}`;
    };
    const withDoc = async (op: 'move' | 'copy' | 'delete', run: () => Promise<unknown>, retry: boolean) => {
        try {
            await run();
        } catch (err) {
            if (retry && (err as Error).message.includes('已存在')) saySave((err as Error).message);
            else saySave(`${op} 失败：${(err as Error).message}`);
        }
        void refreshList();
    };

    showContextMenu(event.clientX, event.clientY, [
        ...(isHtmlPath(path) ? [{
            ic: 'external-link',
            label: '在浏览器新页签中打开',
            run: () => openHtmlInBrowserTab(path),
        }] : []),
        { ic: 'pencil', label: '重命名', run: () => void renameInline(button, path) },
        { ic: 'arrow-move-up', label: '移动到…', run: () => void (async () => {
            const to = await targetOf('移动');
            if (to && host.moveDoc) await withDoc('move', () => host.moveDoc!(path, to), true);
        })() },
        { ic: 'copy', label: '复制到…', run: () => void (async () => {
            const to = await targetOf('复制');
            if (to && host.copyDoc) await withDoc('copy', () => host.copyDoc!(path, to), true);
        })() },
        { ic: 'copy-plus', label: '添加副本', run: () => void (async () => {
            const dir = path.split('/').slice(0, -1).join('/');
            const stem = fileNameStem(path);
            const ext = /\.[^.]+$/.exec(fileName(path))?.[0] ?? '';
            for (let i = 1; i < 99; i++) {
                const to = `${dir ? `${dir}/` : ''}${stem}-${i}${ext}`;
                if (!allFiles.some((f) => f.path === to)) {
                    if (host.copyDoc) await withDoc('copy', () => host.copyDoc!(path, to), false);
                    return;
                }
            }
        })() },
        { ic: 'clipboard-text', label: '复制文档路径', run: () => void (async () => {
            try {
                const root = (await (await fetch('/folio/v1/root')).json()) as { root: string };
                const abs = `${root.root.replace(/[\\/]+$/, '')}\\${path.replaceAll('/', '\\')}`;
                await navigator.clipboard.writeText(abs);
                saySave('已复制绝对路径');
            } catch {
                await navigator.clipboard.writeText(path);
                saySave('已复制文档路径');
            }
        })() },
        { ic: 'robot', label: '添加到米米（合入后可用）', disabled: true },
        { sep: true },
        { ic: 'trash', label: '删除', danger: true, run: () => void (async () => {
            if (!(await folioConfirm(`删除 ${item?.title ?? path}？`))) return;
            // bug5：先关文档再删，避免轮询/自动保存对着已删文件空转
            if (openFile === path) {
                openFile = null;
                destroyEditor();
                document.querySelector<HTMLElement>('#app')?.classList.remove('html-mode');
                clearHtmlPreview();
                breadcrumbEl.textContent = '未打开';
                hideDocHead();
                renderCenterBar();
                writeLastView(null);
            }
            if (host.deleteDoc) await host.deleteDoc(path).catch((err: Error) => saySave(`删除失败：${err.message}`));
            await refreshList();
        })() },
    ]);
});

/** 文件夹右键（bug5）：与文档同款 + 顶部"添加子文件夹"。 */
function folderContextMenu(dir: string, x: number, y: number): void {
    const dirsOf = () => {
        const dirs = new Set<string>(['notes', 'memos']);
        for (const f of allFiles) {
            const d = f.path.split('/').slice(0, -1).join('/');
            if (d) dirs.add(d);
        }
        return [...dirs].sort((a, b) => a.localeCompare(b, 'zh'));
    };
    const fold = siblingFolderFoldState(lastShown, dir);
    showContextMenu(x, y, [
        ...(dir.split('/').length === 2 && dir.startsWith('links/') ? [{
            ic: 'external-link',
            label: '更换路径',
            run: () => void relinkFolder(dir),
        }] : []),
        { ic: 'folder-plus', label: '添加子文件夹', run: () => void (async () => {
            const name = await folioPrompt(`在 ${dir} 下新建文件夹`);
            if (!name) return;
            const safe = name.replace(/[\/:*?"<>|]/g, '_');
            const p = `${dir}/${safe}/未命名笔记.md`;
            try {
                await host.write(p, newNoteMarkdown());
                selectedDir = `${dir}/${safe}`;
                await open(p);
                void refreshList();
            } catch (err) {
                saySave(`建子文件夹失败：${(err as Error).message}`);
            }
        })() },
        { ic: 'pencil', label: '重命名文件夹', run: () => void (async () => {
            const name = await folioPrompt('文件夹新名', dir.split('/').pop() ?? '');
            if (!name) return;
            const parent = dir.split('/').slice(0, -1).join('/');
            const to = `${parent ? `${parent}/` : ''}${name.replace(/[\/:*?"<>|]/g, '_')}`;
            try {
                if (host.moveDoc) await host.moveDoc(dir, to);
                selectedDir = to;
                void refreshList();
            } catch (err) {
                saySave(`重命名失败：${(err as Error).message}`);
            }
        })() },
        { ic: 'arrow-move-up', label: '移动到…', run: () => void (async () => {
            const target = await folioPick('移动文件夹到…', dirsOf().filter((d) => d !== dir && !d.startsWith(`${dir}/`)), dir);
            if (!target || !host.moveDoc) return;
            try {
                await host.moveDoc(dir, `${target}/${dir.split('/').pop()}`);
                selectedDir = `${target}/${dir.split('/').pop()}`;
                void refreshList();
            } catch (err) {
                saySave(`移动失败：${(err as Error).message}`);
            }
        })() },
        { ic: 'clipboard-text', label: '复制文件夹路径', run: () => {
            void navigator.clipboard.writeText(dir);
            saySave('已复制文件夹路径');
        } },
        { ic: 'chevrons-down', label: '展开全部同级文件夹', disabled: fold.allExpanded, run: () => {
            setSiblingFoldersCollapsed(lastShown, dir, false);
            paintNav();
        } },
        { ic: 'chevrons-up', label: '折叠全部同级文件夹', disabled: fold.allCollapsed, run: () => {
            setSiblingFoldersCollapsed(lastShown, dir, true);
            paintNav();
        } },
        { ic: 'robot', label: '添加到米米（合入后可用）', disabled: true },
        { sep: true },
        { ic: 'trash', label: '删除文件夹', danger: true, run: () => void (async () => {
            if (!(await folioConfirm(`删除文件夹 ${dir}（含全部内容）？`))) return;
            if (openFile?.startsWith(`${dir}/`)) {
                openFile = null;
                destroyEditor();
                breadcrumbEl.textContent = '未打开';
                hideDocHead();
                renderCenterBar();
                writeLastView(null);
            }
            if (host.deleteDoc) await host.deleteDoc(dir).catch(() => undefined);
            if (selectedDir === dir) selectedDir = null;
            await refreshList();
        })() },
    ]);
}

/** 重命名：只改操作系统文件名，扩展名原样保留。不写 YAML title:、不改正文 H1。 */
async function renameInline(button: HTMLButtonElement, path: string): Promise<void> {
    const nameSpan = button.querySelector<HTMLElement>('.file-name');
    if (!nameSpan || button.querySelector('.rename-input') || !host.moveDoc) return;
    const input = document.createElement('input');
    input.className = 'rename-input';
    input.value = fileNameStem(path);
    // 输入框在 <button> 里：必须拦住点击，否则会当成打开文档，焦点被带走。
    const stay = (event: Event) => event.stopPropagation();
    input.addEventListener('mousedown', stay);
    input.addEventListener('pointerdown', stay);
    input.addEventListener('click', stay);
    const blockOpen = (event: Event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    button.addEventListener('click', blockOpen, true);
    const wasDrag = button.draggable;
    button.draggable = false;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const done = async (commit: boolean) => {
        if (finished) return;
        finished = true;
        button.removeEventListener('click', blockOpen, true);
        button.draggable = wasDrag;
        const value = input.value.trim();
        if (input.isConnected) input.replaceWith(nameSpan);
        if (!commit || !value) return;
        const dest = renamedPath(path, value);
        if (!dest) return;
        try {
            const to = await host.moveDoc!(path, dest);
            if (openFile === path) {
                openFile = to;
                writeLastView({ v: 'file', path: to });
                renderBreadcrumb();
                paintToc();
            }
            void refreshList();
        } catch (err) {
            saySave(`重命名失败：${(err as Error).message}`);
        }
    };
    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') void done(true);
        if (e.key === 'Escape') void done(false);
    });
    // 右键菜单的那次 click 收尾会落到这一行上，立刻 blur 会把输入框拆掉。
    window.setTimeout(() => {
        if (!finished) input.addEventListener('blur', () => void done(true));
    }, 0);
}

/** 中区右键（验收清单 14.2）：段落级插入/改型/删除，二级菜单与斜杠同源。 */
const BLOCK_MENU: Array<[string, string]> = [
    ['段落', 'paragraph'],
    ['一级标题', 'heading 1'],
    ['二级标题', 'heading 2'],
    ['三级标题', 'heading 3'],
    ['引用', 'blockquote'],
    ['代码块', 'pre'],
    ['表格', 'table'],
    ['公式块', 'mathblock'],
    ['分割线', 'hr'],
    ['无序列表', 'ul-bullet'],
    ['有序列表', 'ol-order'],
    ['任务列表', 'ul-task'],
];

wrap.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY, [
        { ic: 'arrow-big-up', label: '在本段落上方添加', children: BLOCK_MENU.map(([label, para]) => ({ label, run: () => currentEditor()?.insertParagraph('before', '', true) ?? undefined })) },
        { ic: 'arrow-big-down', label: '在本段落下方添加', children: BLOCK_MENU.map(([label, para]) => ({ label, run: () => currentEditor()?.insertParagraph('after', '', true) ?? undefined })) },
        { ic: 'pencil', label: '将本段落改为', children: BLOCK_MENU.map(([label, para]) => ({ label, run: () => currentEditor()?.updateParagraph(para) })) },
        { sep: true },
        { ic: 'trash', label: '删除本段落', danger: true, run: () => void (async () => {
            if (await folioConfirm('删除本段落？')) currentEditor()?.deleteParagraph();
        })() },
    ]);
});

// 外链文件夹里新文件、以及打开篇被外部改过：3s 轮询。清单未变则 refreshList 自己跳过重绘。
setInterval(() => void (async () => {
    void refreshList();
    if (!openFile) return;
    if (isHtmlPath(openFile)) {
        const doc = await host.read(openFile).catch(() => null);
        if (!doc || doc.mtimeMs === docMtime) return;
        docMtime = doc.mtimeMs;
        docCtime = doc.ctimeMs;
        mountHtmlPreview(openFile);
        saySave('外部已修改，已同步');
        return;
    }
    if (!currentEditor()) return;
    if (currentEditor()!.getMarkdown() !== lastSaved) return;
    const doc = await host.read(openFile).catch(() => null);
    if (!doc || doc.mtimeMs === docMtime) return;
    const top = docScroll.scrollTop;
    lastSaved = doc.markdown;
    docMtime = doc.mtimeMs;
    currentEditor()!.replaceContent(doc.markdown);
    docScroll.scrollTop = top;
    renderTitle();
    renderProps();
    paintToc();
    saySave('外部已修改，已同步');
})(), 3000);

// 书签：滚动位置记忆（bug4 1）
const posKey = 'folio-pos';
docScroll.addEventListener('scroll', () => {
    if (!openFile) return;
    try {
        const map = JSON.parse(localStorage.getItem(posKey) ?? '{}') as Record<string, number>;
        map[openFile] = Math.round(docScroll.scrollTop);
        localStorage.setItem(posKey, JSON.stringify(map));
    } catch {
        // 忽略配额
    }
});

function restoreScroll(path: string): void {
    try {
        const map = JSON.parse(localStorage.getItem(posKey) ?? '{}') as Record<string, number>;
        if (typeof map[path] === 'number') docScroll.scrollTop = map[path];
    } catch {
        // 忽略
    }
}

// wikilink 芯片 + [[ 自动补全（bug4 4.1/4.3）
attachWikilinkDecor(wrap);
attachWikiAutocomplete(wrap, { getFiles: () => allFiles, getEditor: currentEditor });

// 滚动时高亮 TOC 当前节（单元 12）
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
docScroll.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => highlightActive(tocEl), 150);
});

// 设置与主题（验收清单 7）：data-theme 只切 token 集，页面色卡/文字主题见 settings.ts
initSettings();
window.addEventListener('folio-html-scripts', () => {
    if (!openFile || !isHtmlPath(openFile)) return;
    mountHtmlPreview(openFile);
});
const btnTheme = document.querySelector<HTMLButtonElement>('#btn-theme')!;
btnTheme.innerHTML = icon('moon');
function applyTheme(mode: 'light' | 'dark'): void {
    document.documentElement.dataset.theme = mode;
    btnTheme.innerHTML = icon(mode === 'dark' ? 'sun' : 'moon');
    localStorage.setItem('folio-theme', mode);
}
applyTheme((localStorage.getItem('folio-theme') as 'light' | 'dark') ?? 'light');
applyTextScale(readTextScale());
const savedHl = localStorage.getItem('folio-highlight');
if (savedHl) document.documentElement.style.setProperty('--folio-highlight', savedHl);
btnTheme.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

attachTips();

// 顶栏工具栏（验收清单 11）
buildToolbar(
    document.querySelector<HTMLElement>('#toolbar')!,
    currentEditor,
    [{ ic: 'search', tip: '文内查找替换', run: () => (findbarEl.hidden ? findbarShow() : findbarHide()) }],
    host,
);

// 三区折叠（验收清单 10.2）：只剩左栏；目录改悬浮窗
const app = document.querySelector<HTMLElement>('#app')!;
const expandLeft = document.querySelector<HTMLButtonElement>('#expand-left')!;
document.querySelector<HTMLButtonElement>('#collapse-left')!.innerHTML = icon('layout-sidebar-left-collapse');
expandLeft.innerHTML = icon('layout-sidebar-left-expand');
document.querySelector<HTMLButtonElement>('#collapse-left')!.addEventListener('click', () => {
    app.classList.add('fold-left');
    expandLeft.hidden = false;
});
expandLeft.addEventListener('click', () => {
    app.classList.remove('fold-left');
    expandLeft.hidden = true;
});

tocFab.innerHTML = icon('menu-deep');
paintToc();
const tocGutterObs = new ResizeObserver(() => syncTocGutter());
tocGutterObs.observe(docScroll);
tocGutterObs.observe(wrap);
window.addEventListener('resize', syncTocGutter);
syncTocGutter();
tocFab.addEventListener('click', (event) => {
    event.stopPropagation();
    const next = tocPanel.hidden === true;
    if (next) paintToc();
    setTocOpen(next);
});

// Alt+1..6 快速设标题层级（验收清单 13.5）
window.addEventListener('keydown', (event) => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    if (event.code === 'KeyM') {
        event.preventDefault();
        void enterMemos();
        return;
    }
    const level = /^Digit([1-6])$/.exec(event.code)?.[1];
    if (!level) return;
    event.preventDefault();
    try {
        currentEditor()?.updateParagraph(`heading ${level}`);
    } catch {
        // muya 上游对部分段落转换抛 json1 数值键错误，静默（斜杠菜单可用）
    }
});

// 左右栏拖宽窄（验收批）：边线拖拽，宽度持久化。
// 预览 iframe 会吞掉 document 的 mouseup，必须 pointer capture，否则粘鼠标。
function attachResizer(panel: HTMLElement, edge: 'left' | 'right', key: string, min: number, max: number): void {
    const saved = Number(localStorage.getItem(key));
    if (Number.isFinite(saved) && saved >= min && saved <= max) panel.style.width = `${saved}px`;
    const handle = document.createElement('div');
    handle.className = 'col-resize';
    handle.style[edge] = '0';
    let dragging = false;
    let pointerId = 0;
    let startX = 0;
    let startW = 0;
    const stop = (): void => {
        if (!dragging) return;
        dragging = false;
        document.body.classList.remove('is-col-resizing');
        localStorage.setItem(key, String(Math.round(panel.getBoundingClientRect().width)));
        try {
            handle.releasePointerCapture(pointerId);
        } catch {
            /* 已经丢了 capture */
        }
    };
    handle.addEventListener('pointerdown', (down) => {
        if (down.button !== 0) return;
        down.preventDefault();
        down.stopPropagation();
        dragging = true;
        pointerId = down.pointerId;
        startX = down.clientX;
        startW = panel.getBoundingClientRect().width;
        document.body.classList.add('is-col-resizing');
        try {
            handle.setPointerCapture(down.pointerId);
        } catch {
            /* 无真实指针时 capture 会抛，mousemove 仍走 handle */
        }
    });
    handle.addEventListener('pointermove', (moveEvent) => {
        if (!dragging || moveEvent.pointerId !== pointerId) return;
        const delta = edge === 'right' ? moveEvent.clientX - startX : startX - moveEvent.clientX;
        const width = Math.min(max, Math.max(min, Math.round(startW + delta)));
        panel.style.width = `${width}px`;
    });
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    handle.addEventListener('lostpointercapture', stop);
    handle.addEventListener('dragstart', (event) => event.preventDefault());
    panel.append(handle);
}
attachResizer(sidebarEl, 'right', 'folio-w-sidebar', 180, 440);

function tokenPx(name: string, fallback: number): number {
    const n = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(n) ? n : fallback;
}

function tocSizeBounds(): { minW: number; maxW: number; minH: number; maxH: number } {
    return {
        minW: tokenPx('--folio-toc-pop-min-w', 140),
        maxW: tokenPx('--folio-toc-pop-max-w', 480),
        minH: tokenPx('--folio-toc-pop-min-h', 120),
        maxH: Math.min(tokenPx('--folio-toc-pop-max-h', 800), Math.round(window.innerHeight * 0.8)),
    };
}

function applySavedTocSize(): void {
    const { minW, maxW, minH, maxH } = tocSizeBounds();
    const w = Number(localStorage.getItem('folio-toc-w'));
    const h = Number(localStorage.getItem('folio-toc-h'));
    if (Number.isFinite(w) && w >= minW && w <= maxW) tocPanel.style.width = `${Math.round(w)}px`;
    if (Number.isFinite(h) && h >= minH && h <= maxH) tocPanel.style.height = `${Math.round(h)}px`;
}

function attachTocResizer(): void {
    const addHandle = (cls: string, axes: { w?: boolean; h?: boolean }): void => {
        const handle = document.createElement('div');
        handle.className = `toc-resize ${cls}`;
        let dragging = false;
        let pointerId = 0;
        let startX = 0;
        let startY = 0;
        let startW = 0;
        let startH = 0;
        const stop = (): void => {
            if (!dragging) return;
            dragging = false;
            document.body.classList.remove('is-toc-resizing');
            document.body.style.removeProperty('cursor');
            const box = tocPanel.getBoundingClientRect();
            localStorage.setItem('folio-toc-w', String(Math.round(box.width)));
            localStorage.setItem('folio-toc-h', String(Math.round(box.height)));
            syncTocHostBox();
            try {
                handle.releasePointerCapture(pointerId);
            } catch {
                /* 已经丢了 capture */
            }
        };
        handle.addEventListener('pointerdown', (down) => {
            if (down.button !== 0) return;
            down.preventDefault();
            down.stopPropagation();
            dragging = true;
            pointerId = down.pointerId;
            startX = down.clientX;
            startY = down.clientY;
            const box = tocPanel.getBoundingClientRect();
            startW = box.width;
            startH = box.height;
            document.body.classList.add('is-toc-resizing');
            document.body.style.cursor = getComputedStyle(handle).cursor;
            try {
                handle.setPointerCapture(down.pointerId);
            } catch {
                /* 无真实指针时 capture 会抛 */
            }
        });
        handle.addEventListener('pointermove', (moveEvent) => {
            if (!dragging || moveEvent.pointerId !== pointerId) return;
            const { minW, maxW, minH, maxH } = tocSizeBounds();
            if (axes.w) {
                const width = Math.min(maxW, Math.max(minW, Math.round(startW + (startX - moveEvent.clientX))));
                tocPanel.style.width = `${width}px`;
            }
            if (axes.h) {
                const height = Math.min(maxH, Math.max(minH, Math.round(startH + (moveEvent.clientY - startY))));
                tocPanel.style.height = `${height}px`;
            }
            syncTocHostBox();
        });
        handle.addEventListener('pointerup', stop);
        handle.addEventListener('pointercancel', stop);
        handle.addEventListener('lostpointercapture', stop);
        handle.addEventListener('dragstart', (event) => event.preventDefault());
        tocPanel.append(handle);
    };
    addHandle('toc-resize-w', { w: true });
    addHandle('toc-resize-h', { h: true });
    addHandle('toc-resize-wh', { w: true, h: true });
}

applySavedTocSize();
attachTocResizer();
attachScrollFade();

async function leaveOpenDoc(): Promise<void> {
    if (openFile && currentEditor()) await saveNow(currentEditor()!.getMarkdown());
    openFile = null;
    destroyEditor();
    hideDocHead();
    setTocOpen(false);
    clearHtmlPreview();
    document.querySelector<HTMLElement>('#app')?.classList.remove('memo-mode', 'html-mode');
    selectedDir = null;
    lastListSig = '';
    lastShown = [];
    lastLinks = { outgoing: [], backlinks: [] };
    breadcrumbEl.textContent = '未打开';
    renderCenterBar();
}

async function switchToWorkspace(id: string): Promise<void> {
    if (!host.setWorkspace) return;
    if (activeWorkspaceId && id !== activeWorkspaceId) {
        writeLastViewFor(activeWorkspaceId, readLastView());
    }
    await leaveOpenDoc();
    if (id !== activeWorkspaceId) await host.setWorkspace(id);
    activeWorkspaceId = id;
    await refreshList();
    const last = readLastViewFor(id);
    if (!last) return;
    persistView(last);
    await restoreLastView();
}

const btnWorkspace = document.querySelector<HTMLButtonElement>('#btn-workspace');
if (btnWorkspace) {
    attachWorkspaceMenu(btnWorkspace, {
        host,
        onSwitch: (id) => switchToWorkspace(id),
        onCreated: (id) => switchToWorkspace(id),
        say: saySave,
    });
}

async function restoreLastView(): Promise<void> {
    const last = readLastView();
    if (!last) return;
    if (last.v === 'memos') {
        await enterMemos();
        return;
    }
    if (!allFiles.some((f) => f.path === last.path)) return;
    await open(last.path);
    await refreshList();
}

void (async () => {
    if (host.listWorkspaces) {
        try {
            const ws = await host.listWorkspaces();
            activeWorkspaceId = ws.activeId;
        } catch {
            /* 服务还没起来时先按默认 vault */
        }
    }
    await refreshList();
    const last = (activeWorkspaceId ? readLastViewFor(activeWorkspaceId) : null) ?? readLastView();
    if (last) persistView(last);
    await restoreLastView();
})();
