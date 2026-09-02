/**
 * 合入口。独立用 StandaloneHost，进米米换 MimiHost。
 * 方法名合入后不许改；加字段只能 optional。
 * 扩 list 筛选 / saveFile 等到对应施工单元再改，不要把计划提前写进这份文件。
 */

export type FolioPath = string;

export type FolioDoc = {
    path: FolioPath;
    markdown: string;
};

export type FolioListItem = {
    path: FolioPath;
    title: string;
    /** frontmatter tags:（单元 6），无 frontmatter 时为空 */
    tags?: string[];
    /** notes/ 长文、memos/ 速记；其它目录不给 kind */
    kind?: 'note' | 'memo';
};

/** list 的筛选（单元 6）。合入后 daemon 按同样语义扫资产层。 */
export type FolioListOpts = {
    dir?: string;
    tag?: string;
    kind?: 'note' | 'memo';
};

export type FolioImage = {
    /** 写入 markdown 的相对路径，如 attachments/x.png */
    src: string;
};

/** saveFile 与 saveImage 同形：都回 attachments/ 下的相对路径 */
export type FolioAttachment = FolioImage;

export type FolioIndex = {
    outgoing: FolioPath[];
    backlinks: FolioPath[];
};

export interface FolioHost {
    read(path: FolioPath): Promise<FolioDoc>;
    write(path: FolioPath, markdown: string): Promise<void>;
    list(opts?: FolioListOpts): Promise<FolioListItem[]>;
    saveImage(bytes: Uint8Array, hint: string): Promise<FolioImage>;
    /** 音视频等附件落盘（单元 4）；合入后由 daemon 提供同名能力 */
    saveFile?(bytes: Uint8Array, hint: string): Promise<FolioAttachment>;
    index?(path: FolioPath): Promise<FolioIndex>;
}

export function detectHostKind(): 'mimi' | 'standalone' {
    if (typeof window !== 'undefined') {
        const w = window as Window & { __MIMI_FOLIO__?: boolean };
        if (w.__MIMI_FOLIO__) return 'mimi';
        if (new URLSearchParams(window.location.search).get('host') === 'mimi') {
            return 'mimi';
        }
    }
    return 'standalone';
}
