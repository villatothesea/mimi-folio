/**
 * 文档图片灯箱（验收批）：点正文图片放大预览；滚轮以光标为锚缩放，
 * 再点一次（图或背板）或 Esc 关闭。纯查看层，不动正文/muya。
 * 监听走捕获阶段：muya 在 domNode 冒泡上 stopPropagation 选图，
 * 挂 wrap 的冒泡监听根本收不到，必须捕获期先截。
 */
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 20;
const ZOOM_STEP = 1.15;

let veil: HTMLElement | null = null;
let img: HTMLImageElement | null = null;
let scale = 1;
let tx = 0;
let ty = 0;

const apply = () => {
    img?.style.setProperty('transform', `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${scale})`);
};
const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeZoom();
};

export function closeZoom(): void {
    veil?.remove();
    veil = null;
    img = null;
    document.removeEventListener('keydown', onKey);
}

export function openImageZoom(pic: HTMLImageElement): void {
    closeZoom();
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

    veil.addEventListener('click', closeZoom);
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
}

/** 右键「复制图片」：拉原图统一转 PNG 写剪贴板，别处粘贴走位图通道落 attachments/。 */
export async function copyImageToClipboard(pic: HTMLImageElement): Promise<void> {
    const src = pic.currentSrc || pic.src;
    const res = await fetch(src);
    if (!res.ok) throw new Error(`取图失败 HTTP ${res.status}`);
    let blob = await res.blob();
    if (blob.type !== 'image/png') {
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        canvas.getContext('2d')!.drawImage(bmp, 0, 0);
        blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('转 PNG 失败'))), 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export function attachImageZoom(wrap: HTMLElement): void {
    wrap.addEventListener('click', (e) => {
        const pic = (e.target as HTMLElement).closest?.('img');
        if (!pic?.closest('.mu-inline-image')) return;
        e.preventDefault();
        openImageZoom(pic as HTMLImageElement);
    }, true);
}
