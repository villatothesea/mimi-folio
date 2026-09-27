# THIRD-PARTY NOTICES — 第三方开源许可通告

米素 folio 使用/分发了以下开源组件，均为宽松协议（MIT / Apache-2.0 / ISC / BSD-3-Clause / MPL-2.0 可选 Apache-2.0），无 GPL/AGPL。本文件随源码与分发物一并提供，满足各协议的「副本附带版权与许可通告」要求。

## 仓内 vendored 代码

| 组件 | 出处 | 协议 | 说明 |
|---|---|---|---|
| Tabler Icons | https://tabler.io/icons | MIT | `src/ui/icons.ts` 内联其 outline SVG path 数据，保留出处注释与下方许可全文 |

Tabler Icons 版权：Copyright (c) 2018-2025 Tabler。

## 运行时依赖（经 `@muyajs/core` 编辑核引入，随 dist/分发物打包）

| 包 | 协议 |
|---|---|
| @muyajs/core（MarkText Muya） | MIT |
| @floating-ui/dom | MIT |
| @marktext/file-icons | MIT |
| dompurify | MPL-2.0 **或** Apache-2.0（取用 Apache-2.0） |
| execall | MIT |
| fast-diff | Apache-2.0 |
| flowchart.js | MIT |
| fuse.js | Apache-2.0 |
| github-markdown-css | MIT |
| html-tags | MIT |
| joplin-turndown-plugin-gfm | MIT |
| katex | MIT |
| marked | MIT |
| marked-highlight | MIT |
| mermaid | MIT |
| ot-json1 | ISC |
| ot-text-unicode | ISC |
| plantuml-encoder | MIT |
| prismjs | MIT |
| rxjs | Apache-2.0 |
| snabbdom | MIT |
| snabbdom-to-html | MIT |
| snapsvg-cjs | MIT |
| turndown | MIT |
| underscore | MIT |
| vega / vega-embed / vega-lite | BSD-3-Clause |
| webfontloader | Apache-2.0 |

Muya 版权（marktext 仓 LICENSE）：Copyright (c) 2017-present Luo Ran；Copyright (c) 2018-present MarkText Contributors。

Memos（https://github.com/usememos/memos，MIT）：仅参照其速记交互，未嵌入其代码。

## 桌面壳依赖（Cargo）

| 包 | 协议 |
|---|---|
| tauri / tauri-build | MIT **或** Apache-2.0 |
| serde / serde_json | MIT **或** Apache-2.0 |
| tauri-plugin-prevent-default | MIT（Copyright (c) 2024-2025 Andrew Ferreira） |

## 许可全文

### MIT License

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Apache License 2.0

适用于 fast-diff、fuse.js、rxjs、webfontloader、dompurify（择一）及 tauri/serde 系择一许可。全文见：
https://www.apache.org/licenses/LICENSE-2.0

要点：副本须附许可文本与版权通告；修改文件须标注；附 NOTICE 文件者须一并转附。

### ISC License

```
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

### BSD 3-Clause License

适用于 vega / vega-embed / vega-lite（Copyright (c) 2015-present, Vega Contributors）。

```
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES ARE DISCLAIMED. IN NO EVENT SHALL THE
COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DAMAGES ARISING IN ANY WAY
OUT OF THE USE OF THIS SOFTWARE.
```
