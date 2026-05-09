/**
 * 五子棋核心游戏逻辑
 *
 * 职责：
 * 1. 棋盘状态管理
 * 2. 落子合法性校验（含禁手规则）
 * 3. 胜负判断（四方向五子连珠）
 * 4. 禁手检测（三三、四四、长连）
 *
 * 设计思路：
 * - 所有逻辑在本地执行，不依赖服务端
 * - 禁手只针对黑方（标准五子棋规则）
 * - 使用 15×15 二维数组表示棋盘
 */

import {
  BOARD_SIZE, EMPTY, BLACK, WHITE,
  FORBIDDEN_NONE, FORBIDDEN_THREE_THREE, FORBIDDEN_FOUR_FOUR, FORBIDDEN_OVERLINE
} from './constants'

// 四个检测方向：[行偏移, 列偏移]
// 水平、垂直、主对角线（\）、副对角线（/）
const DIRECTIONS = [
  [0, 1],  // 水平 →
  [1, 0],  // 垂直 ↓
  [1, 1],  // 对角线 ↘
  [1, -1]  // 反对角线 ↙
]

export class GameLogic {
  constructor() {
    this.reset()
  }

  /**
   * 重置棋盘到初始状态
   */
  reset() {
    // 15×15 棋盘，0=空, 1=黑, 2=白
    this.board = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => EMPTY)
    )
    this.moveHistory = []     // 落子历史 [{row, col, color}]
    this.currentColor = BLACK // 黑棋先手
    this.moveCount = 0
  }

  /**
   * 获取当前棋盘（深拷贝，防止外部修改）
   */
  getBoard() {
    return this.board.map(row => [...row])
  }

  /**
   * 获取指定位置的棋子颜色
   */
  getStone(row, col) {
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return -1
    return this.board[row][col]
  }

  /**
   * 尝试落子
   *
   * @param {number} row - 行坐标 (0-14)
   * @param {number} col - 列坐标 (0-14)
   * @param {number} color - 棋子颜色 (BLACK=1, WHITE=2)
   * @returns {Object} 落子结果
   *   - success: boolean
   *   - win: boolean (是否获胜)
   *   - forbidden: string|false (禁手类型，仅黑方)
   *   - reason: string (胜负原因)
   */
  placeStone(row, col, color) {
    // 基础校验
    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
      return { success: false, error: '位置超出棋盘范围' }
    }
    if (this.board[row][col] !== EMPTY) {
      return { success: false, error: '该位置已有棋子' }
    }
    if (color !== this.currentColor) {
      return { success: false, error: '不是你的回合' }
    }

    // === 禁手检测（仅黑方） ===
    if (color === BLACK) {
      const forbidden = this.checkForbidden(row, col)
      if (forbidden !== FORBIDDEN_NONE) {
        return {
          success: false,
          forbidden: forbidden,
          error: `禁手！${this.getForbiddenText(forbidden)}`
        }
      }
    }

    // 执行落子
    this.board[row][col] = color
    this.moveHistory.push({ row, col, color })
    this.moveCount++

    // === 胜负检测 ===
    const winResult = this.checkWin(row, col, color)
    if (winResult) {
      this.currentColor = EMPTY // 游戏结束
      return {
        success: true,
        win: true,
        reason: 'five',
        winLine: winResult
      }
    }

    // === 平局检测（棋盘满了） ===
    if (this.moveCount >= BOARD_SIZE * BOARD_SIZE) {
      this.currentColor = EMPTY
      return {
        success: true,
        win: false,
        draw: true,
        reason: '棋盘已满，平局'
      }
    }

    // 切换回合
    this.currentColor = color === BLACK ? WHITE : BLACK

    return { success: true, win: false }
  }

  /**
   * 检查指定位置落子后是否获胜
   * 检测四个方向是否有五子连珠
   *
   * @param {number} row - 落子行
   * @param {number} col - 落子列
   * @param {number} color - 棋子颜色
   * @returns {Array|null} 获胜的五子坐标数组，或 null
   */
  checkWin(row, col, color) {
    for (const [dr, dc] of DIRECTIONS) {
      // 向两个方向延伸
      const line = [[row, col]]

      // 正方向延伸
      for (let i = 1; i < 5; i++) {
        const r = row + dr * i
        const c = col + dc * i
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
        if (this.board[r][c] !== color) break
        line.push([r, c])
      }

      // 反方向延伸
      for (let i = 1; i < 5; i++) {
        const r = row - dr * i
        const c = col - dc * i
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
        if (this.board[r][c] !== color) break
        line.push([r, c])
      }

      // 五子连珠判定
      if (line.length >= 5) {
        return line
      }
    }
    return null
  }

  /**
   * 禁手检测（仅黑方）
   * 在落子前调用，检查该位置是否违反禁手规则
   *
   * 禁手类型：
   * 1. 三三禁手：同时形成两个或以上的活三
   * 2. 四四禁手：同时形成两个或以上的四（活四或冲四）
   * 3. 长连禁手：形成六子或以上的连续连线
   *
   * @param {number} row - 待落子行
   * @param {number} col - 待落子列
   * @returns {string} 禁手类型，无禁手返回 FORBIDDEN_NONE
   */
  checkForbidden(row, col) {
    // 模拟落子
    this.board[row][col] = BLACK

    let forbiddenType = FORBIDDEN_NONE

    // 1. 长连禁手检测
    if (this.checkOverline(row, col)) {
      forbiddenType = FORBIDDEN_OVERLINE
    }

    // 2. 四四禁手检测
    if (forbiddenType === FORBIDDEN_NONE) {
      const fourCount = this.countFours(row, col)
      if (fourCount >= 2) {
        forbiddenType = FORBIDDEN_FOUR_FOUR
      }
    }

    // 3. 三三禁手检测
    if (forbiddenType === FORBIDDEN_NONE) {
      const liveThreeCount = this.countLiveThrees(row, col)
      if (liveThreeCount >= 2) {
        forbiddenType = FORBIDDEN_THREE_THREE
      }
    }

    // 撤销模拟落子
    this.board[row][col] = EMPTY

    return forbiddenType
  }

  /**
   * 检查长连禁手（六子或以上连续）
   */
  checkOverline(row, col) {
    for (const [dr, dc] of DIRECTIONS) {
      let count = 1
      // 正方向
      for (let i = 1; i < BOARD_SIZE; i++) {
        const r = row + dr * i
        const c = col + dc * i
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
        if (this.board[r][c] !== BLACK) break
        count++
      }
      // 反方向
      for (let i = 1; i < BOARD_SIZE; i++) {
        const r = row - dr * i
        const c = col - dc * i
        if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
        if (this.board[r][c] !== BLACK) break
        count++
      }
      if (count >= 6) return true
    }
    return false
  }

  /**
   * 统计落子后形成的"四"的数量（用于四四禁手检测）
   *
   * "四"的定义：在某个方向上，当前棋子加入后，
   * 存在恰好一个空位可以补成五子连珠。
   * 包括活四（两端开放）和冲四（一端受阻）。
   */
  countFours(row, col) {
    let count = 0
    for (const [dr, dc] of DIRECTIONS) {
      if (this.isFour(row, col, dr, dc)) {
        count++
      }
    }
    return count
  }

  /**
   * 判断某个方向是否形成"四"
   *
   * 方法：在指定方向上，检查是否存在一个空位，
   * 在该空位补上黑棋后能形成五子连珠。
   * 如果恰好有一个这样的空位，就是"四"。
   */
  isFour(row, col, dr, dc) {
    // 收集该方向上的所有棋子（含当前模拟的落子）
    const stones = [[row, col]]

    // 正方向收集
    for (let i = 1; i < 5; i++) {
      const r = row + dr * i
      const c = col + dc * i
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
      if (this.board[r][c] === WHITE) break
      stones.push([r, c])
    }

    // 反方向收集
    for (let i = 1; i < 5; i++) {
      const r = row - dr * i
      const c = col - dc * i
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
      if (this.board[r][c] === WHITE) break
      stones.push([r, c])
    }

    // 如果总长度小于4，不可能形成"四"
    if (stones.length < 4) return false

    // 检查每个空位：补上黑棋能否形成五子连珠
    let fivePositions = 0
    for (const [sr, sc] of stones) {
      if (this.board[sr][sc] === EMPTY) {
        this.board[sr][sc] = BLACK
        // 检查这个方向是否有五子
        if (this.checkDirectionLine(sr, sc, dr, dc, BLACK) >= 5) {
          fivePositions++
        }
        this.board[sr][sc] = EMPTY
      }
    }

    // "四"意味着恰好有一个空位可以补成五子
    return fivePositions === 1
  }

  /**
   * 统计落子后形成的"活三"的数量（用于三三禁手检测）
   *
   * "活三"的定义：
   * 1. 该方向上有恰好3颗黑棋（含当前落子）
   * 2. 两端都是空的（没有被白棋或边界阻挡）
   * 3. 在空端落子后能形成活四（而非冲四）
   */
  countLiveThrees(row, col) {
    let count = 0
    for (const [dr, dc] of DIRECTIONS) {
      if (this.isLiveThree(row, col, dr, dc)) {
        count++
      }
    }
    return count
  }

  /**
   * 判断某个方向是否形成"活三"
   */
  isLiveThree(row, col, dr, dc) {
    // 收集该方向上的棋子序列（遇到白棋或边界停止）
    const line = []

    // 先收集反方向
    const reverse = []
    for (let i = 1; i < 5; i++) {
      const r = row - dr * i
      const c = col - dc * i
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
      if (this.board[r][c] === WHITE) break
      reverse.unshift([r, c, this.board[r][c]])
    }

    // 当前棋子
    line.push(...reverse)
    line.push([row, col, BLACK])

    // 正方向
    for (let i = 1; i < 5; i++) {
      const r = row + dr * i
      const c = col + dc * i
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
      if (this.board[r][c] === WHITE) break
      line.push([r, c, this.board[r][c]])
    }

    // 统计黑棋数量
    const blackCount = line.filter(([,,color]) => color === BLACK).length
    if (blackCount !== 3) return false

    // 检查两端是否开放（空位）
    const first = line[0]
    const last = line[line.length - 1]

    // 两端必须是空的
    if (first[2] !== EMPTY || last[2] !== EMPTY) return false

    // 检查两端是否在棋盘内
    const firstRow = first[0], firstCol = first[1]
    const lastRow = last[0], lastCol = last[1]

    // 两端再往外一格必须是空位（活三需要两端开放）
    const beforeFirstRow = firstRow - dr
    const beforeFirstCol = firstCol - dc
    const afterLastRow = lastRow + dr
    const afterLastCol = lastCol + dc

    // 检查两端是否在棋盘内且为空
    const firstOpen = beforeFirstRow >= 0 && beforeFirstRow < BOARD_SIZE &&
                      beforeFirstCol >= 0 && beforeFirstCol < BOARD_SIZE &&
                      this.board[beforeFirstRow][beforeFirstCol] !== WHITE
    const lastOpen = afterLastRow >= 0 && afterLastRow < BOARD_SIZE &&
                     afterLastCol >= 0 && afterLastCol < BOARD_SIZE &&
                     this.board[afterLastRow][afterLastCol] !== WHITE

    if (!firstOpen || !lastOpen) return false

    // 关键检查：在任一端落子后能否形成活四（而非冲四）
    // 活四意味着两端都开放
    let canMakeLiveFour = false

    // 在 first 端落子
    this.board[firstRow][firstCol] = BLACK
    if (this.isLiveFour(row, col, dr, dc)) {
      canMakeLiveFour = true
    }
    this.board[firstRow][firstCol] = EMPTY

    // 在 last 端落子
    if (!canMakeLiveFour) {
      this.board[lastRow][lastCol] = BLACK
      if (this.isLiveFour(row, col, dr, dc)) {
        canMakeLiveFour = true
      }
      this.board[lastRow][lastCol] = EMPTY
    }

    return canMakeLiveFour
  }

  /**
   * 判断当前方向是否形成活四
   * 活四：四子连线，两端开放
   */
  isLiveFour(row, col, dr, dc) {
    // 收集该方向上的棋子序列
    const line = []

    // 反方向
    const reverse = []
    for (let i = 1; i < 6; i++) {
      const r = row - dr * i
      const c = col - dc * i
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
      if (this.board[r][c] === WHITE) break
      reverse.unshift([r, c, this.board[r][c]])
    }

    line.push(...reverse)
    line.push([row, col, this.board[row][col]])

    // 正方向
    for (let i = 1; i < 6; i++) {
      const r = row + dr * i
      const c = col + dc * i
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
      if (this.board[r][c] === WHITE) break
      line.push([r, c, this.board[r][c]])
    }

    // 统计黑棋数量
    const blackCount = line.filter(([,,color]) => color === BLACK).length
    if (blackCount !== 4) return false

    // 检查两端是否开放
    const first = line[0]
    const last = line[line.length - 1]

    return first[2] === EMPTY && last[2] === EMPTY
  }

  /**
   * 检查某个方向上的连续同色棋子数量
   */
  checkDirectionLine(row, col, dr, dc, color) {
    let count = 1
    // 正方向
    for (let i = 1; i < BOARD_SIZE; i++) {
      const r = row + dr * i
      const c = col + dc * i
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
      if (this.board[r][c] !== color) break
      count++
    }
    // 反方向
    for (let i = 1; i < BOARD_SIZE; i++) {
      const r = row - dr * i
      const c = col - dc * i
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break
      if (this.board[r][c] !== color) break
      count++
    }
    return count
  }

  /**
   * 检查棋盘上是否还有空位
   */
  hasEmptyPositions() {
    return this.moveCount < BOARD_SIZE * BOARD_SIZE
  }

  /**
   * 获取禁手的中文描述
   */
  getForbiddenText(type) {
    const map = {
      [FORBIDDEN_THREE_THREE]: '三三禁手',
      [FORBIDDEN_FOUR_FOUR]: '四四禁手',
      [FORBIDDEN_OVERLINE]: '长连禁手'
    }
    return map[type] || '未知禁手'
  }

  /**
   * 从历史记录恢复棋盘状态
   */
  loadFromHistory(history) {
    this.reset()
    for (const move of history) {
      this.board[move.row][move.col] = move.color
      this.moveHistory.push({ ...move })
      this.moveCount++
    }
    // 设置当前应下棋的颜色
    this.currentColor = this.moveCount % 2 === 0 ? BLACK : WHITE
  }

  /**
   * 获取当前应下棋的颜色
   */
  getCurrentColor() {
    return this.currentColor
  }
}
