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
