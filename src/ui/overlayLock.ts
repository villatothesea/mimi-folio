/** 全屏弹窗打开时锁住底层 #app，避免 Muya 浮动控件穿透。 */
export function lockAppOverlay(): () => void {
    document.body.classList.add('folio-overlay-open');
    return () => document.body.classList.remove('folio-overlay-open');
}
