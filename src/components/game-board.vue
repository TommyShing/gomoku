<template>
  <!--
    棋盘组件 - game-board.vue

    职责：
    1. 绘制 15×15 棋盘网格
    2. 显示棋子（含最后一步标记、获胜高亮）
    3. 处理触屏事件 — 使用透明触摸网格覆盖在棋盘上
    4. 显示锁定位置的阴影标记
    5. 提供"确认落子"和"取消锁定"按钮

    触摸方案：
    - 在棋盘上方覆盖一层透明网格，每个交叉点对应一个 touchable 区域
    - 用户点击某个交叉点区域，直接触发对应 row/col 的事件
    - 不需要从 touch 坐标反算位置，避免了平台差异
  -->
  <view class="board-container">
    <!-- 棋盘主体 -->
    <view
      class="board"
      :style="boardStyle"
      :key="'board-' + boardVersion"
    >
      <!-- 棋盘背景 -->
      <view class="board-bg" :style="bgStyle"></view>

      <!-- 横线 -->
      <view
        v-for="row in BOARD_SIZE"
        :key="`hline-${row}`"
        class="grid-line horizontal"
        :style="getHLineStyle(row - 1)"
      ></view>

      <!-- 竖线 -->
      <view
        v-for="col in BOARD_SIZE"
        :key="`vline-${col}`"
        class="grid-line vertical"
        :style="getVLineStyle(col - 1)"
      ></view>

      <!-- 星位标记 -->
      <view
        v-for="star in starPoints"
        :key="`star-${star.row}-${star.col}`"
        class="star-point"
        :style="renderer.getStarStyle(star.row, star.col)"
      ></view>

      <!-- 透明触摸网格覆盖层 — 每个交叉点一个可触摸区域 -->
      <view
        v-for="point in touchGrid"
        :key="`touch-${point.row}-${point.col}`"
        class="touch-cell"
        :style="getTouchCellStyle(point.row, point.col)"
        @tap="onCellTap(point.row, point.col)"
      ></view>

      <!-- 锁定位置的阴影（自己的） -->
      <view
        v-if="lockedPos"
        class="lock-shadow"
        :style="renderer.getLockShadowStyle(lockedPos.row, lockedPos.col, lockedPos.color)"
      ></view>

      <!-- 对手预落子标记（虚线框，不带动画，表示对方想下这里） -->
      <view
        v-if="opponentLockedPos"
        class="opponent-lock"
        :style="renderer.getLockShadowStyle(opponentLockedPos.row, opponentLockedPos.col, opponentLockedPos.color)"
      ></view>

      <!-- 棋子 -->
      <view
        v-for="(stone, index) in stones"
        :key="`stone-${stone.row}-${stone.col}`"
        class="stone"
        :style="renderer.getStoneStyle(
          stone.color,
          stone.row,
          stone.col,
          isGameOver ? false : stone.isLast,
          isWinLine(stone.row, stone.col)
        )"
      ></view>

      <!-- 对方回合时的灰化遮罩 -->
      <view v-if="!isMyTurn && !isGameOver" class="turn-overlay"></view>
    </view>

    <!-- 操作按钮 -->
    <view class="board-actions" v-if="showActions">
      <button
        v-if="lockedPos && isMyTurn && !isGameOver"
        class="btn btn-confirm"
        @tap="onConfirm"
        :disabled="isSubmitting"
      >
        {{ isSubmitting ? '提交中...' : '确认落子' }}
      </button>

      <button
        v-if="lockedPos && isMyTurn && !isGameOver"
        class="btn btn-cancel"
        @tap="onCancelLock"
      >
        取消锁定
      </button>
    </view>
  </view>
</template>

<script>
/**
 * Props:
 * - boardData: 15×15 棋盘数据数组 (0=空, 1=黑, 2=白)
 * - lastMove: {row, col} 最后一步
 * - winLine: [[row, col], ...] 获胜连线
 * - currentPlayerColor: 当前玩家的棋子颜色 (1=黑, 2=白)
 * - isMyTurn: 是否轮到当前玩家
 * - isGameOver: 游戏是否结束
 * - lockedPos: {row, col, color} 锁定位置
 * - isSubmitting: 是否正在提交落子
 *
 * Events:
 * - lock: 位置锁定 {row, col, color}
 * - confirm: 确认落子
 * - cancelLock: 取消锁定
 */
import { BOARD_SIZE, EMPTY, BLACK, WHITE } from '../utils/constants'
import { BoardRenderer } from '../utils/board-renderer'

export default {
  name: 'GameBoard',
  props: {
    boardData: { type: Array, required: true },
    lastMove: { type: Object, default: null },
    winLine: { type: Array, default: () => [] },
    currentPlayerColor: { type: Number, default: BLACK },
    isMyTurn: { type: Boolean, default: false },
    isGameOver: { type: Boolean, default: false },
    lockedPos: { type: Object, default: null },
    opponentLockedPos: { type: Object, default: null },
    isSubmitting: { type: Boolean, default: false }
  },
  emits: ['lock', 'confirm', 'cancelLock'],
  data() {
    return {
      BOARD_SIZE,
      renderer: new BoardRenderer(),
      boardVersion: 0 // 递增以触发 Vue 重渲染
    }
  },
  computed: {
    boardStyle() {
      const size = this.renderer.getBoardSize()
      return { width: size + 'px', height: size + 'px', position: 'relative' }
    },
    bgStyle() {
      return this.renderer.getBoardBackgroundStyle()
    },
    stones() {
      const result = []
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (this.boardData[r][c] !== EMPTY) {
            result.push({
              row: r, col: c,
              color: this.boardData[r][c],
              isLast: this.lastMove && this.lastMove.row === r && this.lastMove.col === c
            })
          }
        }
      }
      return result
    },
    starPoints() {
      const pts = []
      for (let r = 0; r < BOARD_SIZE; r++)
        for (let c = 0; c < BOARD_SIZE; c++)
          if (this.renderer.isStarPoint(r, c)) pts.push({ row: r, col: c })
      return pts
    },
    touchGrid() {
      const cells = []
      for (let r = 0; r < BOARD_SIZE; r++)
        for (let c = 0; c < BOARD_SIZE; c++)
          cells.push({ row: r, col: c })
      return cells
    },
    showActions() {
      return !this.isGameOver
    }
  },
  created() {
    this.calcSize()
  },
  mounted() {
    uni.onWindowResize && uni.onWindowResize(() => {
      this.calcSize()
    })
  },
  methods: {
    calcSize() {
      const sysInfo = uni.getSystemInfoSync()
      const sw = sysInfo.windowWidth
      const padding = 15
      let cellSize = Math.floor((sw - padding * 2) / (BOARD_SIZE - 1))
      if (cellSize < 20) cellSize = 20
      this.renderer.init(cellSize, padding)
      this.boardVersion++
    },

    /** 每个交叉点的触摸区域样式 — 半格大小，居中于交叉点 */
    getTouchCellStyle(row, col) {
      const pos = this.renderer.getPosition(row, col)
      const half = this.renderer.cellSize * 0.5
      return {
        position: 'absolute',
        left: (pos.x - half) + 'px',
        top: (pos.y - half) + 'px',
        width: this.renderer.cellSize + 'px',
        height: this.renderer.cellSize + 'px',
        zIndex: 5,
        backgroundColor: 'transparent'
      }
    },

    getHLineStyle(row) {
      const pos = this.renderer.getPosition(row, 0)
      const p = this.renderer.padding
      const w = this.renderer.getBoardSize() - p * 2
      return {
        position: 'absolute', left: p + 'px', top: pos.y + 'px',
        width: w + 'px', height: '1px', backgroundColor: '#8B7355', zIndex: 1
      }
    },

    getVLineStyle(col) {
      const pos = this.renderer.getPosition(0, col)
      const p = this.renderer.padding
      const h = this.renderer.getBoardSize() - p * 2
      return {
        position: 'absolute', left: pos.x + 'px', top: p + 'px',
        width: '1px', height: h + 'px', backgroundColor: '#8B7355', zIndex: 1
      }
    },

    /** 点击某个交叉点 */
    onCellTap(row, col) {
      if (this.isGameOver) return
      if (this.boardData[row][col] !== EMPTY) return

      // 即使是对方回合也允许预落子（锁定位置）
      // 预落子的阴影用当前玩家的颜色
      this.$emit('lock', { row, col, color: this.currentPlayerColor })
    },

    isWinLine(row, col) {
      return this.winLine.some(([r, c]) => r === row && c === col)
    },

    onConfirm() {
      if (!this.lockedPos || this.isSubmitting) return
      this.$emit('confirm')
    },

    onCancelLock() {
      this.$emit('cancelLock')
    }
  }
}
</script>

<style scoped>
.board-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 0;
}
.board { position: relative; }
.board-bg {
  position: absolute; top: 0; left: 0;
  width: 100%; height: 100%; border-radius: 4px; z-index: 0;
}
.grid-line { pointer-events: none; }
.stone { pointer-events: none; transition: opacity 0.2s ease; }
.star-point { pointer-events: none; }
.lock-shadow { pointer-events: none; animation: pulse 1s ease-in-out infinite; }

.opponent-lock { pointer-events: none; opacity: 0.5; }

.turn-overlay {
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(0,0,0,0.06);
  z-index: 6;
  pointer-events: none;
  border-radius: 4px;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.1); opacity: 1; }
}

.board-actions {
  display: flex; justify-content: center; gap: 12px;
  margin-top: 16px; flex-wrap: wrap;
}
.btn {
  min-width: 120px; padding: 10px 24px; border-radius: 6px;
  font-size: 16px; text-align: center; border: none;
  transition: all 0.2s ease;
}
.btn-confirm { background-color: #4CAF50; color: white; }
.btn-confirm:active { background-color: #45a049; }
.btn-confirm[disabled] { background-color: #a5d6a7; }
.btn-cancel { background-color: #f5f5f5; color: #666; border: 1px solid #ddd; }
.btn-cancel:active { background-color: #e0e0e0; }
</style>