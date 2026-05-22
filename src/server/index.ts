/**
 * Server barrel.
 *
 * The Node-RED loader resolves the plugin via `package.json#node-red.plugins`
 * which points at `dist/server/plugin.js` directly — Node-RED does not import
 * through this barrel. This file exists so:
 *   1. Tests import `PLUGIN_ID` from a stable path during early sections.
 *   2. Downstream tasks (S2 onward) re-export the Claude bridge, SSE server,
 *      and prompt protocol from one place.
 */
export { default as plugin, PLUGIN_ID, ADMIN_PREFIX, HEALTH_PAYLOAD } from './plugin.js';
