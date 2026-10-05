/**
 * 本机多媒体进盘（单元 4）：
 *   - 截图/位图粘贴 → muya 原生 imageAction（editorHost 里接 host.saveImage → attachments/）
 *   - 网页复制的网络图片（HTML <img src="https://…"> 或图片 URL）→ host.saveRemoteImage → pics/
 *   - 音视频文件粘贴/拖放 → host.saveFile 落盘，md 插 <video>/<audio> html-block
 *   - 图片文件拖放 → host.saveImage 后 pasteImage；其它文件插相对链接
 * 监听挂在编辑器外壳上用捕获阶段，拦下的不再进 muya 默认粘贴。
 */
import type { Muya } from '@muyajs/core';

import type { FolioHost } from '../host/types.ts';
import { isMarkdownFile, looksLikeMarkdownSource } from '../shared/markdownPaste.ts';
import { imageUrlsFromClipboard } from '../shared/netImage.ts';
import { insertMarkdown } from './editorHost.ts';

const AV_RE = /\.(mp4|webm|mp3|wav|ogg|m4a|flac)$/i;
const IMG_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

async function bytesOf(file: File): Promise<Uint8Array> {
    return new Uint8Array(await file.arrayBuffer());
}

function stampHint(name: string, fallbackExt: string): string {
    const base = name.replace(/\.[^.]*$/, '').trim() || 'attachment';
    // 原名自带扩展名就保留，只在没有扩展名时补默认值
    const ext = name.match(/\.[^.]*$/)?.[0] ?? fallbackExt;
    return `${base}${ext}`;
}

async function insertAvBlock(editor: Muya, src: string, file: File): Promise<void> {
    const html = /\.mp4|webm$/i.test(file.name)
        ? `<video src="${src}" controls></video>`
        : `<audio src="${src}" controls></audio>`;
    // insertParagraph 对 '<' 开头的文本会直接建成 html-block，无需再转换
    editor.insertParagraph('after', html);
}

export function attachMediaHandlers(
    container: HTMLElement,
    host: FolioHost,
    getEditor: () => Muya | null,
    onError?: (message: string) => void,
    onDocDrop?: (files: File[]) => void,
): void {
    if (!host.saveFile) throw new Error('当前 FolioHost 未实现 saveFile，无法落盘音视频附件');
    const putFile = host.saveFile.bind(host);
    async function handleFiles(files: FileList | File[], isPaste: boolean): Promise<void> {
        const editor = getEditor();
        if (!editor) return;
        for (const file of files) {
            const name = file.name || '粘贴.png';
            if (isMarkdownFile(file)) {
                insertMarkdown(editor, await file.text());
                continue;
            }
            if (isPaste && file.type.startsWith('image/')) continue; // 位图粘贴归 muya imageAction
            if (AV_RE.test(name)) {
                const { src } = await putFile(await bytesOf(file), stampHint(name, file.type.startsWith('video/') ? '.mp4' : '.mp3'));
                await insertAvBlock(editor, src, file);
            } else if (IMG_RE.test(name) || file.type.startsWith('image/')) {
                const { src } = await host.saveImage(await bytesOf(file), stampHint(name, '.png'));
                editor.pasteImage(src);
            } else {
                const { src } = await putFile(await bytesOf(file), name);
                editor.insertParagraph('after', `[${name}](${src})`);
            }
        }
    }

    container.addEventListener(
        'paste',
        (event) => {
            const dt = event.clipboardData;
            if (!dt) return;
            const editor = getEditor();
            const files = [...dt.files];
            const mdFiles = files.filter(isMarkdownFile);
            const text = dt.getData('text/plain');
            if (editor && mdFiles.length > 0) {
                event.preventDefault();
                event.stopImmediatePropagation();
                void Promise.all(mdFiles.map((f) => f.text())).then((parts) => insertMarkdown(editor, parts.join('\n\n')));
                return;
            }
            if (editor && looksLikeMarkdownSource(text)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                insertMarkdown(editor, text, event);
                return;
            }
            const net = host.saveRemoteImage ? imageUrlsFromClipboard(dt) : [];
            if (editor && net.length > 0) {
                const bitmaps = files.filter((f) => f.type.startsWith('image/'));
                event.preventDefault();
                event.stopImmediatePropagation();
                void (async () => {
                    try {
                        for (const url of net) {
                            const { src } = await host.saveRemoteImage!(url);
                            await editor.pasteImage(src);
                            return;
                        }
                    } catch (err) {
                        if (bitmaps[0]) {
                            try {
                                const file = bitmaps[0];
                                const { src } = await host.saveImage(await bytesOf(file), stampHint(file.name || '粘贴.png', '.png'));
                                await editor.pasteImage(src);
                                return;
                            } catch {
                                // 位图兜底也失败则落到下面报错
                            }
                        }
                        onError?.(`网络图片落盘失败：${(err as Error).message}`);
                    }
                })();
                return;
            }
            if (files.length === 0) return;
            const av = files.some((f) => AV_RE.test(f.name) || (!f.type.startsWith('image/') && f.type !== '' && !isMarkdownFile(f)));
            // 只拦 muya 不会处理的（音视频/其它文件）；位图继续走 muya
            if (!av) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            void handleFiles(files, true);
        },
        { capture: true },
    );

    container.addEventListener(
        'drop',
        (event) => {
            const files = event.dataTransfer?.files;
            if (!files || files.length === 0) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            // md/html 拖进来 = 打开它。WV2 的 File 不带真实路径（做不了外链），
            // 交给 onDocDrop 导入 vault 后打开；没挂回调时退回旧路（往当前文档插内容）
            const docs = [...files].filter((f) => isMarkdownFile(f) || /\.html?$/i.test(f.name));
            const rest = [...files].filter((f) => !docs.includes(f));
            if (docs.length > 0 && onDocDrop) {
                onDocDrop(docs);
                if (rest.length === 0) return;
            }
            void handleFiles(rest.length > 0 ? rest : files, false);
        },
        { capture: true },
    );

    // 拖拽悬停时别让浏览器直接打开文件
    container.addEventListener(
        'dragover',
        (event) => {
            if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
        },
        { capture: true },
    );
}
