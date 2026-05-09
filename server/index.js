/**
 * Cloudflare Worker 入口 - index.js
 *
 * 使用 Durable Objects 做房间状态管理。
 * 所有 WebSocket 连接都路由到同一个 GomokuMatchRoom DO 实例，
 * 确保同一房间的玩家在同一个实例上通信。
 *
 * Durable Objects 免费版：
 * - 每天 100 万次请求
 * - 一个 DO 实例足够处理所有房间
 *
 * wrangler.toml 中需要配置：
 *   [[durable_objects.bindings]]
 *   name = "MATCH_ROOM"
 *   class_name = "GomokuMatchRoom"
 *
 *   [[migrations]]
 *   tag = "v1"
 *   new_classes = ["GomokuMatchRoom"]
 */

import { GomokuMatchRoom } from './room-manager'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400'
        }
      })
    }

    // WebSocket — 路由到 Durable Object
    if (url.pathname === '/ws') {
      // 获取 DO 实例（使用单一 ID，所有连接进同一个实例）
      const doId = env.MATCH_ROOM.idFromName('global-match-room')
      const stub = env.MATCH_ROOM.get(doId)
      return stub.fetch(request)
    }

    // 健康检查
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', version: '1.2.0' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      })
    }

    return new Response('五子棋信令服务器 v1.2', { status: 200 })
  }
}

// 导出 Durable Object 类（wrangler.toml 需要）
export { GomokuMatchRoom }