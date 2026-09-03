import './theme/app.css';
import './theme/tokens.css';
import { createHost } from './host/index.ts';
import { currentEditor, destroyEditor, mountEditor } from './ui/editorHost.ts';
import { attachMediaHandlers } from './ui/mediaPaste.ts';
import { attachImageFallback } from './ui/imageFallback.ts';
import { renderMemoTimeline, renderSidebar, renderTagBar } from './ui/sidebar.ts';
import { attachInlineEmbeds } from './ui/embeds.ts';
import { attachWikilinkHandlers, renderBacklinks } from './ui/wikilink.ts';
import type { FolioListItem } from './host/types.ts';

/**
 * 页面编排：侧栏选文件 → host.read → Muya 编辑 → json-change 防抖 → host.write。
 * 真源是盘上的 md；编辑器只是视图（AGENTS.md 硬规则 3）。
 */
const host = createHost();

const nav = document.querySelector<HTMLElement>('#files')!;
const tagbar = document.querySelector<HTMLElement>('#tagbar')!;
const wrap = document.querySelector<HTMLElement>('#editor-wrap')!;
const currentPathEl = document.querySelector<HTMLElement>('#current-path')!;
const saveStateEl = document.querySelector<HTMLElement>('#save-state')!;
const viewNotesBtn = document.querySelector<HTMLButtonElement>('#view-notes')!;
const viewMemosBtn = document.querySelector<HTMLButtonElement>('#view-memos')!;
const newMemoBtn = document.querySelector<HTMLButtonElement>('#new-memo')!;

let openFile: string | null = null;
let lastSaved = '';
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let activeTag: string | null = null;
let allFiles: FolioListItem[] = [];
let view: 'notes' | 'memos' = 'notes';

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

/** 当前文档的标签芯片（点 1）：frontmatter 的 tags 以小芯片显示在正文上方。 */
function renderDocTags(): void {
    const tags = allFiles.find((f) => f.path === openFile)?.tags ?? [];
    docTagsEl.replaceChildren();
    for (const tag of tags) {
        const chip = document.createElement('span');
        chip.className = 'doc-tag';
        chip.textContent = tag;
        docTagsEl.append(chip);
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
    if (markdown === lastSaved) return;
    saySave('改动中…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveNow(markdown), 400);
}

async function open(path: string): Promise<void> {
    try {
        // 切文件前把上一篇落盘
        if (openFile && currentEditor()) await saveNow(currentEditor()!.getMarkdown());
        clearTimeout(saveTimer);
        const doc = await host.read(path);
        openFile = doc.path;
        lastSaved = doc.markdown;
        currentPathEl.textContent = doc.path;
        saySave('');
        mountEditor(wrap, doc.markdown, host, onEditorChange);
        renderDocTags();
        void refreshBacklinks();
    } catch (err) {
        saySave(`读失败：${(err as Error).message}`);
    }
}

const backlinksEl = document.querySelector<HTMLElement>('#backlinks')!;
const docTagsEl = document.querySelector<HTMLElement>('#doc-tags')!;

async function refreshList(): Promise<void> {
    try {
        const files = await host.list();
        allFiles = files;
        // 筛选走 host.list(opts)（单元 6 契约），标签并集来自全量
        const shown = activeTag ? await host.list({ tag: activeTag }) : files;
        renderTagBar(tagbar, files, activeTag, (tag) => {
            activeTag = activeTag === tag ? null : tag;
            void refreshList();
        });
        if (view === 'memos') {
            renderMemoTimeline(nav, shown.filter((f) => f.kind === 'memo'), {
                activePath: openFile,
                onOpen: (p) => void open(p),
            });
        } else {
            renderSidebar(nav, shown.filter((f) => f.kind !== 'memo'), {
                activePath: openFile,
                onOpen: (p) => void open(p),
            });
        }
        renderDocTags();
    } catch (err) {
        saySave(`列目录失败：${(err as Error).message}`);
    }
}

function setView(next: 'notes' | 'memos'): void {
    view = next;
    viewNotesBtn.setAttribute('aria-pressed', String(next === 'notes'));
    viewMemosBtn.setAttribute('aria-pressed', String(next === 'memos'));
    newMemoBtn.hidden = next !== 'memos';
    void refreshList();
}

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

viewNotesBtn.addEventListener('click', () => setView('notes'));
viewMemosBtn.addEventListener('click', () => setView('memos'));
newMemoBtn.addEventListener('click', () => void newMemo());

window.addEventListener('beforeunload', (event) => {
    if (openFile && currentEditor() && currentEditor()!.getMarkdown() !== lastSaved) {
        event.preventDefault();
    }
});
window.addEventListener('pagehide', () => {
    if (openFile && currentEditor()) void saveNow(currentEditor()!.getMarkdown());
    destroyEditor();
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

void refreshList();
