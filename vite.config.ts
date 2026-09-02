import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite';

import { handleFolioApi, serveAttachment } from './src/server/api.ts';

/** dev 时把 /folio/v1/* 与 /attachments/* 挂进 vite 同一端口；与独立整服共用实现。 */
function folioApi(): Plugin {
    return {
        name: 'folio-api',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                void handleFolioApi(req, res)
                    .then((handled) => (handled ? true : serveAttachment(req, res)))
                    .then((handled) => {
                        if (!handled) next();
                    });
            });
        },
    };
}

export default defineConfig({
    plugins: [folioApi()],
    server: {
        fs: {
            // @muyajs/core 以 link: 接本地检出，其字体/图标等资源在仓外，需放行
            allow: [searchForWorkspaceRoot(process.cwd()), fileURLToPath(new URL('../Assets/marktext-develop', import.meta.url))],
        },
    },
});
