import { wordCount } from '@muyajs/core';
import { installDesktopShellGuards } from './shared/desktopShell.ts';
import { installTitlebar } from './ui/titlebar.ts';
import { applyTextScale, readTextScale } from './shared/textScale.ts';
import { createHost } from './host/index.ts';
import { startMimiPresence } from './host/presence.ts';
import { currentEditor, destroyEditor, focusEditorBody, mountEditor } from './ui/editorHost.ts';
import { attachMediaHandlers } from './ui/mediaPaste.ts';
import { attachImageFallback } from './ui/imageFallback.ts';
import { renderSidebar, setSiblingFoldersCollapsed, siblingFolderFoldState, visibleSideItems, markSelected, markCurrent, expandDirPath, type SideItem } from './ui/sidebar.ts';
import { focusComposer, isMemoBusy, paintMemoView, stageMemoDay } from './ui/memoView.ts';
import { attachInlineEmbeds } from './ui/embeds.ts';
import { highlightActive, renderToc, scrollToHeading } from './ui/toc.ts';
import { memoDayFromPath } from './shared/memoMd.ts';
import { matchDocPath, matchHeadingIndex, parseDeepLink } from './shared/deepLink.ts';
import { attachWikilinkHandlers } from './ui/wikilink.ts';
import { displayTitle, fileName, fileNameStem, newNoteMarkdown, renamedPath } from './shared/docTitle.ts';
import { joinRel } from './shared/dirPick.ts';
import { joinOsAbs } from './shared/osPath.ts';
import { htmlPreviewSandbox, htmlPreviewScriptsEnabled, folioEntryToken, isHtmlPath, previewFrameHref, previewSrc } from './shared/htmlPreview.ts';
import { readLastView, readLastViewFor, writeLastView as persistView, writeLastViewFor } from './shared/lastView.ts';
import { applyViewFilters, nextViewFilters } from './shared/viewFilters.ts';
import { getScalar, setScalar, setTags, splitFrontmatter } from './shared/frontmatter.ts';
import { applyTagColor, tagColorIndex } from './ui/tagColors.ts';
import { attachSearchPalette } from './ui/searchPalette.ts';
import { attachWikiAutocomplete, attachWikilinkDecor } from './ui/wikilinkDecor.ts';
import { blockNativeContextMenu, showContextMenu } from './ui/contextMenu.ts';
import { folioBrowseFs, folioConfirm, folioPick, folioPickSource } from './ui/dialogs.ts';
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

startMimiPresence(); // mimi 模式下报存活：米米顶栏按钮高亮跟着它翻

let activeWorkspaceId = '';
/** 当前 vault 磁盘绝对路径（带盘符）；复制路径用，避免 await 后再写剪贴板丢掉用户手势。 */
let vaultAbsDir = '';
/** 当前工作区名；底栏面包屑首段用它。 */
let vaultName = '';

function rememberVaultRoot(ws: { items: { id: string; dir: string; name: string }[]; activeId: string }): void {
    activeWorkspaceId = ws.activeId;
    const active = ws.items.find((item) => item.id === ws.activeId);
    vaultAbsDir = active?.dir ?? '';
    vaultName = active?.name ?? '';
}

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
/** 侧栏 Ctrl/Shift 多选；打开篇仍走 aria-current。 */
let selectedFiles = new Set<string>();
let selectedDirs = new Set<string>();
let sideAnchor: SideItem | null = null;

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
 * 页标题在 markdown 外：显示并改操作系统文件名（不含扩展名）。
 * 不写 YAML title:、不改正文 H1。字号大于正文一级标题。
 */
function renderTitle(): void {
    const editor = currentEditor();
    titleEl.replaceChildren();
    if (!openFile || !editor) {
        hideDocHead();
        return;
    }
    const path = openFile;
    titleEl.hidden = false;
    docHead.hidden = false;

    const titleRow = document.createElement('div');
    titleRow.className = 'doc-title-row';
    const titleInput = document.createElement('input');
    titleInput.className = 'doc-title-input';
    titleInput.setAttribute('aria-label', '文件名');
    titleInput.value = fileNameStem(path);
    titleInput.size = Math.max(titleInput.value.length, 1);
    titleInput.spellcheck = false;
    titleInput.autocomplete = 'off';
    titleInput.readOnly = !host.moveDoc;
    const ext = /\.[^.]+$/.exec(fileName(path))?.[0] ?? '';
    const fit = () => {
        titleInput.size = Math.max(titleInput.value.length, 1);
    };
    titleInput.addEventListener('input', fit);
    const commitName = () => {
        if (!openFile) return;
        const next = titleInput.value.trim();
        if (!next) {
            titleInput.value = fileNameStem(path);
            fit();
            return;
        }
        void renameCurrentDoc(next);
    };
    titleInput.addEventListener('change', commitName);
    titleInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            titleInput.blur();
            const ed = currentEditor();
            if (ed) queueMicrotask(() => focusEditorBody(ed));
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            titleInput.value = fileNameStem(path);
            fit();
            titleInput.blur();
        }
    });
    titleRow.append(titleInput);
    if (ext) {
        const extEl = document.createElement('span');
        extEl.className = 'doc-title-ext';
        extEl.textContent = ext;
        extEl.title = '扩展名随文件类型，不能改';
        titleRow.append(extEl);
    }
    titleRow.addEventListener('click', () => {
        if (!titleInput.readOnly) titleInput.focus();
    });
    titleEl.append(titleRow);
}

function hideDocHead(): void {
    docHead.hidden = true;
    titleEl.hidden = true;
    propsEl.hidden = true;
    propsFoldSlot.hidden = true;
    paintToc();
}

function propsBusy(): boolean {
    return Boolean(propsEl.querySelector('input:focus, textarea:focus'));
}

function commitProp(key: string, raw: string, keepEmpty = false): boolean {
    const ed = currentEditor();
    if (!ed || !openFile) return false;
    const next = raw.trim();
    const value = next ? next : (keepEmpty ? '' : null);
    try {
        ed.replaceContent(setScalar(ed.getMarkdown(), key, value));
    } catch (err) {
        saySave((err as Error).message);
        return false;
    }
    onEditorChange(ed.getMarkdown());
    if (key === 'title') void refreshList();
    return true;
}

function beginAddProp(addRow: HTMLElement): void {
    const line = document.createElement('div');
    line.className = 'prop-row';
    const keyInput = document.createElement('input');
    keyInput.className = 'prop-key-input';
    keyInput.setAttribute('aria-label', '属性名');
    keyInput.placeholder = '键名';
    const valInput = document.createElement('input');
    valInput.className = 'prop-value-input';
    valInput.setAttribute('aria-label', '属性值');
    valInput.placeholder = '值';
    let finished = false;
    const cancel = () => {
        if (finished) return;
        finished = true;
        renderProps();
    };
    const save = () => {
        if (finished) return;
        const key = keyInput.value.trim();
        if (!key) {
            cancel();
            return;
        }
        const lower = key.toLowerCase();
        if (lower === 'title') {
            saySave('标题就是文件名，请改页顶大标题');
            keyInput.focus();
            return;
        }
        if (lower === 'tags') {
            saySave('标签请用 tags 行的 ＋');
            keyInput.focus();
            return;
        }
        if (lower === 'favorite') {
            saySave('收藏请点右上角星标');
            keyInput.focus();
            return;
        }
        if (!commitProp(key, valInput.value, true)) {
            keyInput.focus();
            return;
        }
        finished = true;
        renderProps();
    };
    keyInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            valInput.focus();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
        }
    });
    valInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            save();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
        }
    });
    const onBlur = () => {
        window.setTimeout(() => {
            if (finished) return;
            if (document.activeElement === keyInput || document.activeElement === valInput) return;
            if (!keyInput.value.trim() && !valInput.value.trim()) cancel();
            else save();
        }, 0);
    };
    keyInput.addEventListener('blur', onBlur);
    valInput.addEventListener('blur', onBlur);
    line.append(keyInput, valInput);
    addRow.replaceWith(line);
    keyInput.focus();
}

function propInput(key: string, value: string): HTMLInputElement {
    const input = document.createElement('input');
    input.className = 'prop-value-input';
    input.dataset.prop = key;
    input.setAttribute('aria-label', key);
    input.value = value;
    input.addEventListener('change', () => commitProp(key, input.value));
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            renderProps();
        }
    });
    return input;
}

/**
 * 属性区（Ob 式文件头）：跟标题栏、正文同一列。
 * YAML 标量键点进去改（空值删键）；title 就是文件名不在这里改；tags 行是芯片；favorite 仍走星标。编辑器里的 frontmatter 块仍收起。
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

    const markdown = editor.getMarkdown();
    const commit = (next: string[]) => {
        const ed = currentEditor();
        if (!ed || !openFile) return;
        ed.replaceContent(setTags(ed.getMarkdown(), next));
        onEditorChange(ed.getMarkdown());
    };

    const { frontmatter } = splitFrontmatter(markdown);

    const row = (key: string, value: Node): HTMLDivElement => {
        const line = document.createElement('div');
        line.className = 'prop-row';
        const k = document.createElement('span');
        k.className = 'prop-key';
        k.textContent = key;
        line.append(k, value);
        line.addEventListener('click', (event) => {
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
            line.querySelector('input')?.focus();
        });
        propsEl.append(line);
        return line;
    };

    const seen = new Set(['title', 'tags', 'favorite']);
    for (const lineText of (frontmatter ?? '').split('\n')) {
        const pair = lineText.match(/^([A-Za-z_][\w-]*)\s*:/);
        if (!pair || seen.has(pair[1].toLowerCase())) continue;
        seen.add(pair[1].toLowerCase());
        row(pair[1], propInput(pair[1], getScalar(markdown, pair[1]) ?? ''));
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

    const addRow = document.createElement('div');
    addRow.className = 'prop-row';
    const addProp = document.createElement('button');
    addProp.className = 'prop-add';
    addProp.type = 'button';
    addProp.textContent = '＋ 属性';
    addProp.title = '添加 YAML 字段';
    addProp.addEventListener('click', () => beginAddProp(addRow));
    addRow.append(addProp);
    propsEl.append(addRow);
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

/** anchor 是深链的标题文本：编成 #fragment 塞给 iframe，预览页自己的 nav 脚本按 id/name 跳。 */
function mountHtmlPreview(path: string, anchor?: string): void {
    const rel = host.previewUrl?.(path) ?? previewSrc(path);
    const frag = anchor ? `#${encodeURIComponent(anchor)}` : '';
    htmlFrame.removeAttribute('src');
    htmlFrame.removeAttribute('srcdoc');
    htmlFrame.setAttribute('sandbox', htmlPreviewSandbox(htmlPreviewScriptsEnabled()));
    htmlFrame.src = previewFrameHref(rel + frag, location.origin, { token: folioEntryToken() });
}

function openHtmlInBrowserTab(path: string): void {
    const rel = host.previewUrl?.(path) ?? previewSrc(path);
    window.open(previewFrameHref(rel, location.origin, { token: folioEntryToken() }), '_blank', 'noopener,noreferrer');
}

async function open(path: string, anchor?: string): Promise<void> {
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
            writeLastView({ v: 'file', path: doc.path });
            mountHtmlPreview(doc.path, anchor);
            renderCenterBar();
            renderBreadcrumb('');
            renderStatusbar();
            saySave('预览');
            showFileCurrent(openFile);
            return;
        }

        root.classList.remove('html-mode');
        clearHtmlPreview();
        const doc = await host.read(path);
        openFile = doc.path;
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
        showFileCurrent(openFile);
        void refreshBacklinks();
    } catch (err) {
        saySave(`读失败：${(err as Error).message}`);
    }
}

/** 面包屑（单元 13）：首段是 vault（工作区）名，其后路径逐级可点，点哪层就把清单筛到哪层。 */
function crumbSep(): HTMLSpanElement {
    const sep = document.createElement('span');
    sep.className = 'crumb-sep';
    sep.textContent = '\\';
    return sep;
}

function vaultCrumb(): HTMLElement {
    const crumb = document.createElement('button');
    crumb.type = 'button';
    crumb.className = 'crumb';
    crumb.textContent = vaultName;
    crumb.title = vaultAbsDir;
    crumb.addEventListener('click', () => {
        selectedDir = null;
        void refreshList();
    });
    return crumb;
}

/** 速记看法 / 未打开等非文档态：底栏仍带 vault 名。 */
function leafCrumb(text: string): void {
    breadcrumbEl.replaceChildren();
    if (vaultName) breadcrumbEl.append(vaultCrumb(), crumbSep());
    breadcrumbEl.append(Object.assign(document.createElement('span'), { className: 'crumb-file', textContent: text }));
}

function renderBreadcrumb(markdown?: string): void {
    breadcrumbEl.replaceChildren();
    if (!openFile) {
        leafCrumb('未打开');
        return;
    }
    const path = openFile;
    const md = markdown ?? currentEditor()?.getMarkdown() ?? lastSaved;
    const segments = path.split('/');
    if (vaultName) breadcrumbEl.append(vaultCrumb(), crumbSep());
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
            breadcrumbEl.append(crumb, crumbSep());
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
    const tip = '展开/收起YAML';
    propsFoldBtn.title = tip;
    propsFoldBtn.dataset.tip = tip;
    propsFoldBtn.dataset.tipSide = 'below';
    propsFoldBtn.dataset.tipAlign = 'start';
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
            leafCrumb('速记');
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
            leafCrumb('未打开');
            writeLastView(null);
        }
    }
}

function sameSide(a: SideItem, b: SideItem): boolean {
    return a.kind === b.kind && a.id === b.id;
}

function itemSelected(item: SideItem): boolean {
    return item.kind === 'file' ? selectedFiles.has(item.id) : selectedDirs.has(item.id);
}

function paintSideSel(): void {
    markSelected(nav, selectedFiles, selectedDirs);
}

function setSingleSide(item: SideItem): void {
    selectedFiles = item.kind === 'file' ? new Set([item.id]) : new Set();
    selectedDirs = item.kind === 'dir' ? new Set([item.id]) : new Set();
    sideAnchor = item;
}

function toggleSide(item: SideItem): void {
    const set = item.kind === 'file' ? selectedFiles : selectedDirs;
    if (set.has(item.id)) set.delete(item.id);
    else set.add(item.id);
    sideAnchor = item;
}

function rangeSide(item: SideItem): void {
    const items = visibleSideItems(nav);
    const anchor = sideAnchor ?? item;
    const i0 = items.findIndex((x) => sameSide(x, anchor));
    const i1 = items.findIndex((x) => sameSide(x, item));
    if (i0 < 0 || i1 < 0) {
        setSingleSide(item);
        return;
    }
    const lo = Math.min(i0, i1);
    const hi = Math.max(i0, i1);
    selectedFiles = new Set();
    selectedDirs = new Set();
    for (let i = lo; i <= hi; i++) {
        const it = items[i];
        if (it.kind === 'file') selectedFiles.add(it.id);
        else selectedDirs.add(it.id);
    }
}

/** 有修饰键则只改多选，调用方不要打开/切目录。 */
function handleSideClick(item: SideItem, event: MouseEvent): boolean {
    if (event.shiftKey) {
        rangeSide(item);
        paintSideSel();
        return true;
    }
    if (event.ctrlKey || event.metaKey) {
        toggleSide(item);
        paintSideSel();
        return true;
    }
    setSingleSide(item);
    paintSideSel();
    return false;
}

function ensureContextTarget(item: SideItem): void {
    if (!itemSelected(item)) {
        setSingleSide(item);
        paintSideSel();
    }
}

function selCount(): number {
    return selectedFiles.size + selectedDirs.size;
}

function pruneSideSel(): void {
    const paths = new Set(allFiles.map((f) => f.path));
    const dirs = new Set<string>();
    for (const f of allFiles) {
        const segs = f.path.split('/');
        for (let i = 1; i < segs.length; i++) dirs.add(segs.slice(0, i).join('/'));
    }
    for (const p of [...selectedFiles]) if (!paths.has(p)) selectedFiles.delete(p);
    for (const d of [...selectedDirs]) if (!dirs.has(d)) selectedDirs.delete(d);
}

/** 选了父文件夹就不再单独处理里面的文件/子夹。 */
function pruneNestedSel(): { files: string[]; dirs: string[] } {
    const dirList = [...selectedDirs].sort((a, b) => a.length - b.length);
    const dirs = dirList.filter((d) => !dirList.some((p) => p !== d && d.startsWith(`${p}/`)));
    const files = [...selectedFiles].filter((f) => !dirs.some((d) => f.startsWith(`${d}/`)));
    return { files, dirs };
}

function allDirs(): string[] {
    const dirs = new Set<string>(['notes', 'memos']);
    for (const f of allFiles) {
        const dir = f.path.split('/').slice(0, -1).join('/');
        if (dir) dirs.add(dir);
    }
    return [...dirs].sort((a, b) => a.localeCompare(b, 'zh'));
}

/** 点开文档：立刻拿掉文件夹高亮，不必等读盘/轮询重绘。 */
function showFileCurrent(path: string | null): void {
    selectedDir = null;
    markCurrent(nav, path);
}

function paintNav(files: FolioListItem[] = lastShown): void {
    lastShown = files;
    if (isMemoView()) return;
    renderSidebar(nav, files, {
        activePath: selectedDir ? null : openFile,
        selectedFiles,
        selectedDirs,
        onOpen: (p, _btn, event) => {
            if (handleSideClick({ kind: 'file', id: p }, event)) return;
            showFileCurrent(p);
            void open(p);
        },
        selectedDir,
        onDirSelect: (dir, event) => {
            if (handleSideClick({ kind: 'dir', id: dir }, event)) return;
            selectedDir = dir;
            nav.querySelectorAll<HTMLElement>('.row-main[data-dir]').forEach((b) => {
                if (b.dataset.dir === dir) b.setAttribute('aria-current', 'true');
                else b.removeAttribute('aria-current');
            });
            nav.querySelectorAll('.row-main[data-path][aria-current]').forEach((b) => b.removeAttribute('aria-current'));
            lastListSig = listSignature(allFiles);
        },
        onFolderContext: (dir, x, y) => {
            ensureContextTarget({ kind: 'dir', id: dir });
            if (selCount() > 1) multiContextMenu(x, y);
            else folderContextMenu(dir, x, y);
        },
        onMove: (froms, toDir) => void movePaths(froms, toDir),
        onMoveDirs: (dirs, toDir) => void movePaths(dirs, toDir),
    });
}

async function refreshList(): Promise<void> {
    try {
        const files = await host.list();
        allFiles = files;
        pruneSideSel();
        const sig = listSignature(files);
        if (sig === lastListSig) return;
        if (nav.querySelector('input:focus, textarea:focus') || titleEl.querySelector('input:focus') || propsBusy() || isMemoBusy()) return;
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

/** 行内改名入口：清单里找到该路径/目录的行，把名字换输入框。 */
function startSidebarRename(target: { path?: string; dir?: string }): void {
    const sel = target.path
        ? `.row-main[data-path="${CSS.escape(target.path)}"]`
        : `.row-main[data-dir="${CSS.escape(target.dir!)}"]`;
    const button = nav.querySelector<HTMLElement>(sel);
    if (!button) return;
    if (target.path) renameInline(button as HTMLButtonElement, target.path);
    else renameDirInline(button, target.dir!);
}

/** 新建动作（验收清单 7/10.4）：统一收进标题栏加号下拉；落盘后行内改名。 */
async function newNote(dir = ''): Promise<void> {
    const path = joinRel(dir, `${stamp()}.md`);
    try {
        await host.write(path, newNoteMarkdown());
        expandDirPath(dir);
        selectedDir = null;
        await open(path);
        await refreshList();
        startSidebarRename({ path });
    } catch (err) {
        saySave(`新建失败：${(err as Error).message}`);
    }
}

/** 新建文件夹：mkdir 空目录（不塞占位 md），落「新建文件夹」默认名后行内改名。 */
async function newFolder(dir = ''): Promise<void> {
    if (!host.mkdir) {
        saySave('当前宿主不支持空文件夹');
        return;
    }
    const taken = new Set(allDirs());
    for (const f of allFiles) if (f.folder) taken.add(f.path);
    let name = '新建文件夹';
    for (let i = 2; taken.has(joinRel(dir, name)); i++) name = `新建文件夹 ${i}`;
    const dirPath = joinRel(dir, name);
    try {
        await host.mkdir(dirPath);
        expandDirPath(dirPath);
        selectedDir = dirPath;
        await refreshList();
        startSidebarRename({ dir: dirPath });
    } catch (err) {
        saySave(`建文件夹失败：${(err as Error).message}`);
    }
}

/** 链入外部 md/html：粘贴绝对路径或系统选文件窗；经 links/ 链接，读写回原文件不拷贝。 */
async function linkOutside(): Promise<void> {
    if (!host.linkOutside) {
        saySave('当前宿主不支持外链');
        return;
    }
    const source = await folioPickSource(
        '链入外部 md / html（读写回原文件，不拷贝正文）',
        '粘贴绝对路径，如 D:\\docs\\note.md',
        host.browseDir
            ? () => folioBrowseFs('选择要链入的文档', 'file', (d) => host.browseDir!(d, 'file'))
            : host.pickFile?.bind(host),
    );
    if (!source) return;
    try {
        const path = await host.linkOutside(source.replace(/^["']|["']$/g, ''));
        await open(path);
        void refreshList();
    } catch (err) {
        saySave(`链入失败：${(err as Error).message}`);
    }
}

/** 导入文件夹：粘贴绝对路径或系统选文件夹窗 → links/<原名>/ 链入，不拷贝。 */
async function importFolderLink(): Promise<void> {
    if (!host.linkFolder) {
        saySave('当前宿主不支持文件夹链接');
        return;
    }
    const source = await folioPickSource(
        '导入文件夹（链入 links/，不拷贝）',
        '粘贴文件夹绝对路径，如 D:\\docs\\notes',
        host.browseDir
            ? () => folioBrowseFs('选择要链入的文件夹', 'dir', (d) => host.browseDir!(d, 'dir'))
            : host.pickFolder?.bind(host),
    );
    if (!source) return;
    try {
        const out = await host.linkFolder(source.replace(/^["']|["']$/g, ''));
        saySave(`已链接 ${out.count} 篇 → ${out.dir}`);
        void refreshList();
    } catch (err) {
        saySave(`导入文件夹失败：${(err as Error).message}`);
    }
}

async function relinkFolder(dir: string): Promise<void> {
    if (!host.relinkFolder) {
        saySave('当前宿主不支持更换路径');
        return;
    }
    const source = await folioPickSource(
        '更换文件夹源路径',
        '粘贴新文件夹绝对路径',
        host.browseDir
            ? () => folioBrowseFs('选择新文件夹', 'dir', (d) => host.browseDir!(d, 'dir'))
            : host.pickFolder?.bind(host),
    );
    if (!source) return;
    try {
        const out = await host.relinkFolder(dir, source);
        saySave(`已更换路径 → ${out.dir}`);
        await refreshList();
        if (openFile?.startsWith(`${dir}/`) && !allFiles.some((f) => f.path === openFile)) {
            openFile = null;
            destroyEditor();
            leafCrumb('未打开');
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
        ['external-link', '链入外部 md / html', () => void linkOutside()],
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
document.querySelector<HTMLButtonElement>('#btn-settings')!.addEventListener('click', () => {
    const libs = (['笔记', '速记', '外链', '图片', '附件'] as const).map((label, i) => {
        const dir = ['notes', 'memos', 'links', 'pics', 'attachments'][i];
        const countable = i < 3;
        return { label, dir: `${dir}/`, count: countable ? allFiles.filter((f) => f.path === dir || f.path.startsWith(`${dir}/`)).length : null };
    });
    openSettings({
        vault: { name: vaultName, dir: vaultAbsDir },
        libraries: libs,
        fileAssoc:
            host.defaultMdStatus && host.registerDefaultMd
                ? { status: () => host.defaultMdStatus!(), register: () => host.registerDefaultMd!() }
                : undefined,
    });
});

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
attachMediaHandlers(wrap, host, currentEditor, (msg) => saySave(msg));

// muya 在浏览器里把相对图片路径转成 file:// 必然失败，宿主层兜底补同源 img
attachImageFallback(wrap);

// 白名单视频链接内嵌正文流（单元 9，按验收反馈从底部面板改入正文）
attachInlineEmbeds(wrap);

/** 右键「复制路径」：库内相对路径拼成 OS 绝对路径（带盘符）。 */
async function copyAbsPath(rel: string): Promise<void> {
    const text = vaultAbsDir ? joinOsAbs(vaultAbsDir, rel) : rel;
    try {
        await navigator.clipboard.writeText(text);
        saySave(vaultAbsDir ? '已复制绝对路径' : '已复制路径');
    } catch {
        saySave('复制失败');
    }
}

// ==== 右键菜单（验收清单 4/14）====
installDesktopShellGuards();
installTitlebar();
blockNativeContextMenu(document.body);

/** 左栏文档右键。 */
nav.addEventListener('contextmenu', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-path]');
    if (!button) return;
    event.preventDefault();
    const path = button.dataset.path!;
    ensureContextTarget({ kind: 'file', id: path });
    if (selCount() > 1) {
        multiContextMenu(event.clientX, event.clientY);
        return;
    }
    const item = allFiles.find((f) => f.path === path);

    const targetOf = async (verb: string) => {
        const dirs = allDirs();
        const current = path.split('/').slice(0, -1).join('/');
        const dir = await folioPick(`${verb}到…`, dirs, current);
        if (dir === null) return null;
        const name = path.split('/').pop()!;
        return joinRel(dir, name);
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
        { ic: 'clipboard-text', label: '复制文档路径', run: () => void copyAbsPath(path) },
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
                leafCrumb('未打开');
                hideDocHead();
                renderCenterBar();
                writeLastView(null);
            }
            if (host.deleteDoc) await host.deleteDoc(path).catch((err: Error) => saySave(`删除失败：${err.message}`));
            await refreshList();
        })() },
    ]);
});

nav.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return;
    const t = event.target;
    if (!(t instanceof Node) || !nav.contains(t)) return;
    event.preventDefault();
    selectedFiles = new Set();
    selectedDirs = new Set();
    for (const it of visibleSideItems(nav)) {
        if (it.kind === 'file') selectedFiles.add(it.id);
        else selectedDirs.add(it.id);
    }
    paintSideSel();
});

function closeIfDeleted(files: string[], dirs: string[]): void {
    if (!openFile) return;
    if (!files.includes(openFile) && !dirs.some((d) => openFile === d || openFile!.startsWith(`${d}/`))) return;
    openFile = null;
    destroyEditor();
    document.querySelector<HTMLElement>('#app')?.classList.remove('html-mode');
    clearHtmlPreview();
    leafCrumb('未打开');
    hideDocHead();
    renderCenterBar();
    writeLastView(null);
}

async function movePaths(froms: string[], toDir: string): Promise<void> {
    if (!host.moveDoc) return;
    for (const from of froms) {
        const name = from.split('/').pop()!;
        const to = joinRel(toDir, name);
        if (to === from || to.startsWith(`${from}/`)) continue;
        try {
            await host.moveDoc(from, to);
        } catch (err) {
            saySave(`移动失败：${(err as Error).message}`);
        }
    }
    void refreshList();
}

function multiContextMenu(x: number, y: number): void {
    const n = selCount();
    showContextMenu(x, y, [
        { ic: 'arrow-move-up', label: `移动 ${n} 项到…`, run: () => void (async () => {
            const target = await folioPick('移动到…', allDirs());
            if (target === null || !host.moveDoc) return;
            const { files, dirs } = pruneNestedSel();
            const froms = [
                ...dirs.filter((dir) => target !== dir && !target.startsWith(`${dir}/`)),
                ...files,
            ];
            await movePaths(froms, target);
        })() },
        { sep: true },
        { ic: 'trash', label: `删除 ${n} 项`, danger: true, run: () => void (async () => {
            if (!(await folioConfirm(`删除选中的 ${n} 项？`))) return;
            const { files, dirs } = pruneNestedSel();
            closeIfDeleted(files, dirs);
            if (host.deleteDoc) {
                for (const dir of dirs) {
                    await host.deleteDoc(dir).catch((err: Error) => saySave(`删除失败：${err.message}`));
                    if (selectedDir === dir) selectedDir = null;
                }
                for (const path of files) {
                    await host.deleteDoc(path).catch((err: Error) => saySave(`删除失败：${err.message}`));
                }
            }
            selectedFiles = new Set();
            selectedDirs = new Set();
            await refreshList();
        })() },
    ]);
}

/** 文件夹右键（bug5）：与文档同款 + 顶部"添加子文件夹"。 */
function folderContextMenu(dir: string, x: number, y: number): void {
    const fold = siblingFolderFoldState(lastShown, dir);
    showContextMenu(x, y, [
        ...(dir.split('/').length === 2 && dir.startsWith('links/') ? [{
            ic: 'external-link',
            label: '更换路径',
            run: () => void relinkFolder(dir),
        }] : []),
        { ic: 'file-plus', label: '新建文档', run: () => void newNote(dir) },
        { ic: 'folder-plus', label: '添加子文件夹', run: () => void newFolder(dir) },
        { ic: 'pencil', label: '重命名文件夹', run: () => startSidebarRename({ dir }) },
        { ic: 'arrow-move-up', label: '移动到…', run: () => void (async () => {
            const target = await folioPick('移动文件夹到…', allDirs().filter((d) => d !== dir && !d.startsWith(`${dir}/`)), dir);
            if (target === null || !host.moveDoc) return;
            try {
                const dest = joinRel(target, dir.split('/').pop()!);
                await host.moveDoc(dir, dest);
                selectedDir = dest;
                void refreshList();
            } catch (err) {
                saySave(`移动失败：${(err as Error).message}`);
            }
        })() },
        { ic: 'clipboard-text', label: '复制文件夹路径', run: () => void copyAbsPath(dir) },
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
                leafCrumb('未打开');
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

/** 页顶大标题提交：只改当前打开文件的 stem，扩展名原样。不写 YAML title:。 */
async function renameCurrentDoc(stem: string): Promise<void> {
    if (!openFile || !host.moveDoc) return;
    const dest = renamedPath(openFile, stem);
    if (!dest) {
        renderTitle();
        return;
    }
    try {
        const from = openFile;
        const to = await host.moveDoc(from, dest);
        openFile = to;
        writeLastView({ v: 'file', path: to });
        renderBreadcrumb();
        paintToc();
        renderTitle();
        void refreshList();
    } catch (err) {
        saySave(`重命名失败：${(err as Error).message}`);
        renderTitle();
    }
}

/**
 * 清单行内改名：.file-name 换成输入框，回车/失焦提交、Esc 取消。
 * 输入框在 <button> 里：必须拦住点击，否则当成打开文档/选中目录，焦点被带走。
 */
function inlineEditRow(
    button: HTMLElement,
    opts: { value: string; commit: (text: string) => Promise<void> | void },
): void {
    const nameSpan = button.querySelector<HTMLElement>('.file-name');
    if (!nameSpan || button.querySelector('.rename-input')) return;
    const input = document.createElement('input');
    input.className = 'rename-input';
    input.value = opts.value;
    const stay = (event: Event) => event.stopPropagation();
    input.addEventListener('mousedown', stay);
    input.addEventListener('pointerdown', stay);
    input.addEventListener('click', stay);
    const blockOpen = (event: Event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    button.addEventListener('click', blockOpen, true);
    const wasDrag = button instanceof HTMLButtonElement ? button.draggable : false;
    if (button instanceof HTMLButtonElement) button.draggable = false;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const done = async (commit: boolean) => {
        if (finished) return;
        finished = true;
        button.removeEventListener('click', blockOpen, true);
        if (button instanceof HTMLButtonElement) button.draggable = wasDrag;
        const value = input.value.trim();
        if (input.isConnected) input.replaceWith(nameSpan);
        if (!commit || !value) return;
        await opts.commit(value);
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

/** 重命名：只改操作系统文件名，扩展名原样保留。不写 YAML title:、不改正文 H1。 */
function renameInline(button: HTMLButtonElement, path: string): void {
    if (!host.moveDoc) return;
    inlineEditRow(button, {
        value: fileNameStem(path),
        commit: async (stem) => {
            const dest = renamedPath(path, stem);
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
        },
    });
}

/** 文件夹行内改名：只改目录名，里面文档的路径整体跟着走。 */
function renameDirInline(button: HTMLElement, dir: string): void {
    if (!host.moveDoc) return;
    inlineEditRow(button, {
        value: dir.split('/').pop() ?? '',
        commit: async (name) => {
            const safe = name.replace(/[\\/:*?"<>|]/g, '_').trim();
            if (!safe || safe === dir.split('/').pop()) return;
            const parent = dir.split('/').slice(0, -1).join('/');
            const to = joinRel(parent, safe);
            try {
                await host.moveDoc!(dir, to);
                const shift = (p: string) => (p === dir ? to : `${to}${p.slice(dir.length)}`);
                selectedDirs = new Set([...selectedDirs].map((d) => (d === dir || d.startsWith(`${dir}/`) ? shift(d) : d)));
                if (selectedDir === dir || selectedDir?.startsWith(`${dir}/`)) selectedDir = shift(selectedDir);
                if (openFile?.startsWith(`${dir}/`)) {
                    openFile = shift(openFile);
                    writeLastView({ v: 'file', path: openFile });
                    renderBreadcrumb();
                    paintToc();
                }
                void refreshList();
            } catch (err) {
                saySave(`重命名失败：${(err as Error).message}`);
            }
        },
    });
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
        docScroll.scrollTop = map[path] ?? 0;
    } catch {
        docScroll.scrollTop = 0;
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
    leafCrumb('未打开');
    renderCenterBar();
}

async function switchToWorkspace(id: string): Promise<void> {
    if (!host.setWorkspace) return;
    if (activeWorkspaceId && id !== activeWorkspaceId) {
        writeLastViewFor(activeWorkspaceId, readLastView());
    }
    await leaveOpenDoc();
    if (id !== activeWorkspaceId) await host.setWorkspace(id);
    try {
        const ws = await host.listWorkspaces?.();
        if (ws) rememberVaultRoot(ws);
        else activeWorkspaceId = id;
    } catch {
        activeWorkspaceId = id;
    }
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

/**
 * 米米深链落位（docs/单篇路由-米米联动-实施计划.md）：doc 已在清单里匹配上才走到这。
 * 速记 → 进速记看法并把月历翻到该日；html → iframe 带 #fragment；md → 等两帧布局稳了滚到标题。
 */
async function revealDeepTarget(path: string, anchor: string | null): Promise<void> {
    if (allFiles.find((f) => f.path === path)?.kind === 'memo') {
        const day = memoDayFromPath(path);
        if (day) stageMemoDay(day);
        await enterMemos();
        return;
    }
    await open(path, isHtmlPath(path) && anchor ? anchor : undefined);
    await refreshList();
    if (!anchor || isHtmlPath(path)) return;
    const editor = currentEditor();
    if (!editor) return;
    // Muya 在 mountEditor 里同步出 DOM（restoreScroll 同款时序），不用等帧——
    // rAF 在无头/后台页不执行，会把落位整个吞掉
    const index = matchHeadingIndex(editor.getTOC().map((t) => t.content), anchor);
    if (index >= 0) scrollToHeading(index);
    else document.querySelector('#doc-head')?.scrollIntoView({ block: 'start' });
}

void (async () => {
    if (host.listWorkspaces) {
        try {
            const ws = await host.listWorkspaces();
            rememberVaultRoot(ws);
        } catch {
            /* 服务还没起来时先按默认 vault */
        }
    }
    await refreshList();
    // 双击关联文件启动（?open=绝对路径）优先于深链与上次视图：库外先按 links/ 规矩链入再开
    const deep = parseDeepLink(location.search);
    if (deep.open && host.openExternal) {
        try {
            const { path } = await host.openExternal(deep.open);
            await refreshList();
            await open(path);
            return;
        } catch (err) {
            saySave(`打开失败：${err instanceof Error ? err.message : String(err)}`);
        }
    }
    // 深链（?doc=&anchor=）优先于上次视图；匹配不上静默落默认流程，参数留在 URL 里刷新仍落原位
    const deepPath = deep.doc ? matchDocPath(allFiles, deep.doc) : null;
    if (deepPath) {
        await revealDeepTarget(deepPath, deep.anchor);
        return;
    }
    const last = (activeWorkspaceId ? readLastViewFor(activeWorkspaceId) : null) ?? readLastView();
    if (last) persistView(last);
    await restoreLastView();
})();
