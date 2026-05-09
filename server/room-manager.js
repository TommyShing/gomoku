/**
 * 房间和匹配管理器 - room-manager.js
 *
 * 架构：Durable Objects
 *
 * Durable Objects 确保同一个房间的所有 WebSocket 连接
 * 都路由到同一个 DO 实例，WebSocket 对象可以直接在内存中共享。
 *
 * 模块划分：
 * - GomokuMatchRoom (Durable Object)：房间 + 匹配队列
 *   每个 DO 实例处理一个房间 + 全局匹配队列
 *
 * 为什么不用 KV？
 * KV 的 WebSocket 不能跨实例共享，DO 天然解决这个问题。
 */

const MSG = {
  C_MATCH: 'c_match',
  C_CANCEL_MATCH: 'c_cancel_match',
  C_CREATE_ROOM: 'c_create_room',
  C_JOIN_ROOM: 'c_join_room',
  C_LEAVE_ROOM: 'c_leave_room',
  C_MOVE: 'c_move',
  C_RESIGN: 'c_resign',
  C_PING: 'c_ping',
  C_PRE_LOCK: 'c_pre_lock',
  C_REMATCH: 'c_rematch',
  C_REMATCH_READY: 'c_rematch_ready',

  S_MATCHED: 's_matched',
  S_ROOM_CREATED: 's_room_created',
  S_JOINED: 's_joined',
  S_GAME_START: 's_game_start',
  S_MOVE: 's_move',
  S_PRE_LOCK: 's_pre_lock',
  S_GAME_OVER: 's_game_over',
  S_ERROR: 's_error',
  S_PONG: 's_pong',
  S_OPPONENT_DISCONNECT: 's_opponent_disconnect',
  S_OPPONENT_RECONNECT: 's_opponent_reconnect',
  S_ROOM_DESTROYED: 's_room_destroyed',
  S_PLAYER_LEFT: 's_player_left',
  S_REMATCH: 's_rematch',
  S_REMATCH_READY: 's_rematch_ready'
}

// ===================== Durable Object =====================

/**
 * GomokuMatchRoom — 五子棋匹配/房间 DO
 *
 * 每个 DO 实例负责：
 * - 全局匹配队列（所有房间共享一个 DO）
 * - 每个房间的状态管理
 *
 * 注意：这里用一个 DO 实例处理所有房间。
 * 如果流量很大，可以改成每个房间一个 DO，
 * 但当前场景一个 DO 完全够用。
 */
export class GomokuMatchRoom {
  constructor(state, env) {
    this.state = state
    // 持久化存储（DO 自带）
    this.storage = state.storage

    // 内存状态
    this.rooms = new Map()        // roomCode → Room
    this.waitingQueue = []         // 匹配队列 [playerId]
    this.connections = new Map()   // playerId → WebSocket
    this.playerInfo = new Map()    // playerId → { name, roomCode }
    this.idCounter = 0
  }

  /**
   * 处理 WebSocket 连接
   * DO 的 fetch handler 用于 WebSocket 升级
   */
  async fetch(request) {
    const pair = new WebSocketPair()
    const [server, client] = Object.values(pair)
    server.accept()

    const playerId = this.generateId('P')
    const playerName = '玩家' + playerId.slice(-4)

    this.connections.set(playerId, server)
    this.playerInfo.set(playerId, { name: playerName, roomCode: null })

    console.log('[连接] ' + playerName + '(' + playerId + ') 总连接: ' + this.connections.size)

    // 消息处理
    server.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data)
        this.handleMessage(playerId, data, server)
      } catch (err) {
        console.error('[消息解析]', err)
        this.sendTo(server, MSG.S_ERROR, { message: '消息格式错误' })
      }
    })

    // 断开处理
    server.addEventListener('close', () => {
      console.log('[断开] ' + playerName + '(' + playerId + ')')
      this.handleDisconnect(playerId)
    })

    server.addEventListener('error', () => {
      this.handleDisconnect(playerId)
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  // ===================== 消息分发 =====================

  handleMessage(playerId, data, ws) {
    const info = this.playerInfo.get(playerId)
    if (!info) return

    switch (data.type) {
      case MSG.C_PING:
        this.sendTo(ws, MSG.S_PONG, {})
        break
      case MSG.C_MATCH:
        this.handleMatch(playerId)
        break
      case MSG.C_CANCEL_MATCH:
        this.handleCancelMatch(playerId)
        break
      case MSG.C_CREATE_ROOM:
        this.handleCreateRoom(playerId)
        break
      case MSG.C_JOIN_ROOM:
        this.handleJoinRoom(playerId, data.targetRoomId)
        break
      case MSG.C_LEAVE_ROOM:
        this.handleLeaveRoom(playerId)
        break
      case MSG.C_MOVE:
        this.handleMove(playerId, data)
        break
      case MSG.C_RESIGN:
        this.handleResign(playerId)
        break
      case MSG.C_PRE_LOCK:
        this.handlePreLock(playerId, data)
        break
      case MSG.C_REMATCH:
      case MSG.C_REMATCH_READY:
        this.handleRematch(playerId)
        break
      default:
        this.sendTo(ws, MSG.S_ERROR, { message: '未知消息类型' })
    }
  }

  // ===================== 匹配 =====================

  handleMatch(playerId) {
    const info = this.playerInfo.get(playerId)
    if (!info) return
    const ws = this.connections.get(playerId)
    if (!ws) return

    if (info.roomCode) {
      this.sendTo(ws, MSG.S_ERROR, { message: '你已经在房间中' })
      return
    }

    if (this.waitingQueue.includes(playerId)) {
      this.sendTo(ws, MSG.S_ERROR, { message: '已在匹配队列中' })
      return
    }

    if (this.waitingQueue.length > 0) {
      const opponentId = this.waitingQueue.shift()
      const opponentWs = this.connections.get(opponentId)
      const opponentInfo = this.playerInfo.get(opponentId)

      if (!opponentWs || !opponentInfo) {
        this.waitingQueue.push(playerId)
        return
      }

      const roomCode = this.generateRoomCode()
      const room = {
        roomCode,
        players: [
          { id: opponentId, name: opponentInfo.name, color: 'black' },
          { id: playerId, name: info.name, color: 'white' }
        ],
        createdAt: Date.now(),
        gameStarted: true,
        gameOver: false,
        moveCount: 0,
        state: { moveHistory: [], isOver: false, winner: null, reason: null }
      }
      this.rooms.set(roomCode, room)
      info.roomCode = roomCode
      opponentInfo.roomCode = roomCode

      console.log('[配对] 房间 ' + roomCode + ': ' + opponentInfo.name + ' vs ' + info.name)

      this.sendTo(opponentWs, MSG.S_MATCHED, { playerId: opponentId, roomId: roomCode, color: 'black', opponentName: info.name, roomCode })
      this.sendTo(ws, MSG.S_MATCHED, { playerId, roomId: roomCode, color: 'white', opponentName: opponentInfo.name, roomCode })

      const gs = { roomId: roomCode, blackPlayer: opponentInfo.name, whitePlayer: info.name, currentTurn: 'black' }
      this.sendTo(opponentWs, MSG.S_GAME_START, { ...gs, yourColor: 'black' })
      this.sendTo(ws, MSG.S_GAME_START, { ...gs, yourColor: 'white' })
    } else {
      this.waitingQueue.push(playerId)
      console.log('[等待匹配] ' + info.name + '(' + playerId + ')')
    }
  }

  handleCancelMatch(playerId) {
    const idx = this.waitingQueue.indexOf(playerId)
    if (idx !== -1) this.waitingQueue.splice(idx, 1)
  }

  // ===================== 房间 =====================

  handleCreateRoom(playerId) {
    const info = this.playerInfo.get(playerId)
    if (!info) return
    const ws = this.connections.get(playerId)
    if (!ws) return

    if (info.roomCode) {
      this.sendTo(ws, MSG.S_ERROR, { message: '你已经在房间中' })
      return
    }

    const roomCode = this.generateRoomCode()
    const room = {
      roomCode,
      players: [{ id: playerId, name: info.name, color: 'black' }],
      createdAt: Date.now(),
      gameStarted: false,
      gameOver: false,
      moveCount: 0,
      state: { moveHistory: [], isOver: false, winner: null, reason: null }
    }
    this.rooms.set(roomCode, room)
    info.roomCode = roomCode

    console.log('[创建房间] ' + info.name + '(' + playerId + ') ' + roomCode)
    this.sendTo(ws, MSG.S_ROOM_CREATED, { playerId, roomId: roomCode, roomCode })
  }

  handleJoinRoom(playerId, targetRoomCode) {
    const info = this.playerInfo.get(playerId)
    if (!info) return
    const ws = this.connections.get(playerId)
    if (!ws) return

    if (info.roomCode) {
      this.sendTo(ws, MSG.S_ERROR, { message: '你已经在房间中' })
      return
    }

    const room = this.rooms.get(targetRoomCode)
    if (!room) {
      this.sendTo(ws, MSG.S_ERROR, { message: '房间不存在或已销毁' })
      return
    }

    if (room.players[0] && room.players[0].id === playerId) {
      this.sendTo(ws, MSG.S_ERROR, { message: '不能加入自己的房间' })
      return
    }

    if (room.gameStarted) {
      this.sendTo(ws, MSG.S_ERROR, { message: '游戏已经开始' })
      return
    }

    if (room.players.length >= 2) {
      this.sendTo(ws, MSG.S_ERROR, { message: '房间已满' })
      return
    }

    room.players.push({ id: playerId, name: info.name, color: 'white' })
    room.gameStarted = true
    info.roomCode = targetRoomCode

    const host = room.players[0]
    const hostWs = this.connections.get(host.id)

    console.log('[加入房间] ' + info.name + '(' + playerId + ') 加入 ' + targetRoomCode)

    this.sendTo(ws, MSG.S_JOINED, { playerId, roomId: targetRoomCode, roomCode: targetRoomCode, opponentName: host.name })
    if (hostWs) {
      this.sendTo(hostWs, MSG.S_JOINED, { playerId: host.id, roomId: targetRoomCode, roomCode: targetRoomCode, opponentName: info.name })
    }

    // 发给双方时分别带上各自颜色，客户端不再需要自己推断
    this.sendTo(ws, MSG.S_GAME_START, { roomId: targetRoomCode, blackPlayer: host.name, whitePlayer: info.name, currentTurn: 'black', yourColor: 'white' })
    if (hostWs) {
      this.sendTo(hostWs, MSG.S_GAME_START, { roomId: targetRoomCode, blackPlayer: host.name, whitePlayer: info.name, currentTurn: 'black', yourColor: 'black' })
    }
  }

  handleLeaveRoom(playerId) {
    const info = this.playerInfo.get(playerId)
    if (!info || !info.roomCode) return

    const roomCode = info.roomCode
    const room = this.rooms.get(roomCode)

    console.log('[离开房间] ' + info.name + '(' + playerId + ') 离开 ' + roomCode)
    info.roomCode = null

    if (room) {
      const others = room.players.filter(p => p.id !== playerId)
      for (const other of others) {
        const otherWs = this.connections.get(other.id)
        if (otherWs) {
          this.sendTo(otherWs, MSG.S_PLAYER_LEFT, { roomId: roomCode, message: '对方已离开房间' })
        }
        const otherInfo = this.playerInfo.get(other.id)
        if (otherInfo) otherInfo.roomCode = null
      }
      this.rooms.delete(roomCode)
    }
  }

  // ===================== 游戏 =====================

  handleMove(playerId, data) {
    const info = this.playerInfo.get(playerId)
    if (!info || !info.roomCode) return

    const room = this.rooms.get(info.roomCode)
    if (!room || room.state.isOver) return

    if (data.timeout) {
      const opponent = room.players.find(p => p.id !== playerId)
      if (opponent) {
        room.state.isOver = true
        room.gameOver = true
        room.state.winner = opponent.color
        room.state.reason = 'timeout'
        this.broadcastGameOver(room, opponent.color, 'timeout')
      }
      return
    }

    room.moveCount++
    room.state.moveHistory.push({ row: data.row, col: data.col, color: data.color })

    if (data.win) {
      room.state.isOver = true
      room.gameOver = true
      room.state.winner = data.color === 1 ? 'black' : 'white'
      room.state.reason = 'five'
      // 先发送最后一步落子给对手，再广播游戏结束，确保对手棋盘已更新
      const opponent = room.players.find(p => p.id !== playerId)
      if (opponent) {
        const oppWs = this.connections.get(opponent.id)
        if (oppWs) {
          this.sendTo(oppWs, MSG.S_MOVE, { row: data.row, col: data.col, color: data.color, moveCount: room.moveCount })
        }
      }
      this.broadcastGameOver(room, room.state.winner, 'five')
      return
    }

    if (data.draw) {
      room.state.isOver = true
      room.gameOver = true
      room.state.winner = 'draw'
      room.state.reason = 'board_full'
      // 先发送最后一步落子给对手，再广播游戏结束
      const opponent = room.players.find(p => p.id !== playerId)
      if (opponent) {
        const oppWs = this.connections.get(opponent.id)
        if (oppWs) {
          this.sendTo(oppWs, MSG.S_MOVE, { row: data.row, col: data.col, color: data.color, moveCount: room.moveCount })
        }
      }
      this.broadcastGameOver(room, 'draw', 'board_full')
      return
    }

    const opponent = room.players.find(p => p.id !== playerId)
    if (opponent) {
      const oppWs = this.connections.get(opponent.id)
      if (oppWs) {
        this.sendTo(oppWs, MSG.S_MOVE, { row: data.row, col: data.col, color: data.color, moveCount: room.moveCount })
      }
    }
  }

  broadcastGameOver(room, winner, reason) {
    const msg = { winner, reason, roomId: room.roomCode }
    for (const p of room.players) {
      const pWs = this.connections.get(p.id)
      if (pWs) {
        this.sendTo(pWs, MSG.S_GAME_OVER, { ...msg, playerId: p.id })
      }
    }
    console.log('[游戏结束] 房间 ' + room.roomCode + ' 胜者: ' + winner)
  }

  handleResign(playerId) {
    const info = this.playerInfo.get(playerId)
    if (!info || !info.roomCode) return

    const room = this.rooms.get(info.roomCode)
    if (!room || room.state.isOver) return

    const opponent = room.players.find(p => p.id !== playerId)
    if (opponent) {
      room.state.isOver = true
      room.gameOver = true
      room.state.winner = opponent.color
      room.state.reason = 'resign'
      this.broadcastGameOver(room, opponent.color, 'resign')
    }
  }

  /**
   * 预落子同步
   * 将玩家的预落子位置转发给对手
   */
  handlePreLock(playerId, data) {
    const info = this.playerInfo.get(playerId)
    if (!info || !info.roomCode) return

    const room = this.rooms.get(info.roomCode)
    if (!room) return

    const opponent = room.players.find(p => p.id !== playerId)
    if (opponent) {
      const oppWs = this.connections.get(opponent.id)
      if (oppWs) {
        this.sendTo(oppWs, MSG.S_PRE_LOCK, {
          row: data.row,
          col: data.col,
          color: data.color
        })
      }
    }
  }

  /**
   * 再来一局（准备制）
   * 双方都点击"准备"后才重新开始游戏
   */
  handleRematch(playerId) {
    const info = this.playerInfo.get(playerId)
    if (!info || !info.roomCode) return

    const room = this.rooms.get(info.roomCode)
    if (!room) return
    if (!room.gameOver) return

    // 初始化准备状态
    if (!room.rematchReady) {
      room.rematchReady = new Set()
    }

    room.rematchReady.add(playerId)

    // 通知对手"对方已准备"
    for (const p of room.players) {
      if (p.id !== playerId) {
        const pWs = this.connections.get(p.id)
        if (pWs) {
          this.sendTo(pWs, MSG.S_REMATCH_READY, {})
        }
      }
    }

    // 双方都准备好了 → 开始新游戏
    if (room.rematchReady.size >= 2) {
      room.gameOver = false
      room.moveCount = 0
      room.state = { moveHistory: [], isOver: false, winner: null, reason: null }
      room.rematchReady = new Set()

      const gs = {
        roomId: room.roomCode,
        blackPlayer: room.players[0].name,
        whitePlayer: room.players[1].name,
        currentTurn: 'black'
      }
      for (const p of room.players) {
        const pWs = this.connections.get(p.id)
        if (pWs) {
          this.sendTo(pWs, MSG.S_REMATCH, { ...gs, yourColor: p.color })
        }
      }
    }
  }

  // ===================== 断线 =====================

  handleDisconnect(playerId) {
    const qIdx = this.waitingQueue.indexOf(playerId)
    if (qIdx !== -1) this.waitingQueue.splice(qIdx, 1)

    const info = this.playerInfo.get(playerId)
    if (info && info.roomCode) {
      const room = this.rooms.get(info.roomCode)
      if (room) {
        const opponent = room.players.find(p => p.id !== playerId)
        if (opponent && !room.state.isOver) {
          const oppWs = this.connections.get(opponent.id)
          if (oppWs) {
            this.sendTo(oppWs, MSG.S_OPPONENT_DISCONNECT, { roomId: info.roomCode, message: '对手已断线' })
          }
        }
        this.rooms.delete(info.roomCode)
      }
    }

    this.connections.delete(playerId)
    this.playerInfo.delete(playerId)
    console.log('[清理] ' + playerId + ' 连接: ' + this.connections.size)
  }

  // ===================== 工具 =====================

  generateId(prefix) {
    this.idCounter++
    const ts = Date.now().toString(36).toUpperCase()
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
    const cnt = this.idCounter.toString(36).toUpperCase().padStart(4, '0')
    return prefix + ts + rand + cnt
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let code = ''
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)]
    }
    // 确保不重复
    if (this.rooms.has(code)) return this.generateRoomCode()
    return code
  }

  sendTo(ws, type, data = {}) {
    try {
      ws.send(JSON.stringify({ type, ...data }))
    } catch (err) {
      console.error('[发送失败]', err)
    }
  }
}