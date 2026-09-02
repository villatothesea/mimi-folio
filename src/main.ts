import './theme/app.css';
import './theme/tokens.css';
import { createHost } from './host/index.ts';
import { currentEditor, destroyEditor, mountEditor } from './ui/editorHost.ts';
import { attachMediaHandlers } from './ui/mediaPaste.ts';
import { renderSidebar } from './ui/sidebar.ts';

/**
 * 页面编排：侧栏选文件 → host.read → Muya 编辑 → json-change 防抖 → host.write。
 * 真源是盘上的 md；编辑器只是视图（AGENTS.md 硬规则 3）。
 */
const host = createHost();

const nav = document.querySelector<HTMLElement>('#files')!;
const wrap = document.querySelector<HTMLElement>('#editor-wrap')!;
const currentPathEl = document.querySelector<HTMLElement>('#current-path')!;
const saveStateEl = document.querySelector<HTMLElement>('#save-state')!;

let openFile: string | null = null;
let lastSaved = '';
let saveTimer: ReturnType<typeof setTimeout> | undefined;

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
    } catch (err) {
        saySave(`存失败：${(err as Error).message}`);
    }
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
    } catch (err) {
        saySave(`读失败：${(err as Error).message}`);
    }
}

async function refreshList(): Promise<void> {
    try {
        const files = await host.list();
        renderSidebar(nav, files, { activePath: openFile, onOpen: (p) => void open(p) });
    } catch (err) {
        saySave(`列目录失败：${(err as Error).message}`);
    }
}

window.addEventListener('beforeunload', (event) => {
    if (openFile && currentEditor() && currentEditor()!.getMarkdown() !== lastSaved) {
        event.preventDefault();
    }
});
window.addEventListener('pagehide', () => {
    if (openFile && currentEditor()) void saveNow(currentEditor()!.getMarkdown());
    destroyEditor();
});

// 音视频/图片文件的粘贴与拖放落盘（单元 4）；外壳常驻，编辑器重建不受影响
attachMediaHandlers(wrap, host, currentEditor);

void refreshList();
