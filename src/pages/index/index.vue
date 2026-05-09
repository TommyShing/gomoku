<template>
  <!--
    主页面 - pages/index/index.vue

    这是整个五子棋小程序的主入口页面。
    职责：
    1. 管理整体游戏状态机（空闲→匹配/建房间→对弈→结束）
    2. 协调 WebSocket 连接、棋局逻辑、UI 组件之间的通信
    3. 管理倒计时（每步 30 秒限时）
    4. 处理游戏结束的胜负判定展示

    状态流转：
      idle → 连接服务器 → matching/room → playing → over → idle
  -->
  <view class="page">
    <!-- 标题 -->
    <view class="page-header">
      <text class="page-title">五子棋</text>
    </view>

    <!-- 游戏信息面板（对弈中/结束时显示） -->
    <game-info
      v-if="gameStatus === GAME_PLAYING || gameStatus === GAME_OVER"
      :gameStatus="gameStatus"
      :myColor="myColor"
      :opponentColor="opponentColor"
      :myName="'我'"
      :opponentName="opponentName"
      :isMyTurn="isMyTurn"
      :isGameOver="isGameOver"
      :timeRemaining="timeRemaining"
      :forbiddenWarning="forbiddenWarning"
      :resultText="resultText"
      :reasonText="reasonText"
      :isResigning="isResigning"
      :isWinner="isWinner"
      @resign="onResign"
    ></game-info>

    <!-- 房间/匹配面板（空闲/匹配中时显示） -->
    <room-panel
      v-if="gameStatus === GAME_IDLE || gameStatus === GAME_MATCHING"
      :connected="wsConnected"
      :connecting="wsConnecting"
      :isMatching="isMatching"
      :matchTimer="matchTimer"
      :roomCode="roomCode"
      :isCreating="isCreatingRoom"
      :isJoining="isJoiningRoom"
      :errorMsg="errorMessage"
      @connect="onConnect"
      @startMatch="onStartMatch"
      @cancelMatch="onCancelMatch"
      @createRoom="onCreateRoom"
      @joinRoom="onJoinRoom"
    ></room-panel>

    <!-- 棋盘（对弈中/结束时显示） -->
    <game-board
      v-if="gameStatus === GAME_PLAYING || gameStatus === GAME_OVER"
      :boardData="boardData"
      :lastMove="lastMove"
      :winLine="winLine"
      :currentPlayerColor="myColor"
      :isMyTurn="isMyTurn"
      :isGameOver="isGameOver"
      :lockedPos="lockedPos"
      :opponentLockedPos="opponentLockedPos"
      :isSubmitting="isSubmittingMove"
      @lock="onLockPosition"
      @confirm="onConfirmMove"
      @cancelLock="onCancelLock"
    ></game-board>

    <!-- 游戏结束后的按钮组 -->
    <view class="post-game-actions" v-if="gameStatus === GAME_OVER">
      <view class="ready-status" v-if="rematchReady || opponentReady">
        <text class="ready-text" v-if="rematchReady">你已准备 ✓</text>
        <text class="ready-text" v-if="opponentReady">对手已准备 ✓</text>
      </view>
      <view class="post-game-buttons">
        <button class="btn btn-again" @tap="onRematchRequest" :disabled="rematchReady">
          {{ rematchReady ? '等待对手...' : '再来一局' }}
        </button>
        <button class="btn btn-leave" @tap="onPlayAgain">返回大厅</button>
      </view>
    </view>

    <!-- 空闲且有房间号时显示离开房间按钮（创建房间后未开始游戏时） -->
    <view class="post-game-actions" v-if="gameStatus === GAME_IDLE && roomCode && wsConnected">
      <button class="btn btn-danger-sm" @tap="onLeaveRoom">离开房间</button>
    </view>

    <!-- 对弈中显示房间信息的折叠面板 -->
    <view class="toggle-panel" v-if="gameStatus === GAME_PLAYING" @tap="showPanelInGame = !showPanelInGame">
      <text class="toggle-text">{{ showPanelInGame ? '隐藏房间信息 ▲' : '显示房间信息 ▼' }}</text>
    </view>
    <view class="room-info-mini" v-if="gameStatus === GAME_PLAYING && showPanelInGame">
      <view class="connection-status connected">
        <text class="status-dot"></text>
        <text class="status-label">已连接</text>
      </view>
      <view class="mini-row" v-if="roomCode">
        <text class="mini-label">房间号</text>
        <text class="mini-value">{{ roomCode }}</text>
      </view>
      <view class="mini-row">
        <text class="mini-label">对手</text>
        <text class="mini-value">{{ opponentName }}</text>
      </view>
      <view class="mini-row">
        <text class="mini-label">你的颜色</text>
        <text class="mini-value">{{ myColor === BLACK ? '黑棋 ●' : '白棋 ○' }}</text>
      </view>
      <button class="btn btn-danger-sm" @tap="onLeaveRoom" style="margin-top: 8px;">离开房间</button>
    </view>
  </view>
</template>

<script>
/**
 * 主页面逻辑
 *
 * 这是一个组合式 API 风格的 Vue 组件（Vue 3）。
 * 所有游戏状态和逻辑都在此集中管理，子组件只负责渲染和事件传递。
 */
import GameBoard from '../../components/game-board.vue'
import GameInfo from '../../components/game-info.vue'
import RoomPanel from '../../components/room-panel.vue'
import { GameLogic } from '../../utils/game-logic'
import { WsManager } from '../../utils/websocket'
import {
  BOARD_SIZE, EMPTY, BLACK, WHITE,
  GAME_IDLE, GAME_MATCHING, GAME_PLAYING, GAME_OVER,
  WS_MSG, MOVE_TIMEOUT, COLOR_TO_ROLE, ROLE_TO_COLOR,
  FORBIDDEN_NONE, FORBIDDEN_THREE_THREE, FORBIDDEN_FOUR_FOUR, FORBIDDEN_OVERLINE
} from '../../utils/constants'

export default {
  components: { GameBoard, GameInfo, RoomPanel },
  data() {
    return {
      // 常量引用（模板中可直接使用）
      GAME_IDLE, GAME_MATCHING, GAME_PLAYING, GAME_OVER,
      BLACK, WHITE, EMPTY, BOARD_SIZE,

      // === 连接状态 ===
      wsConnected: false,
      wsConnecting: false,

      // === 游戏状态机 ===
      gameStatus: GAME_IDLE,
      myColor: null,   // 由服务端消息确定，不用默认值
      opponentColor: null,
      opponentName: '对手',
      isMyTurn: false,
      isGameOver: false,

      // === 匹配 ===
      isMatching: false,
      matchTimer: 0,
      matchTimerId: null,

      // === 房间 ===
      roomCode: '',
      isCreatingRoom: false,
      isJoiningRoom: false,

      // === 错误 ===
      errorMessage: '',

      // === 再来一局 ===
      rematchReady: false,       // 自己是否已准备
      opponentReady: false,      // 对手是否已准备

      // === 胜负 ===
      isWinner: false,

      // === 棋局 ===
      boardData: Array.from({ length: BOARD_SIZE }, () =>
        Array.from({ length: BOARD_SIZE }, () => EMPTY)
      ),
      lastMove: null,
      winLine: [],
      forbiddenWarning: '',

      // === 锁定位置（确认落子前先锁定） ===
      lockedPos: null,
      opponentLockedPos: null,  // 对手的预落子位置

      // === 落子 ===
      isSubmittingMove: false,
      isResigning: false,

      // === 倒计时 ===
      timeRemaining: 30,
      timerId: null,

      // === 其他 ===
      showPanelInGame: false,

      // 内部实例（非响应式）
      gameLogic: null,
      wsManager: null,
      unsubscribers: []
    }
  },

  /**
   * 页面生命周期：页面加载时
   */
  onLoad() {
    console.log('[Index] 页面加载')
    // 注意：created 先于 onLoad 执行，init 已在 created 中完成
  },

  /**
   * Vue 标准生命周期：实例创建后立即执行
   * 此时 data 已初始化，但 DOM 尚未挂载。
   * 适合做非 DOM 依赖的初始化（如 wsManager、gameLogic）。
   *
   * 注意：created 中不能调用 methods 里的函数，
   * 因为 methods 在 setup 阶段才挂载，所以初始化逻辑直接写在这里。
   */
  created() {
    console.log('[Index] created')
    this.gameLogic = new GameLogic()
    this.wsManager = new WsManager()
    this.bindWsEvents()
    this._inited = true
  },

  /**
   * 页面生命周期：页面卸载时
   * 清理所有资源
   */
  onUnload() {
    console.log('[Index] 页面卸载')
    this.cleanup()
  },

  /**
   * 页面隐藏时暂停倒计时（小程序后台时）
   */
  onHide() {
    this.stopTimer()
  },

  /**
   * 页面重新显示时恢复倒计时
   */
  onShow() {
    if (this.gameStatus === GAME_PLAYING && !this.isGameOver) {
      this.startTimer()
    }
  },

  methods: {
    // ==========================================
    //  WebSocket 事件绑定
    // ==========================================

    /**
     * 注册所有 WebSocket 事件监听
     * 使用 unsubscribers 数组记录取消函数，方便清理
     */
    bindWsEvents() {
      const ws = this.wsManager

      this.unsubscribers.push(
        ws.on('matched', this.onMatched),
        ws.on('roomCreated', this.onRoomCreated),
        ws.on('joined', this.onJoined),
        ws.on('gameStart', this.onGameStart),
        ws.on('opponentMove', this.onOpponentMove),
        ws.on('opponentPreLock', this.onOpponentPreLock),
        ws.on('rematch', this.onRematch),
        ws.on('gameOver', this.onGameOver),
        ws.on('error', this.onWsError),
        ws.on('disconnect', this.onWsDisconnect),
        ws.on('opponentDisconnect', (data) => {
          uni.showToast({ title: '对手已断线', icon: 'none', duration: 2000 })
          // 对局中断线，判当前玩家获胜
          if (this.gameStatus === GAME_PLAYING && !this.isGameOver) {
            this.gameStatus = GAME_OVER
            this.isGameOver = true
            this.stopTimer()
            this.resultText = '你赢了！'
            this.reasonText = '对手断线'
            this.lockedPos = null
            this.isSubmittingMove = false
          }
        }),
        ws.on('opponentReconnect', (data) => {
          uni.showToast({ title: '对手已重连', icon: 'success', duration: 1500 })
        }),
        ws.on('roomDestroyed', this.onRoomDestroyed),
        ws.on('playerLeft', this.onPlayerLeft),
        ws.on('rematchReady', this.onRematchReady),
        ws.on('reconnectFailed', () => {
          this.errorMessage = '重连失败，请检查网络'
          this.gameStatus = GAME_IDLE
          this.wsConnected = false
        })
      )
    },

    // ==========================================
    //  连接 / 匹配 / 房间操作
    // ==========================================

    /**
     * 连接到 WebSocket 服务器
     */
    onConnect() {
      if (!this.wsManager) {
        console.error('[Index] wsManager 未初始化')
        this.errorMessage = '内部错误：WebSocket 管理器未初始化'
        return
      }
      // 防止重复连接（exceed max task count）
      if (this.wsConnected || this.wsConnecting) {
        console.log('[Index] 已连接或正在连接中')
        return
      }
      // 确保旧连接已关闭
      this.wsManager.disconnect()
      this.wsConnecting = true
      this.errorMessage = ''
      this.wsManager.connect()
        .then(() => {
          this.wsConnected = true
          this.wsConnecting = false
          console.log('[Index] 连接成功')
        })
        .catch((err) => {
          this.wsConnecting = false
          this.errorMessage = '连接失败: ' + (err.errMsg || '未知错误')
          console.error('[Index] 连接失败:', err)
        })
    },

    /**
     * 开始随机匹配
     */
    onStartMatch() {
      this.isMatching = true
      this.errorMessage = ''
      this.gameStatus = GAME_MATCHING
      this.wsManager.send(WS_MSG.C_MATCH)

      // 匹配计时（显示给用户看）
      this.matchTimer = 0
      this.matchTimerId = setInterval(() => {
        this.matchTimer++
      }, 1000)

      // 超时提醒（60秒后提示）
      setTimeout(() => {
        if (this.isMatching) {
          uni.showToast({ title: '匹配时间较长，请耐心等待', icon: 'none', duration: 2000 })
        }
      }, 60000)
    },

    /**
     * 取消匹配
     */
    onCancelMatch() {
      this.isMatching = false
      this.gameStatus = GAME_IDLE
      this.wsManager.send(WS_MSG.C_CANCEL_MATCH)
      if (this.matchTimerId) {
        clearInterval(this.matchTimerId)
        this.matchTimerId = null
      }
      this.matchTimer = 0
    },

    /**
     * 创建私人房间
     */
    onCreateRoom() {
      this.isCreatingRoom = true
      this.errorMessage = ''
      this.wsManager.send(WS_MSG.C_CREATE_ROOM)
    },

    /**
     * 加入房间
     */
    onJoinRoom({ roomCode }) {
      this.isJoiningRoom = true
      this.errorMessage = ''
      this.wsManager.send(WS_MSG.C_JOIN_ROOM, { targetRoomId: roomCode })
    },

    // ==========================================
    //  WebSocket 消息处理
    // ==========================================

    /**
     * 匹配成功
     */
    onMatched(data) {
      console.log('[Index] 匹配成功:', data)
      this.isMatching = false
      this.roomCode = ''
      if (this.matchTimerId) {
        clearInterval(this.matchTimerId)
        this.matchTimerId = null
      }
      // 分配颜色：先匹配的为黑棋
      // data.color: 'black' | 'white'
      this.myColor = data.color === 'black' ? BLACK : WHITE
      this.opponentColor = data.color === 'black' ? WHITE : BLACK
      this.opponentName = data.opponentName || '对手'
    },

    /**
     * 房间创建成功
     */
    onRoomCreated(data) {
      console.log('[Index] 房间创建成功:', data)
      this.isCreatingRoom = false
      this.roomCode = data.roomCode
      this.myColor = BLACK // 房主为黑棋
      this.opponentColor = WHITE
      this.opponentName = '等待加入...'
      this.gameStatus = GAME_IDLE
      uni.showToast({ title: '房间创建成功', icon: 'success', duration: 1500 })
    },

    /**
     * 加入房间成功
     *
     * 注意：S_JOINED 会发给房间内双方。
     * 颜色在 onRoomCreated（房主）或 onGameStart（加入者）中已设置，
     * 所以这里不修改 myColor，避免房主被覆盖。
     */
    onJoined(data) {
      console.log('[Index] 加入房间成功:', data)
      this.isJoiningRoom = false
      this.roomCode = data.roomCode
      // 只有加入者（当前还没颜色）才设置颜色
      // 房主的颜色在 onRoomCreated 中已设为 BLACK
      if (this.myColor === null || this.myColor === undefined) {
        this.myColor = WHITE
        this.opponentColor = BLACK
      }
      this.opponentName = data.opponentName || '房主'
      this.gameStatus = GAME_IDLE
      uni.showToast({ title: '加入房间成功', icon: 'success', duration: 1500 })
    },

    /**
     * 游戏开始
     */
    onGameStart(data) {
      console.log('[Index] 游戏开始:', data)
      this.gameStatus = GAME_PLAYING
      this.isGameOver = false
      this.gameLogic.reset()
      this.boardData = this.gameLogic.getBoard()
      this.lastMove = null
      this.winLine = []
      this.lockedPos = null
      this.opponentLockedPos = null
      this.forbiddenWarning = ''
      this.isSubmittingMove = false
      this.isResigning = false

      // 确定颜色（优先用服务端 yourColor）
      if (data.yourColor) {
        this.myColor = data.yourColor === 'black' ? BLACK : WHITE
        this.opponentColor = data.yourColor === 'black' ? WHITE : BLACK
        this.opponentName = data.yourColor === 'black' ? data.whitePlayer : data.blackPlayer
      }
      // 没有 yourColor（旧版 Worker）→ 保留 onRoomCreated/onJoined 已设置的颜色

      this.isMyTurn = this.myColor === BLACK
      this.timeRemaining = MOVE_TIMEOUT / 1000
      this.startTimer()
    },

    /**
     * 对手落子通知
     */
    onOpponentMove(data) {
      console.log('[Index] 对手落子:', data)
      const { row, col, color } = data

      // 对手落子占了预落子位置 → 只清空被占的那格
      if (this.lockedPos && this.lockedPos.row === row && this.lockedPos.col === col) {
        this.lockedPos = null
      }
      if (this.opponentLockedPos && this.opponentLockedPos.row === row && this.opponentLockedPos.col === col) {
        this.opponentLockedPos = null
      }
      // 注意：其他格的预落子（lockedPos）保留，自动继承到下一回合

      // 用本地逻辑验证并执行落子
      const result = this.gameLogic.placeStone(row, col, color)
      if (!result.success) {
        console.error('[Index] 对手落子本地校验失败:', result.error)
        return
      }

      this.boardData = this.gameLogic.getBoard()
      this.lastMove = { row, col }
      this.isSubmittingMove = false

      // 检查对手是否获胜
      if (result.win) {
        this.onOpponentWin(data, result.winLine || [])
        return
      }

      if (result.draw) {
        this.onDraw()
        return
      }

      // 轮到我了
      this.isMyTurn = true
      this.timeRemaining = MOVE_TIMEOUT / 1000
      this.startTimer()
      this.forbiddenWarning = ''
    },

    /**
     * 游戏结束（服务端通知）
     *
     * 注意：当玩家自己获胜时，本地已经设置了 winLine。
     * 服务器不跟踪棋盘状态，所以 game_over 消息不含 winLine。
     * 这里要保留本地已设置的 winLine。
     */
    onGameOver(data) {
      console.log('[Index] 游戏结束:', data)
      this.gameStatus = GAME_OVER
      this.isGameOver = true
      this.stopTimer()
      this.isSubmittingMove = false
      this.isResigning = false
      this.rematchReady = false
      this.opponentReady = false

      if (data.lastMove) {
        this.lastMove = data.lastMove
      }

      // 判断胜负
      let iWin = false
      const winner = data.winner
      if (winner === 'draw') {
        this.resultText = '平局'
        this.reasonText = data.reason || '棋盘已满'
      } else {
        iWin = (winner === 'black' && this.myColor === BLACK) ||
               (winner === 'white' && this.myColor === WHITE)
        if (iWin) {
          this.resultText = '你赢了！'
          this.reasonText = this.getWinReasonText(data.reason)
        } else {
          this.resultText = '你输了'
          this.reasonText = this.getLoseReasonText(data.reason)
        }
      }
      this.isWinner = iWin
    },

    // ==========================================
    //  棋局操作
    // ==========================================

    /**
     * 锁定位置（触碰棋盘时触发）
     *
     * 当玩家触摸棋盘时，先锁定位置显示阴影，
     * 等待玩家点击"确认落子"按钮才正式提交。
     *
     * 这样可以避免误触导致立即落子，
     * 同时如果在时限结束时位置已锁定，自动提交。
     */
    onLockPosition(pos) {
      // 检查该位置是否合法
      if (this.boardData[pos.row][pos.col] !== EMPTY) return

      // 如果是对手回合（预落子），只保存位置不触发确认
      if (!this.isMyTurn) {
        this.lockedPos = { ...pos, color: this.myColor }
        // 发送预落子给对手
        this.wsManager.send(WS_MSG.C_PRE_LOCK, {
          row: pos.row,
          col: pos.col,
          color: this.myColor
        })
        return
      }

      // 自己的回合：点击同一位置视为确认
      if (this.lockedPos &&
          this.lockedPos.row === pos.row &&
          this.lockedPos.col === pos.col) {
        this.onConfirmMove()
        return
      }

      // 禁手提示（如果当前玩家是黑方）
      if (this.myColor === BLACK) {
        const forbiddenType = this.gameLogic.checkForbidden(pos.row, pos.col)
        if (forbiddenType !== FORBIDDEN_NONE) {
          this.forbiddenWarning = '⚠ 警告：此位置可能导致' + this.gameLogic.getForbiddenText(forbiddenType)
        } else {
          this.forbiddenWarning = ''
        }
      }

      this.lockedPos = { ...pos, color: this.myColor }
      // 发送预落子给对手
      this.wsManager.send(WS_MSG.C_PRE_LOCK, {
        row: pos.row,
        col: pos.col,
        color: this.myColor
      })
    },

    /**
     * 对手预落子同步
     */
    onOpponentPreLock(data) {
      this.opponentLockedPos = { row: data.row, col: data.col, color: data.color }
    },

    /**
     * 再来一局（服务端通知）
     */
    onRematch(data) {
      console.log('[Index] 再来一局:', data)
      this.gameStatus = GAME_PLAYING
      this.isGameOver = false
      this.gameLogic.reset()
      this.boardData = this.gameLogic.getBoard()
      this.lastMove = null
      this.winLine = []
      this.lockedPos = null
      this.opponentLockedPos = null
      this.forbiddenWarning = ''
      this.isSubmittingMove = false
      this.isResigning = false
      this.isWinner = false
      this.resultText = ''
      this.reasonText = ''
      this.rematchReady = false
      this.opponentReady = false

      // 用服务端发来的 yourColor 确定颜色
      this.myColor = data.yourColor === 'black' ? BLACK : WHITE
      this.opponentColor = data.yourColor === 'black' ? WHITE : BLACK
      this.opponentName = data.yourColor === 'black' ? data.whitePlayer : data.blackPlayer

      this.isMyTurn = this.myColor === BLACK
      this.timeRemaining = MOVE_TIMEOUT / 1000
      this.startTimer()
    },

    /**
     * 确认落子
     *
     * 将锁定位置正式落子，并通过 WebSocket 发送给对手。
     *
     * 关键设计：
     * - 本地先执行落子逻辑（含禁手检测）
     * - 如果成功，发送 C_MOVE 给服务器
     * - 如果本地检测到获胜/平局，在消息中标记 win/draw
     * - 服务器收到标记后会广播 S_GAME_OVER 给双方
     * - 双方都等待服务器的 game_over 消息来结束游戏
     */
    onConfirmMove() {
      if (!this.lockedPos || this.isSubmittingMove) return

      const { row, col } = this.lockedPos
      this.isSubmittingMove = true

      // 本地执行落子（含禁手检测）
      const result = this.gameLogic.placeStone(row, col, this.myColor)
      if (!result.success) {
        this.isSubmittingMove = false
        if (result.forbidden) {
          uni.showToast({ title: '禁手！' + result.error, icon: 'none', duration: 2000 })
        } else {
          uni.showToast({ title: result.error, icon: 'none', duration: 1500 })
        }
        return
      }

      this.boardData = this.gameLogic.getBoard()
      this.lastMove = { row, col }
      this.lockedPos = null
      this.forbiddenWarning = ''

      // 构建发送给服务器的消息
      const moveMsg = {
        row,
        col,
        color: this.myColor
      }

      // 如果本地检测到获胜或平局，标记在消息中
      // 服务器收到后会广播 S_GAME_OVER 给双方
      if (result.win) {
        moveMsg.win = true
        this.winLine = result.winLine || []
        this.isMyTurn = false
        this.stopTimer()
        // 本地先显示获胜状态（服务器确认后也会发 game_over）
      } else if (result.draw) {
        moveMsg.draw = true
        this.isMyTurn = false
        this.stopTimer()
      }

      // 发送落子到服务器
      this.wsManager.send(WS_MSG.C_MOVE, moveMsg)

      if (result.win || result.draw) {
        // 游戏结束标记已发送，等待服务器广播 game_over
        // 服务器发来的 game_over 会触发 onGameOver
        // 这里不立即设置 gameStatus 为 over
        return
      }

      // 切换回合 — 双方各自计时，同一时间基准下偏差在可接受范围
      this.isMyTurn = false
      this.timeRemaining = MOVE_TIMEOUT / 1000
      this.isSubmittingMove = false
    },

    /**
     * 取消锁定
     */
    onCancelLock() {
      this.lockedPos = null
      this.forbiddenWarning = ''
    },

    /**
     * 认输
     */
    onResign() {
      this.isResigning = true
      this.wsManager.send(WS_MSG.C_RESIGN)
    },

    // ==========================================
    //  游戏结束处理
    // ==========================================

    /**
     * 对手获胜
     */
    onOpponentWin(data, winLine) {
      this.gameStatus = GAME_OVER
      this.isGameOver = true
      this.isMyTurn = false
      this.stopTimer()
      this.winLine = winLine || []
      this.resultText = '😢 你输了'
      this.reasonText = '对手五子连珠'
      this.lockedPos = null
      this.isSubmittingMove = false
    },

    /**
     * 平局
     */
    onDraw() {
      this.gameStatus = GAME_OVER
      this.isGameOver = true
      this.isMyTurn = false
      this.stopTimer()
      this.resultText = '平局'
      this.reasonText = '棋盘已满，无位置可下'
      this.lockedPos = null
      this.isSubmittingMove = false
    },

    /**
     * 获取胜利原因文本
     */
    getWinReasonText(reason) {
      const map = {
        'five': '你五子连珠',
        'resign': '对手认输',
        'timeout': '对手超时未落子',
        'forbidden': '对手违反禁手规则'
      }
      return map[reason] || '你获胜了'
    },

    /**
     * 获取失败原因文本
     */
    getLoseReasonText(reason) {
      const map = {
        'five': '对手五子连珠',
        'resign': '你认输了',
        'timeout': '超时未落子',
        'forbidden': '违反禁手规则',
        'disconnected': '断线'
      }
      return map[reason] || '你输了'
    },

    /**
     * 离开房间
     * 游戏结束后调用，通知服务端并返回大厅
     */
    onLeaveRoom() {
      this.wsManager.send(WS_MSG.C_LEAVE_ROOM)
      this.resetToLobby()
    },

    /**
     * 房间被服务端销毁（房主离开/超时等）
     */
    onRoomDestroyed(data) {
      console.log('[Index] 房间已销毁:', data)
      uni.showToast({ title: data.reason || '房间已关闭', icon: 'none', duration: 2000 })
      this.resetToLobby()
    },

    /**
     * 对方离开房间
     */
    onPlayerLeft(data) {
      console.log('[Index] 对方离开:', data)
      uni.showToast({ title: data.message || '对方已离开', icon: 'none', duration: 2000 })
      if (this.gameStatus === GAME_PLAYING || this.gameStatus === GAME_OVER) {
        this.gameStatus = GAME_OVER
        this.isGameOver = true
        this.stopTimer()
        this.resultText = '对方已离开'
        this.reasonText = ''
      } else {
        this.resetToLobby()
      }
    },

    /**
     * 重置到大厅状态
     */
    resetToLobby() {
      this.gameStatus = GAME_IDLE
      this.isGameOver = false
      this.isMyTurn = false
      this.boardData = Array.from({ length: BOARD_SIZE }, () =>
        Array.from({ length: BOARD_SIZE }, () => EMPTY)
      )
      this.lastMove = null
      this.winLine = []
      this.lockedPos = null
      this.opponentLockedPos = null
      this.forbiddenWarning = ''
      this.resultText = ''
      this.reasonText = ''
      this.isSubmittingMove = false
      this.isResigning = false
      this.isCreatingRoom = false
      this.isJoiningRoom = false
      this.isMatching = false
      this.isWinner = false
      this.roomCode = ''
      this.showPanelInGame = false
      this.timeRemaining = 30
      this.gameLogic.reset()
      this.stopTimer()
      // 同步清除 wsManager 中的房间状态
      if (this.wsManager) {
        this.wsManager.roomId = null
      }
    },

    /**
     * 再来一局（返回大厅）
     */
    onRematchRequest() {
      if (this.rematchReady) return
      this.rematchReady = true
      this.wsManager.send(WS_MSG.C_REMATCH)
    },

    onRematchReady() {
      this.opponentReady = true
      uni.showToast({ title: '对方已准备 ✓', icon: 'none', duration: 1500 })
    },

    onPlayAgain() {
      this.onLeaveRoom()
    },

    // ==========================================
    //  超时处理
    // ==========================================

    /**
     * 启动倒计时
     */
    startTimer() {
      this.stopTimer()
      this.timerId = setInterval(() => {
        this.timeRemaining--
        if (this.timeRemaining <= 0) {
          this.onTimeout()
        }
      }, 1000)
    },

    /**
     * 停止倒计时
     */
    stopTimer() {
      if (this.timerId) {
        clearInterval(this.timerId)
        this.timerId = null
      }
    },

    /**
     * 超时处理
     *
     * 注意：如果位置已锁定但未确认，在超时时自动提交该位置。
     * 不视作未落子失败。
     */
    onTimeout() {
      this.stopTimer()

      if (this.lockedPos && this.isMyTurn && !this.isGameOver) {
        // 位置已锁定 → 自动确认落子
        console.log('[Index] 超时，自动提交锁定位置')
        this.onConfirmMove()
        return
      }

      if (this.isMyTurn && !this.isGameOver) {
        // 未锁定位置且超时 → 判负
        console.log('[Index] 超时未落子')
        this.wsManager.send(WS_MSG.C_MOVE, { timeout: true })
        this.gameStatus = GAME_OVER
        this.isGameOver = true
        this.resultText = '😢 你输了'
        this.reasonText = '超时未落子'
      }
    },

    // ==========================================
    //  错误处理与清理
    // ==========================================

    /**
     * WebSocket 错误
     */
    onWsError(data) {
      console.error('[Index] WS错误:', data)
      this.errorMessage = data.message || '连接错误'
    },

    /**
     * WebSocket 断连
     */
    onWsDisconnect() {
      this.wsConnected = false
      if (this.gameStatus === GAME_PLAYING && !this.isGameOver) {
        uni.showToast({ title: '连接断开', icon: 'none', duration: 2000 })
      }
    },

    /**
     * 清理所有资源
     */
    cleanup() {
      this.stopTimer()
      if (this.matchTimerId) {
        clearInterval(this.matchTimerId)
        this.matchTimerId = null
      }
      // 取消 WebSocket 事件监听
      for (const unsub of this.unsubscribers) {
        unsub()
      }
      this.unsubscribers = []
      if (this.wsManager) {
        this.wsManager.disconnect()
      }
      this.wsConnected = false
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  background-color: #f0ebe3;
  padding-bottom: 30px;
}

.page-header {
  text-align: center;
  padding: 20px 0 10px;
}

.page-title {
  font-size: 24px;
  font-weight: bold;
  color: #2c3e50;
  letter-spacing: 4px;
}

.post-game-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 16px;
}

.post-game-buttons {
  display: flex;
  flex-direction: row;
  justify-content: center;
  gap: 16px;
  margin-top: 10px;
}

.ready-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin-bottom: 10px;
}

.ready-text {
  font-size: 14px;
  color: #09bb07;
}

.btn-again:disabled {
  opacity: 0.6;
}

.btn {
  min-width: 140px;
  padding: 12px 32px;
  border-radius: 8px;
  font-size: 16px;
  text-align: center;
  border: none;
  transition: all 0.2s ease;
}

.btn-again {
  background-color: #4CAF50;
  color: white;
}

.btn-again:active {
  background-color: #45a049;
}

.btn-leave {
  min-width: 140px;
  padding: 12px 32px;
  border-radius: 8px;
  font-size: 16px;
  text-align: center;
  border: none;
  background-color: #f44336;
  color: white;
  line-height: 1.5;
}

.btn-leave:active {
  background-color: #d32f2f;
}

.btn-danger-sm {
  min-width: 120px;
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 14px;
  text-align: center;
  border: none;
  background-color: #f44336;
  color: white;
}

.btn-danger-sm:active {
  background-color: #d32f2f;
}

.toggle-panel {
  text-align: center;
  padding: 8px;
  margin: 8px 12px;
  background-color: rgba(255,255,255,0.8);
  border-radius: 6px;
}

.toggle-text {
  font-size: 13px;
  color: #2196F3;
}

/* 对弈中房间信息面板 */
.room-info-mini {
  background-color: #fff;
  border-radius: 8px;
  margin: 0 12px 8px;
  padding: 12px 16px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.mini-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}

.mini-label {
  font-size: 13px;
  color: #999;
}

.mini-value {
  font-size: 14px;
  color: #333;
  font-weight: bold;
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  background-color: #e8f5e9;
  color: #2e7d32;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #4caf50;
  display: inline-block;
}
</style>