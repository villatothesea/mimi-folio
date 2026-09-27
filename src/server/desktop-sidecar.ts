/** Tauri sidecar（pkg 单文件）入口：无 import.meta 自启动逻辑。 */
import { startStandaloneServer } from './run.ts';
import { bootStamp } from './bootlog.ts';

bootStamp('sidecar entry');
startStandaloneServer();
