/**
 * h5-worker.js - H5 前端静态文件服务 Worker
 *
 * 与 WebSocket Worker (index.js) 完全隔离，独立部署。
 * 用于托管 uni-app H5 构建产物，让手机浏览器直接访问。
 *
 * 部署后需要将 utils/websocket.js 中的 WS_URL
 * 改为公网 WebSocket 地址（已有 wss://gomoku.legotrain.eu.org/ws）
 *
 * 部署方式：
 *   cd server
 *   wrangler deploy --config wrangler-h5.toml
 */

// 静态文件 MIME 类型映射
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    let path = url.pathname

    // 根路径 → index.html
    if (path === '/' || path === '') {
      path = '/index.html'
    }

    // 尝试从 KV 或静态资源中读取文件
    // 方式一：通过 wrangler.toml 的 [assets] 配置（wrangler v3+）
    // 方式二：通过 Workers KV 绑定
    // 这里使用 assets 方式，需要在 wrangler-h5.toml 中配置

    // 如果 wrangler 配置了 assets，静态文件会自动处理
    // 这个 fetch handler 只在 assets 未匹配时触发（如 SPA 回退）
    // 所以这里只做 SPA 回退：非文件请求返回 index.html

    // 检查是否是带有扩展名的静态文件请求
    const ext = path.substring(path.lastIndexOf('.'))
    if (MIME_TYPES[ext]) {
      // 有已知扩展名但 assets 没匹配到 → 404
      return new Response('Not Found', { status: 404 })
    }

    // SPA 回退：所有非文件路径返回 index.html
    // assets 配置会自动处理 index.html 的读取
    return new Response(null, { status: 308, headers: { 'Location': '/' } })
  }
}