<template>
  <!--
    游戏信息面板组件 - game-info.vue

    职责：
    1. 显示当前游戏状态（等待中、对弈中、已结束）
    2. 显示双方棋子颜色和用时
    3. 显示倒计时（每步限时）
    4. 显示禁手警告
    5. 提供"认输"按钮
  -->
  <view class="game-info">
    <!-- 游戏状态标题 -->
    <view class="status-bar" :class="statusClass">
      <text class="status-text">{{ statusText }}</text>
    </view>

    <!-- 玩家信息 -->
    <view class="players">
      <!-- 我方信息 -->
      <view class="player-info" :class="{ active: isMyTurn && !isGameOver }">
        <view class="player-label">
          <text class="player-name">{{ myName }}</text>
          <view v-if="myColor === BLACK || myColor === WHITE" class="stone-dot" :class="myColor === BLACK ? 'dot-black' : 'dot-white'"></view>
          <text class="player-role">{{ myColor === BLACK ? '黑棋' : (myColor === WHITE ? '白棋' : '') }}</text>
        </view>
      </view>

      <!-- VS -->
      <view class="vs-text">
        <text>VS</text>
      </view>

      <!-- 对手信息 -->
      <view class="player-info" :class="{ active: !isMyTurn && !isGameOver }">
        <view class="player-label">
          <text class="player-name">{{ opponentName }}</text>
          <view v-if="opponentColor === BLACK || opponentColor === WHITE" class="stone-dot" :class="opponentColor === BLACK ? 'dot-black' : 'dot-white'"></view>
          <text class="player-role">{{ opponentColor === BLACK ? '黑棋' : (opponentColor === WHITE ? '白棋' : '') }}</text>
        </view>
      </view>
    </view>

    <!-- 倒计时 — 双方都显示，但非回合方显示固定值（始终 >= 回合方的实际剩余） -->
    <view class="timer-bar" v-if="isPlaying">
      <text class="timer-label">剩余时间</text>
      <text class="timer-value" :class="{ urgent: displayTime <= 5 }">
        {{ formatTime(displayTime) }}
      </text>
    </view>

    <!-- 禁手警告 -->
    <view class="forbidden-warning" v-if="forbiddenWarning">
      <text class="warning-text">{{ forbiddenWarning }}</text>
    </view>

    <!-- 游戏结束信息 -->
    <view class="game-result" :class="isWinner ? 'result-win' : 'result-lose'" v-if="isGameOver">
      <text class="result-text">{{ resultText }}</text>
      <text class="reason-text">{{ reasonText }}</text>
    </view>

    <!-- 操作按钮 -->
    <view class="actions">
      <!-- 认输按钮（对弈中且未结束） -->
      <button
        v-if="isPlaying && !isGameOver"
        class="btn btn-resign"
        @tap="onResign"
        :disabled="isResigning"
      >
        {{ isResigning ? '确认中...' : '认输' }}
      </button>
    </view>
  </view>
</template>

<script>
/**
 * 游戏信息面板组件
 *
 * Props:
 * - gameStatus: 游戏状态 (idle/matching/playing/over)
 * - myColor: 我方棋子颜色 (BLACK/WHITE)
 * - opponentColor: 对手棋子颜色
 * - myName: 我方昵称
 * - opponentName: 对手昵称
 * - isMyTurn: 是否轮到当前玩家
 * - isGameOver: 游戏是否结束
 * - timeRemaining: 剩余时间（秒）
 * - forbiddenWarning: 禁手警告文本
 * - resultText: 胜负结果文本
 * - reasonText: 胜负原因文本
 * - isResigning: 是否正在提交认输
 *
 * Events:
 * - resign: 认输事件
 */
import { BLACK, WHITE, GAME_PLAYING, GAME_MATCHING, GAME_IDLE, GAME_OVER, MOVE_TIMEOUT } from '../utils/constants'

export default {
  name: 'GameInfo',
  props: {
    gameStatus: {
      type: String,
      default: GAME_IDLE
    },
    myColor: {
      type: Number,
      default: BLACK
    },
    opponentColor: {
      type: Number,
      default: WHITE
    },
    myName: {
      type: String,
      default: '我'
    },
    opponentName: {
      type: String,
      default: '对手'
    },
    isMyTurn: {
      type: Boolean,
      default: false
    },
    isGameOver: {
      type: Boolean,
      default: false
    },
    timeRemaining: {
      type: Number,
      default: 30
    },
    forbiddenWarning: {
      type: String,
      default: ''
    },
    resultText: {
      type: String,
      default: ''
    },
    reasonText: {
      type: String,
      default: ''
    },
    isResigning: {
      type: Boolean,
      default: false
    },
    isWinner: {
      type: Boolean,
      default: false
    }
  },
  emits: ['resign'],
  computed: {
    /**
     * 是否在对弈中
     */
    isPlaying() {
      return this.gameStatus === GAME_PLAYING
    },

    /**
     * 状态文本
     */
    statusText() {
      const map = {
        [GAME_IDLE]: '等待开始',
        [GAME_MATCHING]: '匹配中...',
        [GAME_PLAYING]: this.isMyTurn ? '轮到你落子' : '等待对手落子',
        [GAME_OVER]: '游戏结束'
      }
      return map[this.gameStatus] || '未知状态'
    },

    /**
     * 状态样式类名
     */
    statusClass() {
      if (this.gameStatus === GAME_PLAYING) {
        return this.isMyTurn ? 'status-my-turn' : 'status-waiting'
      }
      if (this.gameStatus === GAME_OVER) {
        return 'status-over'
      }
      return 'status-idle'
    },

    /**
     * 显示用的剩余时间
     * 双方各自计时，从同一初始值开始递减，偏差在可接受范围
     */
    displayTime() {
      return this.timeRemaining
    }
  },
  methods: {
    /**
     * 格式化倒计时
     */
    formatTime(seconds) {
      const m = Math.floor(seconds / 60)
      const s = seconds % 60
      return `${m}:${s.toString().padStart(2, '0')}`
    },

    /**
     * 认输
     */
    onResign() {
      uni.showModal({
        title: '认输确认',
        content: '确定要认输吗？',
        success: (res) => {
          if (res.confirm) {
            this.$emit('resign')
          }
        }
      })
    }
  }
}
</script>

<style scoped>
.game-info {
  padding: 12px 16px;
  background-color: #fff;
  border-radius: 8px;
  margin: 8px 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

/* 状态栏 */
.status-bar {
  text-align: center;
  padding: 8px 0;
  border-radius: 6px;
  margin-bottom: 10px;
}

.status-idle {
  background-color: #e3f2fd;
}

.status-my-turn {
  background-color: #e8f5e9;
  animation: statusPulse 1.5s ease-in-out infinite;
}

.status-waiting {
  background-color: #fff3e0;
}

.status-over {
  background-color: #fce4ec;
}

@keyframes statusPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.status-text {
  font-size: 16px;
  font-weight: bold;
  color: #333;
}

/* 玩家信息 */
.players {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}

.player-info {
  flex: 1;
  text-align: center;
  padding: 8px;
  border-radius: 6px;
  transition: all 0.3s ease;
}

.player-info.active {
  background-color: #f0f8ff;
  border: 1px solid #b3d9ff;
}

.player-label {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex-wrap: wrap;
}

.player-name {
  font-size: 14px;
  font-weight: bold;
  color: #333;
}

.stone-dot {
  display: inline-block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-black {
  background-color: #1a1a1a;
}
.dot-white {
  background-color: #fff;
  border: 2px solid #1a1a1a;
}

.player-role {
  font-size: 12px;
  color: #666;
}

.vs-text {
  padding: 0 12px;
  font-size: 14px;
  color: #999;
  font-weight: bold;
}

/* 倒计时 */
.timer-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 0;
}

.timer-label {
  font-size: 14px;
  color: #666;
}

.timer-value {
  font-size: 24px;
  font-weight: bold;
  color: #333;
  font-variant-numeric: tabular-nums;
}

.timer-value.urgent {
  color: #f44336;
  animation: urgentPulse 0.5s ease-in-out infinite;
}

@keyframes urgentPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* 禁手警告 */
.forbidden-warning {
  background-color: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 4px;
  padding: 6px 12px;
  margin: 8px 0;
  text-align: center;
}

.warning-text {
  font-size: 13px;
  color: #856404;
}

/* 游戏结果 */
.game-result {
  text-align: center;
  padding: 12px 0;
  margin: 8px 0;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.result-win {
  background-color: #c8e6c9;
}

.result-lose {
  background-color: #fce4ec;
}

.result-text {
  font-size: 20px;
  font-weight: bold;
  color: #d32f2f;
}

.reason-text {
  font-size: 14px;
  color: #666;
}

/* 操作按钮 */
.actions {
  display: flex;
  justify-content: center;
  padding: 8px 0;
}

.btn {
  min-width: 100px;
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 15px;
  text-align: center;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-resign {
  background-color: #f44336;
  color: white;
}

.btn-resign:active {
  background-color: #d32f2f;
}

.btn-resign[disabled] {
  background-color: #ef9a9a;
  cursor: not-allowed;
}
</style>