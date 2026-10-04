/**
 * 左右栏拖宽窄（验收批）：边线拖拽，宽度持久化。
 * 预览 iframe 会吞掉 document 的 mouseup，必须 pointer capture，否则粘鼠标。
 */
export function attachResizer(panel: HTMLElement, edge: 'left' | 'right', key: string, min: number, max: number): void {
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
