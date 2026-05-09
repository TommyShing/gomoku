/**
 * WebSocket 连接管理
 *
 * 职责：
 * 1. 建立/维护与 Cloudflare Worker 的 WebSocket 长连接
 * 2. 心跳保活（防止免费 Worker 空闲断开）
 * 3. 自动重连（指数退避）
 * 4. 消息序列化/反序列化
 * 5. 消息队列（断线时积压，重连后发送）
 *
 * uni-app 的 WebSocket API 是跨平台统一的（uni.connectSocket），
 * 不需要用 #ifdef 做平台区分。
 */

import { WS_MSG, PING_INTERVAL } from './constants'

// Worker 地址 - 部署 Cloudflare Worker 后替换为实际地址
// 格式: wss://你的子域名.workers.dev/ws
const WS_URL = 'wss://gomoku.legotrain.eu.org/ws'

export class WsManager {
  constructor() {
    this.socketTask = null
    this.listeners = {}
    this.pingTimer = null
    this.reconnectTimer = null
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.isConnected = false
    this.playerId = null
    this.roomId = null
    this.pendingMessages = []
    // resolve/reject 供 connect() 返回的 Promise 使用
    this._connectResolve = null
    this._connectReject = null
  }

  /**
   * 连接到 WebSocket 服务器
   *
   * uni.connectSocket 的工作方式：
   * 1. success/fail 只表示"连接请求是否发出"
   * 2. 真正连接成功/失败通过 onOpen/onError 回调通知
   *
   * @param {string} url - WebSocket 地址
   * @returns {Promise<void>}
   */
  connect(url = WS_URL) {
    return new Promise((resolve, reject) => {
      this._connectResolve = resolve
      this._connectReject = reject

      // 清理旧连接，防止 exceed max task count
      this.stopPing()
      this.cancelReconnect()
      if (this.socketTask) {
        try { this.socketTask.close() } catch (e) {}
        this.socketTask = null
      }

      // 建立新连接
      this.socketTask = uni.connectSocket({
        url: url,
        success: () => {
          console.log('[WS] 连接请求已发送')
        },
        fail: (err) => {
          console.error('[WS] 连接请求发送失败:', err)
          if (this._connectReject) {
            this._connectReject(err)
            this._connectResolve = null
            this._connectReject = null
          }
        }
      })

      // 连接成功回调
      this.socketTask.onOpen(() => {
        console.log('[WS] 连接已建立')
        this.isConnected = true
        this.reconnectAttempts = 0
        this.startPing()
        this.flushPendingMessages()
        if (this._connectResolve) {
          this._connectResolve()
          this._connectResolve = null
          this._connectReject = null
        }
      })

      // 收到消息回调
      this.socketTask.onMessage((res) => {
        this.handleMessage(res.data)
      })

      // 错误回调
      this.socketTask.onError((err) => {
        console.error('[WS] 连接错误:', err)
        this.emit('error', err)
        if (this._connectReject) {
          this._connectReject(err)
          this._connectResolve = null
          this._connectReject = null
        }
      })

      // 关闭回调
      this.socketTask.onClose((res) => {
        console.log('[WS] 连接关闭: code=' + res.code + ' reason=' + (res.reason || ''))
        this.isConnected = false
        this.stopPing()
        this.emit('disconnect', { code: res.code, reason: res.reason })
        // 自动重连
        this.attemptReconnect(url)
      })
    })
  }

  /**
   * 断开 WebSocket 连接
   */
  disconnect() {
    this.stopPing()
    this.cancelReconnect()
    if (this.socketTask) {
      this.socketTask.close()
      this.socketTask = null
    }
    this.isConnected = false
    this.playerId = null
    this.roomId = null
    this._connectResolve = null
    this._connectReject = null
  }

  /**
   * 发送消息到服务器
   *
   * @param {string} type - 消息类型（见 constants.js 的 WS_MSG）
   * @param {Object} data - 附加数据
   */
  send(type, data = {}) {
    const message = JSON.stringify({
      type,
      ...data,
      playerId: this.playerId,
      roomId: this.roomId
    })

    // 未连接时加入队列，连接后自动发送
    if (!this.isConnected) {
      console.log('[WS] 未连接，消息加入队列:', type)
      this.pendingMessages.push(message)
      return
    }

    this._doSend(message)
  }

  /**
   * 实际发送（内部方法）
   */
  _doSend(message) {
    try {
      this.socketTask.send({
        data: message,
        fail: (err) => {
          console.error('[WS] 发送失败:', err)
          this.pendingMessages.push(message)
        }
      })
    } catch (err) {
      console.error('[WS] 发送异常:', err)
      this.pendingMessages.push(message)
    }
  }

  /**
   * 发送积压的未发送消息
   */
  flushPendingMessages() {
    if (this.pendingMessages.length === 0) return
    console.log('[WS] 发送 ' + this.pendingMessages.length + ' 条积压消息')
    const messages = this.pendingMessages.slice()
    this.pendingMessages = []
    for (const msg of messages) {
      this._doSend(msg)
    }
  }

  /**
   * 注册事件监听
   *
   * @param {string} event - 事件名
   * @param {Function} callback - 回调
   * @returns {Function} 取消监听的函数
   */
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event].push(callback)
    return () => {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback)
    }
  }

  /**
   * 移除事件监听
   */
  off(event, callback) {
    if (!this.listeners[event]) return
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback)
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    if (!this.listeners[event]) return
    for (const callback of this.listeners[event]) {
      try {
        callback(data)
      } catch (err) {
        console.error('[WS] 事件处理错误 (' + event + '):', err)
      }
    }
  }

  /**
   * 处理收到的消息
   *
   * 根据消息类型分发到不同的事件
   */
  handleMessage(rawData) {
    try {
      const msg = JSON.parse(rawData)
      console.log('[WS] 收到消息:', msg.type)

      switch (msg.type) {
        case WS_MSG.S_PONG:
          // 心跳回复，不需要处理
          break

        case WS_MSG.S_MATCHED:
          this.playerId = msg.playerId
          this.roomId = msg.roomId
          this.emit('matched', msg)
          break

        case WS_MSG.S_ROOM_CREATED:
          this.playerId = msg.playerId
          this.roomId = msg.roomId
          this.emit('roomCreated', msg)
          break

        case WS_MSG.S_JOINED:
          this.playerId = msg.playerId
          this.roomId = msg.roomId
          this.emit('joined', msg)
          break

        case WS_MSG.S_GAME_START:
          this.emit('gameStart', msg)
          break

        case WS_MSG.S_MOVE:
          this.emit('opponentMove', msg)
          break

        case WS_MSG.S_PRE_LOCK:
          this.emit('opponentPreLock', msg)
          break

        case WS_MSG.S_GAME_OVER:
          this.emit('gameOver', msg)
          break

        case WS_MSG.S_ERROR:
          console.error('[WS] 服务器错误:', msg.message)
          this.emit('error', msg)
          break

        case WS_MSG.S_OPPONENT_DISCONNECT:
          this.emit('opponentDisconnect', msg)
          break

        case WS_MSG.S_OPPONENT_RECONNECT:
          this.emit('opponentReconnect', msg)
          break

        case WS_MSG.S_ROOM_DESTROYED:
          this.emit('roomDestroyed', msg)
          break

        case WS_MSG.S_PLAYER_LEFT:
          this.emit('playerLeft', msg)
          break

        case WS_MSG.S_REMATCH:
          this.emit('rematch', msg)
          break

        case WS_MSG.S_REMATCH_READY:
          this.emit('rematchReady', msg)
          break

        default:
          console.warn('[WS] 未知消息类型:', msg.type)
      }
    } catch (err) {
      console.error('[WS] 消息解析失败:', err, rawData)
    }
  }

  /**
   * 开始心跳保活
   *
   * Cloudflare Workers 免费版约 5 分钟无活动会断开 WebSocket。
   * 每 10 秒发送 ping，保持连接活跃。
   */
  startPing() {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      this.send(WS_MSG.C_PING)
    }, PING_INTERVAL)
  }

  /**
   * 停止心跳
   */
  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  /**
   * 取消重连定时器
   */
  cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /**
   * 尝试重连（指数退避）
   *
   * 重连间隔: 1s → 2s → 4s → 8s → 10s (上限)
   */
  attemptReconnect(url) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[WS] 重连次数已达上限')
      this.emit('reconnectFailed', null)
      return
    }

    this.reconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000)
    console.log('[WS] ' + delay + 'ms 后第 ' + this.reconnectAttempts + ' 次重连')

    this.reconnectTimer = setTimeout(() => {
      console.log('[WS] 正在重连...')
      this.connect(url).catch(() => {
        // 连接失败由 onClose 触发再次重连
      })
    }, delay)
  }

  /**
   * 获取连接状态
   */
  getConnected() {
    return this.isConnected
  }

  /**
   * 获取玩家ID
   */
  getPlayerId() {
    return this.playerId
  }

  /**
   * 获取房间ID
   */
  getRoomId() {
    return this.roomId
  }
}