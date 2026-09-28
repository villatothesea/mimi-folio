/**
 * 工作区：点底栏图标打开和设置一样的居中弹窗。
 * 工作区 = 一座 vault 目录，只改人看哪一堆文件，不写进 md。
 */
import type { FolioHost, FolioWorkspace } from '../host/types.ts';
import { folioBrowseFs, folioConfirm, folioPrompt } from './dialogs.ts';
import { icon } from './icons';
import { lockAppOverlay } from './overlayLock.ts';
import { shortWorkspaceDir } from '../shared/workspaces.ts';

export type WorkspaceUiOptions = {
    host: FolioHost;
    onSwitch: (id: string) => Promise<void>;
    onCreated: (id: string) => Promise<void>;
    say: (message: string) => void;
};

export function attachWorkspaceMenu(btn: HTMLButtonElement, opts: WorkspaceUiOptions): void {
    btn.innerHTML = icon('window');
    btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const existing = document.querySelector('#ws-overlay');
        if (existing) {
            existing.remove();
            btn.setAttribute('aria-expanded', 'false');
            return;
        }
        void openWorkspaceDialog(btn, opts);
    });
}

async function loadList(host: FolioHost): Promise<{ items: FolioWorkspace[]; activeId: string }> {
    if (!host.listWorkspaces) return { items: [], activeId: '' };
    return host.listWorkspaces();
}

async function openWorkspaceDialog(btn: HTMLButtonElement, opts: WorkspaceUiOptions): Promise<void> {
    document.querySelector('#ws-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'ws-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', '工作区');
    btn.setAttribute('aria-expanded', 'true');

    const panel = document.createElement('div');
    panel.className = 'settings-panel ws-panel';

    const head = document.createElement('div');
    head.className = 'settings-head';
    head.append(Object.assign(document.createElement('span'), { textContent: '工作区' }));
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'icon-btn';
    closeBtn.innerHTML = icon('x');
    head.append(closeBtn);

    const body = document.createElement('div');
    body.className = 'ws-dialog-body';
    const list = document.createElement('div');
    list.id = 'ws-list';
    body.append(list);

    const add = document.createElement('div');
    add.id = 'ws-add';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'ws-add-toggle';
    toggle.innerHTML = `${icon('plus')}<span>添加工作区</span>`;
    add.append(toggle);
    body.append(add);

    panel.append(head, body);
    overlay.append(panel);

    let picking = false;
    let adding = false;
    const unlockApp = lockAppOverlay();

    const close = (): void => {
        overlay.remove();
        btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('keydown', onKey);
        unlockApp();
    };

    const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && !picking && !document.querySelector('.folio-modal')) close();
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('mousedown', (event) => {
        if (picking) return;
        if (event.target === overlay) close();
    });

    const paint = async (): Promise<void> => {
        const state = await loadList(opts.host);
        list.replaceChildren();
        for (const item of state.items) {
            list.append(card(item, state.activeId, opts, close, paint));
        }
    };

    toggle.addEventListener('click', () => {
        adding = !adding;
        document.querySelector('#ws-add-form')?.remove();
        if (!adding) return;
        const form = document.createElement('div');
        form.id = 'ws-add-form';
        const name = document.createElement('input');
        name.type = 'text';
        name.placeholder = '工作区名称';
        name.autocomplete = 'off';
        const dirInput = document.createElement('input');
        dirInput.type = 'text';
        dirInput.placeholder = '目录路径（可粘贴绝对路径）';
        dirInput.autocomplete = 'off';
        const row = document.createElement('div');
        row.className = 'ws-add-actions';
        const pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'ws-pick';
        pick.textContent = '浏览…';
        const createBtn = document.createElement('button');
        createBtn.type = 'button';
        createBtn.className = 'ws-create';
        createBtn.textContent = '创建';
        row.append(pick, createBtn);
        form.append(name, dirInput, row);
        add.append(form);
        name.focus();

        const syncCreate = (): void => {
            createBtn.disabled = !dirInput.value.trim();
        };
        syncCreate();
        dirInput.addEventListener('input', syncCreate);

        const create = async (): Promise<void> => {
            if (!opts.host.addWorkspace) return;
            const dir = dirInput.value.trim();
            if (!dir) {
                opts.say('请先选择或输入目录路径');
                return;
            }
            const label = name.value.trim() || dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '工作区';
            try {
                const created = await opts.host.addWorkspace(label, dir);
                close();
                await opts.onCreated(created.id);
            } catch (err) {
                opts.say(`新建失败：${(err as Error).message}`);
            }
        };

        pick.addEventListener('click', (event) => {
            event.stopPropagation();
            void (async () => {
                const browseDir = opts.host.browseDir;
                const pickFolder = opts.host.pickFolder;
                if (!browseDir && !pickFolder) {
                    opts.say('当前环境不支持选文件夹，请直接粘贴路径');
                    dirInput.focus();
                    return;
                }
                picking = true;
                const prev = pick.textContent;
                pick.disabled = true;
                pick.textContent = '正在打开…';
                opts.say('正在打开选文件夹窗…');
                try {
                    const dir = browseDir
                        ? await folioBrowseFs('选择工作区目录', 'dir', (d) => browseDir(d, 'dir'))
                        : await pickFolder!();
                    if (!dir) {
                        opts.say('未选择文件夹，可手动粘贴路径');
                        dirInput.focus();
                        return;
                    }
                    dirInput.value = dir;
                    dirInput.title = dir;
                    syncCreate();
                } catch (err) {
                    opts.say(`选文件夹失败：${(err as Error).message}`);
                    dirInput.focus();
                } finally {
                    picking = false;
                    pick.disabled = false;
                    pick.textContent = prev;
                }
            })();
        });
        createBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            void create();
        });
        dirInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && dirInput.value.trim()) {
                event.preventDefault();
                void create();
            }
        });
        name.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && dirInput.value.trim()) {
                event.preventDefault();
                void create();
            }
        });
    });

    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    await paint();
}

function card(
    item: FolioWorkspace,
    activeId: string,
    opts: WorkspaceUiOptions,
    close: () => void,
    paint: () => Promise<void>,
): HTMLElement {
    const row = document.createElement('div');
    row.className = 'ws-card';
    if (item.id === activeId) row.setAttribute('aria-current', 'true');

    const actions = document.createElement('div');
    actions.className = 'ws-card-actions';
    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'icon-btn';
    renameBtn.dataset.tip = '重命名';
    renameBtn.innerHTML = icon('pencil');
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'icon-btn';
    delBtn.dataset.tip = '删除';
    delBtn.innerHTML = icon('trash');
    actions.append(renameBtn, delBtn);

    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'ws-card-body';
    const title = document.createElement('span');
    title.className = 'ws-card-name';
    title.textContent = item.name;
    const dir = document.createElement('span');
    dir.className = 'ws-card-dir';
    dir.textContent = shortWorkspaceDir(item.dir);
    dir.title = item.dir;
    body.append(title, dir);

    body.addEventListener('click', () => {
        if (item.id === activeId) {
            close();
            return;
        }
        close();
        void opts.onSwitch(item.id);
    });

    renameBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        void (async () => {
            if (!opts.host.renameWorkspace) return;
            const next = await folioPrompt('工作区名称', item.name);
            if (!next || next === item.name) return;
            try {
                await opts.host.renameWorkspace(item.id, next);
                await paint();
            } catch (err) {
                opts.say(`改名失败：${(err as Error).message}`);
            }
        })();
    });

    delBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        void (async () => {
            if (!opts.host.deleteWorkspace) return;
            if (!await folioConfirm(`删除工作区「${item.name}」？目录里的文件不会删。`, '删除')) return;
            try {
                const wasActive = item.id === activeId;
                await opts.host.deleteWorkspace(item.id);
                if (wasActive) {
                    const next = await loadList(opts.host);
                    close();
                    await opts.onSwitch(next.activeId);
                    return;
                }
                await paint();
            } catch (err) {
                opts.say(`删除失败：${(err as Error).message}`);
            }
        })();
    });

    row.append(actions, body);
    return row;
}
