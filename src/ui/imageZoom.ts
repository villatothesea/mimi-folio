/**
 * 文档图片灯箱（验收批）：点正文图片放大预览；滚轮以光标为锚缩放，
 * 再点一次（图或背板）或 Esc 关闭。纯查看层，不动正文/muya。
 */
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 20;
const ZOOM_STEP = 1.15;

export function attachImageZoom(wrap: HTMLElement): void {
    let veil: HTMLElement | null = null;
    let img: HTMLImageElement | null = null;
    let scale = 1;
    let tx = 0;
    let ty = 0;

    const apply = () => {
        img?.style.setProperty('transform', `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${scale})`);
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close();
    };
    const close = () => {
        veil?.remove();
        veil = null;
        img = null;
        document.removeEventListener('keydown', onKey);
    };

    const open = (pic: HTMLImageElement) => {
        close();
        veil = document.createElement('div');
        veil.className = 'folio-zoom';
        img = document.createElement('img');
        img.src = pic.currentSrc || pic.src;
        img.alt = pic.alt;
        img.draggable = false;
        veil.append(img);
        document.body.append(veil);

        const fit = () => {
            if (!img) return;
            const w = img.naturalWidth || innerWidth;
            const h = img.naturalHeight || innerHeight;
            // 贴合视口 90%，小图最多放大到 4 倍自然尺寸
            scale = Math.min((innerWidth * 0.9) / w, (innerHeight * 0.9) / h, 4);
            tx = 0;
            ty = 0;
            apply();
        };
        img.addEventListener('load', fit, { once: true });
        if (img.complete && img.naturalWidth) fit();

        veil.addEventListener('click', close);
        veil.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (!img) return;
            const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)));
            // 光标点不动：图中心在屏内偏移 (tx,ty)，光标下图点随倍率补偿
            const k = next / scale;
            const cx = e.clientX - innerWidth / 2;
            const cy = e.clientY - innerHeight / 2;
            tx = cx - (cx - tx) * k;
            ty = cy - (cy - ty) * k;
            scale = next;
            apply();
        }, { passive: false });
        document.addEventListener('keydown', onKey);
    };

    wrap.addEventListener('click', (e) => {
        const pic = (e.target as HTMLElement).closest?.('img');
        if (!pic?.closest('.mu-inline-image')) return;
        e.preventDefault();
        open(pic);
    });
}
