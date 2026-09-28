/**
 * 自定义弹窗（验收清单 5）：替代浏览器原生 prompt/confirm/alert，直角矩形。
 * 全部 Promise 化：folioPrompt()/folioConfirm()。
 */
import { dirPickRows } from '../shared/dirPick.ts';
import { bindScrollFade, unbindScrollFade } from './scrollFade.ts';

function shell(title: string, danger = false, onDismiss?: () => void): { overlay: HTMLDivElement; box: HTMLDivElement; close(): void } {
    const overlay = document.createElement('div');
    overlay.className = 'folio-modal';
    const box = document.createElement('div');
    box.className = 'folio-modal-box';
    if (danger) box.classList.add('danger');
    const head = document.createElement('div');
    head.className = 'folio-modal-title';
    head.textContent = title;
    box.append(head);
    overlay.append(box);
    document.body.append(overlay);
    overlay.addEventListener('mousedown', (e) => {
        if (e.target !== overlay) return;
        if (onDismiss) onDismiss();
        else overlay.remove();
    });
    return { overlay, box, close: () => overlay.remove() };
}

export function folioPrompt(title: string, defaultValue = ''): Promise<string | null> {
    return new Promise((resolve) => {
        const ui = shell(title);
        const input = document.createElement('input');
        input.className = 'folio-modal-input';
        input.value = defaultValue;
        ui.box.append(input);
        const row = document.createElement('div');
        row.className = 'folio-modal-actions';
        const ok = document.createElement('button');
        ok.textContent = '确定';
        const cancel = document.createElement('button');
        cancel.textContent = '取消';
        row.append(ok, cancel);
        ui.box.append(row);
        input.focus();
        input.select();
        const done = (v: string | null) => {
            ui.close();
            resolve(v);
        };
        ok.addEventListener('click', () => done(input.value.trim() || null));
        cancel.addEventListener('click', () => done(null));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') done(input.value.trim() || null);
            if (e.key === 'Escape') done(null);
        });
    });
}

/**
 * 路径来源弹窗：输入框可直接粘贴绝对路径；宿主给了系统选框时多一个「浏览…」。
 * 确定回非空串，取消/关闭回 null。
 */
export function folioPickSource(
    title: string,
    placeholder: string,
    browse?: () => Promise<string | null>,
): Promise<string | null> {
    return new Promise((resolve) => {
        const ui = shell(title);
        const done = (v: string | null) => {
            ui.close();
            resolve(v);
        };
        const input = document.createElement('input');
        input.className = 'folio-modal-input';
        input.placeholder = placeholder;
        ui.box.append(input);
        const hint = document.createElement('div');
        hint.className = 'folio-modal-hint';
        hint.hidden = true;
        ui.box.append(hint);
        const row = document.createElement('div');
        row.className = 'folio-modal-actions';
        const ok = document.createElement('button');
        ok.textContent = '确定';
        const cancel = document.createElement('button');
        cancel.textContent = '取消';
        if (browse) {
            const pick = document.createElement('button');
            pick.textContent = '浏览…';
            pick.className = 'browse';
            pick.addEventListener('click', () => {
                pick.disabled = true;
                void browse()
                    .then((v) => {
                        if (v) done(v);
                    })
                    .catch((err: unknown) => {
                        hint.textContent = err instanceof Error ? err.message : String(err);
                        hint.hidden = false;
                    })
                    .finally(() => {
                        pick.disabled = false;
                    });
            });
            row.append(pick);
        }
        row.append(ok, cancel);
        ui.box.append(row);
        input.focus();
        ok.addEventListener('click', () => done(input.value.trim() || null));
        cancel.addEventListener('click', () => done(null));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') done(input.value.trim() || null);
            if (e.key === 'Escape') done(null);
        });
    });
}

/**
 * 页内目录浏览器：点文件夹进入、点文件（file 模式）选中；
 * dir 模式用「选此文件夹」定当前目录。取消回 null。
 */
export function folioBrowseFs(
    title: string,
    mode: 'file' | 'dir',
    list: (dir: string | null) => Promise<{ dir: string | null; parent: string | null; entries: { name: string; path: string; dir: boolean }[] }>,
): Promise<string | null> {
    return new Promise((resolve) => {
        const ui = shell(title);
        let settled = false;
        const done = (v: string | null) => {
            if (settled) return;
            settled = true;
            unbindScrollFade(listEl);
            window.removeEventListener('keydown', onKey);
            ui.close();
            resolve(v);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                done(null);
            }
        };
        const bar = document.createElement('div');
        bar.className = 'folio-browse-bar';
        const up = document.createElement('button');
        up.type = 'button';
        up.textContent = '↑ 上一级';
        const cur = document.createElement('span');
        cur.className = 'folio-browse-cur';
        bar.append(up, cur);
        ui.box.append(bar);
        const listEl = document.createElement('div');
        listEl.className = 'folio-modal-list folio-browse-list';
        ui.box.append(listEl);
        const hint = document.createElement('div');
        hint.className = 'folio-modal-hint';
        hint.hidden = true;
        ui.box.append(hint);
        const row = document.createElement('div');
        row.className = 'folio-modal-actions';
        const ok = document.createElement('button');
        const cancel = document.createElement('button');
        cancel.textContent = '取消';
        row.append(ok, cancel);
        ui.box.append(row);
        if (mode === 'dir') {
            ok.textContent = '选此文件夹';
        } else {
            ok.textContent = '确定';
            ok.disabled = true;
        }

        let curDir: string | null = null;
        let curParent: string | null = null;
        let gen = 0;
        async function load(dir: string | null): Promise<void> {
            const g = ++gen;
            hint.hidden = true;
            listEl.textContent = '';
            cur.textContent = '…';
            try {
                const out = await list(dir);
                if (g !== gen || settled) return;
                curDir = out.dir;
                curParent = out.parent;
                cur.textContent = out.dir ?? '';
                cur.title = out.dir ?? '';
                up.disabled = dir === null;
                if (mode === 'dir') ok.disabled = !out.dir;
                if (!out.entries.length) {
                    const empty = document.createElement('div');
                    empty.className = 'folio-browse-empty';
                    empty.textContent = '（空目录）';
                    listEl.append(empty);
                }
                for (const e of out.entries) {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.textContent = e.dir ? `${e.name}/` : e.name;
                    b.title = e.path;
                    if (!e.dir) b.className = 'file';
                    b.addEventListener('click', () => {
                        if (e.dir) void load(e.path);
                        else done(e.path);
                    });
                    listEl.append(b);
                }
            } catch (err) {
                if (g !== gen || settled) return;
                cur.textContent = dir ?? '';
                hint.textContent = err instanceof Error ? err.message : String(err);
                hint.hidden = false;
            }
        }
        up.addEventListener('click', () => {
            if (curDir === null) return;
            void load(curParent);
        });
        ok.addEventListener('click', () => {
            if (mode === 'dir' && curDir) done(curDir);
        });
        cancel.addEventListener('click', () => done(null));
        window.addEventListener('keydown', onKey);
        requestAnimationFrame(() => bindScrollFade(listEl));
        void load(null);
    });
}

export function folioConfirm(title: string, okText = '删除'): Promise<boolean> {
    return new Promise((resolve) => {
        const ui = shell(title, true);
        const row = document.createElement('div');
        row.className = 'folio-modal-actions';
        const ok = document.createElement('button');
        ok.className = 'danger';
        ok.textContent = okText;
        const cancel = document.createElement('button');
        cancel.textContent = '取消';
        row.append(ok, cancel);
        ui.box.append(row);
        const done = (v: boolean) => {
            ui.close();
            resolve(v);
        };
        ok.addEventListener('click', () => done(true));
        cancel.addEventListener('click', () => done(false));
        setTimeout(() => ok.focus());
    });
}

/** 列表选择弹窗（移动到/复制到选目标目录）。空串 = 库根；null = 取消。 */
export function folioPick(title: string, options: string[], current?: string): Promise<string | null> {
    return new Promise((resolve) => {
        const list = document.createElement('div');
        list.className = 'folio-modal-list';
        let settled = false;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                done(null);
            }
        };
        const done = (v: string | null) => {
            if (settled) return;
            settled = true;
            unbindScrollFade(list);
            window.removeEventListener('keydown', onKey);
            ui.close();
            resolve(v);
        };
        const ui = shell(title, false, () => done(null));
        for (const row of dirPickRows(options)) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = row.name;
            b.style.setProperty('--pick-depth', String(row.depth));
            if (current !== undefined && row.path === current) b.disabled = true;
            b.addEventListener('click', () => done(row.path));
            list.append(b);
        }
        ui.box.append(list);
        window.addEventListener('keydown', onKey);
        requestAnimationFrame(() => bindScrollFade(list));
    });
}
