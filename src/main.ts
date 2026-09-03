import './theme/app.css';
import './theme/tokens.css';
import './theme/tokens-dark.css';
import { wordCount } from '@muyajs/core';
import { createHost } from './host/index.ts';
import { currentEditor, destroyEditor, mountEditor } from './ui/editorHost.ts';
import { attachMediaHandlers } from './ui/mediaPaste.ts';
import { attachImageFallback } from './ui/imageFallback.ts';
import { renderMemoTimeline, renderSidebar, renderTagBar } from './ui/sidebar.ts';
import { attachInlineEmbeds } from './ui/embeds.ts';
import { highlightActive, renderToc } from './ui/toc.ts';
import { attachWikilinkHandlers, renderBacklinks } from './ui/wikilink.ts';
import { setScalar, setTags, splitFrontmatter } from './shared/frontmatter.ts';
import type { FolioListItem } from './host/types.ts';

/**
 * 页面编排：侧栏选文件 → host.read → Muya 编辑 → json-change 防抖 → host.write。
 * 真源是盘上的 md；编辑器只是视图（AGENTS.md 硬规则 3）。
 */
const host = createHost();

const nav = document.querySelector<HTMLElement>('#files')!;
const tagbar = document.querySelector<HTMLElement>('#tagbar')!;
const breadcrumbEl = document.querySelector<HTMLElement>('#breadcrumb')!;
const favoriteBtn = document.querySelector<HTMLButtonElement>('#favorite-toggle')!;
const listSearch = document.querySelector<HTMLInputElement>('#list-search')!;
const filterbar = document.querySelector<HTMLElement>('#filterbar')!;
const wrap = document.querySelector<HTMLElement>('#editor-wrap')!;
const saveStateEl = document.querySelector<HTMLElement>('#save-state')!;
const newMemoBtn = document.querySelector<HTMLButtonElement>('#new-memo')!;

let openFile: string | null = null;
let lastSaved = '';
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let activeTag: string | null = null;
let allFiles: FolioListItem[] = [];
let view: 'all' | 'notes' | 'memos' = 'all';
let searchQ = '';
let dirFilter: string | null = null;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

function saySave(message: string): void {
    saveStateEl.textContent = message;
}

async function saveNow(markdown: string): Promise<void> {
    if (!openFile) return;
    if (markdown === lastSaved) return;
    try {
        await host.write(openFile, markdown);
        lastSaved = markdown;
        saySave(`已存 ${new Date().toLocaleTimeString()}`);
        void refreshList();
        void refreshBacklinks();
    } catch (err) {
        saySave(`存失败：${(err as Error).message}`);
    }
}

/**
 * 文档属性面板（Obsidian 式）：文档顶部一行行 key-value；tags 行是芯片可增删，
 * 其余键只读展示（md 里的 frontmatter 原样保留）。编辑器里的 frontmatter 块收起。
 */
function renderProps(): void {
    const editor = currentEditor();
    propsEl.replaceChildren();
    if (!openFile || !editor) {
        propsEl.hidden = true;
        return;
    }
    propsEl.hidden = false;

    const commit = (next: string[]) => {
        const ed = currentEditor();
        if (!ed || !openFile) return;
        ed.replaceContent(setTags(ed.getMarkdown(), next));
        // 走统一链路：改动中… → 防抖存盘 → 刷列表 → 面板随 allFiles 更新
        onEditorChange(ed.getMarkdown());
    };

    const row = (key: string, value: Node): void => {
        const line = document.createElement('div');
        line.className = 'prop-row';
        const k = document.createElement('span');
        k.className = 'prop-key';
        k.textContent = key;
        line.append(k, value);
        propsEl.append(line);
    };

    // tags 行：芯片 + ＋（始终给，方便新文档打标）
    const tagsValue = document.createElement('span');
    tagsValue.className = 'prop-tags';
    const tags = allFiles.find((f) => f.path === openFile)?.tags ?? [];
    for (const tag of tags) {
        const chip = document.createElement('span');
        chip.className = 'doc-tag';
        chip.append(document.createTextNode(tag));
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

    // 其余键按原顺序只读展示
    const { frontmatter } = splitFrontmatter(editor.getMarkdown());
    for (const lineText of (frontmatter ?? '').split('\n')) {
        const pair = lineText.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
        if (!pair || pair[1].toLowerCase() === 'tags') continue;
        const v = document.createElement('span');
        v.className = 'prop-value';
        v.textContent = pair[2] || '—';
        row(pair[1], v);
    }
}

async function refreshBacklinks(): Promise<void> {
    if (!openFile || !host.index) return;
    try {
        const index = await host.index(openFile);
        renderBacklinks(backlinksEl, index, {
            titleOf: (p) => allFiles.find((f) => f.path === p)?.title ?? p.replace(/\.md$/i, ''),
            onOpen: (p) => void open(p),
        });
    } catch {
        backlinksEl.replaceChildren();
    }
}

/** 点击未命中的 wikilink → 在 notes/ 建页并打开（Foam 规则）。 */
async function createAndOpen(path: string): Promise<void> {
    const name = path.replace(/^notes\//, '').replace(/\.md$/i, '');
    await host.write(path, `# ${name}\n`);
    await open(path);
    void refreshList();
}

function onEditorChange(markdown: string): void {
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
    const md = markdown ?? currentEditor()?.getMarkdown();
    if (md !== undefined) {
        const { word } = wordCount(md);
        statWords.textContent = `${word} 字`;
    }
    clearTimeout(tocTimer);
    tocTimer = setTimeout(() => renderToc(tocEl, currentEditor()), 300);
}

async function open(path: string): Promise<void> {
    try {
        // 切文件前把上一篇落盘
        if (openFile && currentEditor()) await saveNow(currentEditor()!.getMarkdown());
        clearTimeout(saveTimer);
        const doc = await host.read(path);
        openFile = doc.path;
        lastSaved = doc.markdown;
        renderBreadcrumb();
        syncFavoriteBtn();
        saySave('');
        mountEditor(wrap, doc.markdown, host, onEditorChange);
        renderProps();
        renderStatusbar(doc.markdown);
        renderToc(tocEl, currentEditor());
        void refreshBacklinks();
    } catch (err) {
        saySave(`读失败：${(err as Error).message}`);
    }
}

/** 面包屑（单元 13）：路径逐级可点，点哪层就把清单筛到哪层。 */
function renderBreadcrumb(): void {
    breadcrumbEl.replaceChildren();
    if (!openFile) {
        breadcrumbEl.textContent = '未打开';
        return;
    }
    const segments = openFile.split('/');
    segments.forEach((seg, i) => {
        const isLast = i === segments.length - 1;
        if (!isLast) {
            const crumb = document.createElement('button');
            crumb.type = 'button';
            crumb.className = 'crumb';
            crumb.textContent = seg;
            const dir = segments.slice(0, i + 1).join('/');
            crumb.addEventListener('click', () => {
                dirFilter = dir;
                searchQ = '';
                listSearch.value = '';
                void refreshList();
            });
            const sep = document.createElement('span');
            sep.className = 'crumb-sep';
            sep.textContent = '/';
            breadcrumbEl.append(crumb, sep);
        } else {
            const crumb = document.createElement('span');
            crumb.textContent = seg;
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

const backlinksEl = document.querySelector<HTMLElement>('#backlinks')!;
const propsEl = document.querySelector<HTMLElement>('#props')!;
const tocEl = document.querySelector<HTMLElement>('#toc')!;
const statCount = document.querySelector<HTMLElement>('#stat-count')!;
const statWords = document.querySelector<HTMLElement>('#stat-words')!;
const findbarEl = document.querySelector<HTMLElement>('#findbar')!;
const findInput = document.querySelector<HTMLInputElement>('#find-input')!;
const findCount = document.querySelector<HTMLElement>('#find-count')!;
const replaceInput = document.querySelector<HTMLInputElement>('#replace-input')!;

async function refreshList(): Promise<void> {
    try {
        // 搜索态：全文搜索结果直接当清单（含上下文行）
        if (searchQ && host.search) {
            const hits = await host.search(searchQ);
            allFiles = await host.list();
            renderPills();
            renderTagBar(tagbar, allFiles, null, () => undefined);
            renderSidebar(nav, hits, { activePath: openFile, onOpen: (p) => void open(p) });
            renderStatusbar();
            return;
        }
        const files = await host.list();
        allFiles = files;
        // 筛选走 host.list(opts)（单元 6 契约），标签并集来自全量
        const tagged = activeTag ? await host.list({ tag: activeTag }) : files;
        let shown = tagged;
        if (dirFilter) shown = shown.filter((f) => f.path.startsWith(`${dirFilter}/`));
        if (view === 'notes') shown = shown.filter((f) => f.kind === 'note');
        if (view === 'memos') shown = shown.filter((f) => f.kind === 'memo');
        renderPills();
        renderTagBar(tagbar, files, activeTag, (tag) => {
            activeTag = activeTag === tag ? null : tag;
            void refreshList();
        });
        renderStatusbar();
        if (view === 'memos') {
            renderMemoTimeline(nav, shown, {
                activePath: openFile,
                onOpen: (p) => void open(p),
            });
        } else {
            const favorites = files.filter((f) => f.favorite && (!dirFilter || f.path.startsWith(`${dirFilter}/`)));
            renderSidebar(nav, shown.filter((f) => !f.favorite), {
                activePath: openFile,
                onOpen: (p) => void open(p),
                favorites,
            });
        }
        renderProps();
        syncFavoriteBtn();
    } catch (err) {
        saySave(`列目录失败：${(err as Error).message}`);
    }
}

/** 筛选 pills（单元 13）：全部/长文/速记 + 计数；目录过滤生效时给出口。 */
function renderPills(): void {
    const counts = {
        all: allFiles.length,
        notes: allFiles.filter((f) => f.kind === 'note').length,
        memos: allFiles.filter((f) => f.kind === 'memo').length,
    };
    const labels: Record<string, string> = {
        all: `全部 ${counts.all}`,
        notes: `长文 ${counts.notes}`,
        memos: `速记 ${counts.memos}`,
    };
    filterbar.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach((button) => {
        const key = button.dataset.view as keyof typeof counts;
        button.textContent = labels[key] ?? '';
        button.setAttribute('aria-pressed', String(view === key));
    });
    let chip = filterbar.querySelector<HTMLButtonElement>('#dir-chip');
    if (dirFilter) {
        if (!chip) {
            chip = document.createElement('button');
            chip.id = 'dir-chip';
            chip.type = 'button';
            chip.title = '清除目录过滤';
            chip.addEventListener('click', () => {
                dirFilter = null;
                void refreshList();
            });
            filterbar.prepend(chip);
        }
        chip.textContent = `× ${dirFilter}`;
    } else {
        chip?.remove();
    }
}

function setView(next: 'all' | 'notes' | 'memos'): void {
    view = next;
    newMemoBtn.hidden = next !== 'memos';
    void refreshList();
}

filterbar.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-view]');
    if (button) setView(button.dataset.view as 'all' | 'notes' | 'memos');
});

listSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        searchQ = listSearch.value.trim();
        void refreshList();
    }, 250);
});

/** 新建速记：memos/<日期时间>.md，frontmatter 留好 tags（单元 8）。 */
async function newMemo(): Promise<void> {
    const stamp = new Date()
        .toLocaleString('sv', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .replace(/[\s:]/g, '-');
    const path = `memos/${stamp}.md`;
    try {
        await host.write(path, '---\ntags: []\n---\n\n');
        await open(path);
        void refreshList();
    } catch (err) {
        saySave(`新建失败：${(err as Error).message}`);
    }
}

newMemoBtn.addEventListener('click', () => void newMemo());

/** 链入库外 md（单元 10）：只在 vault 里放链接，读写穿透回原文件。 */
document.querySelector<HTMLButtonElement>('#link-outside')!.addEventListener('click', async () => {
    if (!host.linkOutside) return;
    const source = window.prompt('库外 md 的绝对路径（读写都会回这个文件，不拷贝）：');
    if (!source) return;
    try {
        const path = await host.linkOutside(source.trim().replace(/^["']|["']$/g, ''));
        await open(path);
        void refreshList();
    } catch (err) {
        saySave(`链入失败：${(err as Error).message}`);
    }
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

document.querySelector<HTMLButtonElement>('#find-toggle')!.addEventListener('click', () => {
    if (findbarEl.hidden) findbarShow();
    else findbarHide();
});
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
window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && openFile) {
        event.preventDefault();
        findbarShow();
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

// 滚动时高亮 TOC 当前节（单元 12）
let scrollTimer: ReturnType<typeof setTimeout> | undefined;
wrap.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => highlightActive(tocEl), 150);
});

// 明暗主题（单元 12）：只切 data-theme，值都在 tokens-dark.css
const themeToggle = document.querySelector<HTMLButtonElement>('#theme-toggle')!;
function applyTheme(mode: 'light' | 'dark'): void {
    document.documentElement.dataset.theme = mode;
    themeToggle.textContent = mode === 'dark' ? '亮色' : '暗色';
    localStorage.setItem('folio-theme', mode);
}
applyTheme((localStorage.getItem('folio-theme') as 'light' | 'dark') ?? 'light');
themeToggle.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

void refreshList();
