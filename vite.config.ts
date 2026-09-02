import { defineConfig, type Plugin } from 'vite';

import { handleFolioApi } from './src/server/api.ts';

/** dev 时把 /folio/v1/* 挂进 vite 同一端口；实现与独立整服共用 src/server/api.ts。 */
function folioApi(): Plugin {
    return {
        name: 'folio-api',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                void handleFolioApi(req, res).then((handled) => {
                    if (!handled) next();
                });
            });
        },
    };
}

export default defineConfig({
    plugins: [folioApi()],
});
