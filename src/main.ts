import './theme/tokens.css';
import { createHost } from './host/index.ts';

/**
 * 单元 0 骨架页：列表 → 读 → 改 → 存，证明 host 契约通。
 * 单元 1 起 textarea 换成 Muya，这里的 host 用法不变。
 */
const host = createHost();

const nav = document.querySelector<HTMLElement>('#files')!;
const editor = document.querySelector<HTMLTextAreaElement>('#editor')!;
const currentPath = document.querySelector<HTMLSpanElement>('#current-path')!;
const saveBtn = document.querySelector<HTMLButtonElement>('#save')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;

let openFile: string | null = null;

function say(message: string): void {
    status.textContent = message;
}

function markCurrent(button: HTMLButtonElement): void {
    nav.querySelectorAll('button').forEach((b) => b.removeAttribute('aria-current'));
    if (button) button.setAttribute('aria-current', 'true');
}

async function open(path: string, button?: HTMLButtonElement): Promise<void> {
    try {
        const doc = await host.read(path);
        openFile = doc.path;
        editor.value = doc.markdown;
        editor.disabled = false;
        saveBtn.disabled = false;
        currentPath.textContent = doc.path;
        if (button) markCurrent(button);
        say('');
    } catch (err) {
        say(`读失败：${(err as Error).message}`);
    }
}

async function save(): Promise<void> {
    if (!openFile) return;
    try {
        await host.write(openFile, editor.value);
        say(`已存 ${new Date().toLocaleTimeString()}`);
    } catch (err) {
        say(`存失败：${(err as Error).message}`);
    }
}

async function refreshList(): Promise<void> {
    try {
        const files = await host.list();
        nav.textContent = '';
        for (const file of files) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = file.title;
            button.title = file.path;
            button.addEventListener('click', () => void open(file.path, button));
            nav.append(button);
        }
        say(files.length ? '' : 'vault 里还没有 .md');
    } catch (err) {
        say(`列目录失败：${(err as Error).message}`);
    }
}

saveBtn.addEventListener('click', () => void save());
editor.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        void save();
    }
});

void refreshList();
