import './theme/app.css';
import './theme/tokens.css';
import { createHost } from './host/index.ts';
import { currentEditor, destroyEditor, mountEditor } from './ui/editorHost.ts';

/**
 * 页面编排：列表选文件 → host.read → Muya 编辑 → json-change 防抖 → host.write。
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

async function open(path: string, button?: HTMLButtonElement): Promise<void> {
    try {
        // 切文件前把上一篇落盘
        if (openFile && currentEditor()) await saveNow(currentEditor()!.getMarkdown());
        clearTimeout(saveTimer);
        const doc = await host.read(path);
        openFile = doc.path;
        lastSaved = doc.markdown;
        currentPathEl.textContent = doc.path;
        saySave('');
        mountEditor(wrap, doc.markdown, onEditorChange);
        markCurrent(button);
    } catch (err) {
        saySave(`读失败：${(err as Error).message}`);
    }
}

function markCurrent(button?: HTMLButtonElement): void {
    nav.querySelectorAll('button').forEach((b) => b.removeAttribute('aria-current'));
    button?.setAttribute('aria-current', 'true');
}

async function refreshList(): Promise<void> {
    try {
        const files = await host.list();
        nav.replaceChildren(
            ...files.map((file) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = file.title;
                button.title = file.path;
                button.addEventListener('click', () => void open(file.path, button));
                return button;
            }),
        );
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

void refreshList();
