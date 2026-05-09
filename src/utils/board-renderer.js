/**
 * 棋盘渲染数据生成器
 *
 * 职责：
 * 1. 生成棋盘网格数据（15×15 交叉点）
 * 2. 计算星位（天元、小目）坐标
 * 3. 管理"锁定位置"阴影标记
 * 4. 生成获胜连线的高亮数据
 *
 * 注意：
 * - 本文件只生成"数据"，不负责实际 DOM 渲染
 * - 实际渲染由 Vue 组件模板完成
 * - 采用 Grid 布局，每个交叉点是一个可点击区域
 *
 * 布局说明：
 * - 每个交叉点占据一个单元格
 * - 棋盘线通过单元格的 border 模拟
 * - 棋子以绝对定位的圆形元素绘制在交叉点中心
 */

import { BOARD_SIZE, EMPTY, BLACK, WHITE } from './constants'

// 棋盘星位（五子棋标准星位）
// 15×15 棋盘有 5 个星位：四个角和天元
const STAR_POINTS = [
  [3, 3], [3, 11],
  [7, 7],
  [11, 3], [11, 11]
]

export class BoardRenderer {
  constructor() {
    this.cellSize = 0      // 每格像素大小（由组件传入）
    this.stoneRadius = 0   // 棋子半径
    this.padding = 0       // 棋盘边距
  }

  /**
   * 初始化渲染参数
   * @param {number} cellSize - 每格大小（px）
   * @param {number} padding - 棋盘边距（px）
   */
  init(cellSize, padding) {
    this.cellSize = cellSize
    this.padding = padding
    this.stoneRadius = cellSize * 0.42 // 棋子半径略小于半格，留出间隙
  }

  /**
   * 获取棋盘点位对应的像素坐标
   * @param {number} row - 行 (0-14)
   * @param {number} col - 列 (0-14)
   * @returns {Object} {x, y} 像素坐标
   */
  getPosition(row, col) {
    return {
      x: this.padding + col * this.cellSize,
      y: this.padding + row * this.cellSize
    }
  }

  /**
   * 从像素坐标反算最近的点位
   * @param {number} x - 像素X坐标
   * @param {number} y - 像素Y坐标
   * @returns {Object|null} {row, col} 或 null（超出范围）
   */
  getPointFromPosition(x, y) {
    const col = Math.round((x - this.padding) / this.cellSize)
    const row = Math.round((y - this.padding) / this.cellSize)

    if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
      return null
    }

    // 检查点击位置是否在交叉点的有效范围内（半格以内）
    const pos = this.getPosition(row, col)
    const dx = Math.abs(x - pos.x)
    const dy = Math.abs(y - pos.y)
    const threshold = this.cellSize * 0.45

    if (dx > threshold || dy > threshold) {
      return null
    }

    return { row, col }
  }

  /**
   * 生成棋盘网格数据
   *
   * 每个单元格包含：
   * - row, col: 坐标
   * - isStar: 是否为星位
   * - edges: 四条边的显示状态 {top, bottom, left, right}
   *   （边缘格子不显示外侧边）
   *
   * @returns {Array} 棋盘网格数据
   */
  generateGrid() {
    const grid = []
    for (let row = 0; row < BOARD_SIZE; row++) {
      const rowData = []
      for (let col = 0; col < BOARD_SIZE; col++) {
        rowData.push({
          row,
          col,
          isStar: this.isStarPoint(row, col),
          edges: {
            top: row > 0,
            bottom: row < BOARD_SIZE - 1,
            left: col > 0,
            right: col < BOARD_SIZE - 1
          }
        })
      }
      grid.push(rowData)
    }
    return grid
  }

  /**
   * 判断是否为星位
   */
  isStarPoint(row, col) {
    return STAR_POINTS.some(([r, c]) => r === row && c === col)
  }

  /**
   * 计算棋盘总尺寸
   */
  getBoardSize() {
    return this.padding * 2 + (BOARD_SIZE - 1) * this.cellSize
  }

  /**
   * 获取棋子样式
   *
   * @param {number} color - 棋子颜色
   * @param {number} row - 行
   * @param {number} col - 列
   * @param {boolean} isLastMove - 是否为最后一步
   * @param {boolean} isHighlight - 是否为获胜连线的一部分
   * @returns {Object} CSS 样式对象
   */
  getStoneStyle(color, row, col, isLastMove = false, isHighlight = false) {
    const pos = this.getPosition(row, col)
    const size = this.stoneRadius * 2

    const style = {
      position: 'absolute',
      left: `${pos.x}px`,
      top: `${pos.y}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: isHighlight ? 3 : 2
    }

    if (color === BLACK) {
      style.backgroundColor = '#1a1a1a'
      style.boxShadow = '2px 2px 4px rgba(0,0,0,0.3)'
      if (isLastMove) {
        style.border = '2px solid #ff4444'
      }
      if (isHighlight) {
        style.boxShadow = '0 0 8px 3px rgba(255,215,0,0.8), 2px 2px 4px rgba(0,0,0,0.3)'
      }
    } else {
      style.backgroundColor = '#ffffff'
      style.boxShadow = '2px 2px 4px rgba(0,0,0,0.2)'
      if (isLastMove) {
        style.border = '2px solid #ff4444'
      }
      if (isHighlight) {
        style.boxShadow = '0 0 8px 3px rgba(255,215,0,0.8), 2px 2px 4px rgba(0,0,0,0.2)'
      }
    }

    return style
  }

  /**
   * 获取锁定位置的阴影样式
   *
   * "锁定位置"的视觉表现：
   * - 在选中的交叉点上显示一个半透明阴影
   * - 阴影形状为圆形，略小于棋子
   * - 如果是当前玩家颜色的棋子，阴影颜色匹配
   *
   * @param {number} row - 行
   * @param {number} col - 列
   * @param {number} color - 当前玩家棋子颜色
   * @returns {Object} CSS 样式
   */
  getLockShadowStyle(row, col, color) {
    const pos = this.getPosition(row, col)
    const shadowSize = this.stoneRadius * 1.8

    return {
      position: 'absolute',
      left: `${pos.x}px`,
      top: `${pos.y}px`,
      width: `${shadowSize}px`,
      height: `${shadowSize}px`,
      borderRadius: '50%',
      transform: 'translate(-50%, -50%)',
      backgroundColor: color === BLACK
        ? 'rgba(0, 0, 0, 0.25)'
        : 'rgba(255, 255, 255, 0.4)',
      border: `2px dashed ${color === BLACK ? '#333' : '#999'}`,
      zIndex: 1,
      animation: 'pulse 1s infinite'
    }
  }

  /**
   * 生成棋盘底纹样式（木纹效果）
   */
  getBoardBackgroundStyle() {
    return {
      backgroundColor: '#dcb35c',
      backgroundImage: `
        linear-gradient(45deg, rgba(0,0,0,0.02) 25%, transparent 25%),
        linear-gradient(-45deg, rgba(0,0,0,0.02) 25%, transparent 25%)
      `,
      backgroundSize: '20px 20px'
    }
  }

  /**
   * 获取星位标记样式
   */
  getStarStyle(row, col) {
    const pos = this.getPosition(row, col)
    const dotSize = this.cellSize * 0.12

    return {
      position: 'absolute',
      left: `${pos.x}px`,
      top: `${pos.y}px`,
      width: `${dotSize}px`,
      height: `${dotSize}px`,
      borderRadius: '50%',
      transform: 'translate(-50%, -50%)',
      backgroundColor: '#1a1a1a',
      zIndex: 1
    }
  }
}

// 导出单例
export const boardRenderer = new BoardRenderer()