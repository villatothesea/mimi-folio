/**
 * 网页预览看法：.html 不当 markdown 进 Muya。
 * iframe src 用路径形式，好让页面里的相对 css/图解析到同目录。
 */

export const HTML_PREVIEW_SCRIPTS_KEY = 'folio-html-scripts';

export function isHtmlPath(path: string): boolean {
    return /\.html?$/i.test(path);
}

/** `/folio/v1/preview/links/页.html`，每段单独编码。 */
export function previewSrc(rel: string, base = ''): string {
    const segs = rel.replaceAll('\\', '/').split('/').filter(Boolean).map(encodeURIComponent);
    return `${base}/folio/v1/preview/${segs.join('/')}`;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** 未存过或非 `'0'` → 开。只认显式关掉。 */
export function htmlPreviewScriptsEnabled(store?: Store | null): boolean {
    try {
        const s = store ?? (typeof localStorage === 'undefined' ? null : localStorage);
        if (!s) return true;
        return s.getItem(HTML_PREVIEW_SCRIPTS_KEY) !== '0';
    } catch {
        return true;
    }
}

export function setHtmlPreviewScriptsEnabled(on: boolean, store?: Store | null): void {
    const s = store ?? localStorage;
    s.setItem(HTML_PREVIEW_SCRIPTS_KEY, on ? '1' : '0');
}

/**
 * 页内 #锚点在 Chromium 沙箱里必须 allow-same-origin 才会跳。
 * 预览 iframe 走另一主机名（见 previewFrameHref），同源不等于米素这一页。
 */
export function htmlPreviewSandbox(allowScripts: boolean): string {
    return allowScripts ? 'allow-scripts allow-same-origin' : 'allow-same-origin';
}

/**
 * 把预览 URL 赶到与父页不同的 loopback 主机上。
 * allow-same-origin 只让页自己跳 #锚点，摸不到 parent / 米素 fetch。
 * 合入米米时 Cookie 只挂在入口主机上，换位后须把 ?token= 带给首包以种 Cookie。
 */
export function folioEntryToken(search = ''): string | null {
    const raw = search || (typeof window !== 'undefined' ? window.location.search : '');
    const token = new URLSearchParams(raw).get('token')?.trim();
    return token || null;
}

export function previewFrameHref(
    previewUrl: string,
    parentOrigin: string,
    opts?: { token?: string | null },
): string {
    const abs = new URL(previewUrl, parentOrigin);
    const parent = new URL(parentOrigin);
    let swapped = false;
    if (abs.origin === parent.origin) {
        const host = parent.hostname;
        if (host === '127.0.0.1') {
            abs.hostname = 'localhost';
            swapped = true;
        } else if (host === 'localhost') {
            abs.hostname = '127.0.0.1';
            swapped = true;
        } else if (host === '::1' || host === '[::1]') {
            abs.hostname = '127.0.0.1';
            swapped = true;
        }
    }
    const token = opts?.token?.trim();
    if (token && (swapped || abs.origin !== parent.origin)) {
        abs.searchParams.set('token', token);
    }
    return abs.href;
}

/** 预览响应里插的点击/hash 跳转。只改送给 iframe 的字节，不写回文件。 */
const PREVIEW_NAV_SCRIPT = `<script data-folio-preview-nav>
(function(){
  function jump(id){
    if(!id)return;
    try{id=decodeURIComponent(id)}catch(e){}
    var el=document.getElementById(id)||document.getElementsByName(id)[0];
    if(!el)return;
    var y=el.getBoundingClientRect().top+window.pageYOffset;
    var root=document.documentElement;
    var prev=root.style.scrollBehavior;
    root.style.scrollBehavior='auto';
    window.scrollTo(0,y);
    root.style.scrollBehavior=prev;
  }
  document.addEventListener('click',function(e){
    var t=e.target;
    if(t&&t.nodeType!==1)t=t.parentElement;
    if(!t||!t.closest)return;
    var a=t.closest('a[href]');
    if(!a)return;
    var raw=a.getAttribute('href');
    if(!raw)return;
    var id='';
    if(raw.charAt(0)==='#')id=raw.slice(1);
    else{
      try{
        var u=new URL(a.href);
        if(u.hash&&u.pathname===location.pathname)id=u.hash.slice(1);
      }catch(err){return;}
    }
    if(!id)return;
    var el=document.getElementById(decodeURIComponent(id))||document.getElementsByName(decodeURIComponent(id))[0];
    if(!el)return;
    e.preventDefault();
    setTimeout(function(){jump(id);},0);
  },true);
  if(location.hash)setTimeout(function(){jump(location.hash.slice(1));},0);
})();
</script>`;

/** 预览用副本：页内 #锚点改成立即 scrollTo。不写回文件。 */
export function withPreviewNav(html: string): string {
    if (html.includes('data-folio-preview-nav')) return html;
    if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${PREVIEW_NAV_SCRIPT}</body>`);
    return `${html}${PREVIEW_NAV_SCRIPT}`;
}
