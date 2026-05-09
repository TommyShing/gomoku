<template>
  <!--
    房间/匹配面板组件 - room-panel.vue

    职责：
    1. 连接/断开 WebSocket
    2. 随机匹配（进入队列）
    3. 创建房间（指定联机）
    4. 加入房间（输入房间号）
    5. 显示连接状态
  -->
  <view class="room-panel">
    <!-- 连接状态 -->
    <view class="connection-status" :class="connected ? 'connected' : 'disconnected'">
      <text class="status-dot"></text>
      <text class="status-label">{{ connected ? '已连接' : '未连接' }}</text>
    </view>

    <!-- 未连接时显示连接按钮 -->
    <view class="section" v-if="!connected">
      <button class="btn btn-connect" @tap="onConnect" :disabled="connecting">
        {{ connecting ? '连接中...' : '连接服务器' }}
      </button>
    </view>

    <!-- 已连接时显示匹配/房间选项 -->
    <template v-if="connected">
      <!-- 随机匹配 -->
      <view class="section">
        <view class="section-title">快速匹配</view>
        <text class="section-desc">系统自动匹配在线玩家</text>
        <button
          v-if="!isMatching"
          class="btn btn-primary"
          @tap="onStartMatch"
        >
          开始匹配
        </button>
        <button
          v-else
          class="btn btn-danger"
          @tap="onCancelMatch"
        >
          取消匹配 ({{ matchTimer }}s)
        </button>
      </view>

      <!-- 分割线 -->
      <view class="divider">
        <text class="divider-text">或</text>
      </view>

      <!-- 创建房间 -->
      <view class="section">
        <view class="section-title">创建房间</view>
        <text class="section-desc">创建私人房间，邀请好友对战</text>
        <button class="btn btn-secondary" @tap="onCreateRoom" :disabled="isCreating">
          {{ isCreating ? '创建中...' : '创建房间' }}
        </button>
        <!-- 创建成功后显示房间号 -->
        <view class="room-code-box" v-if="roomCode">
          <text class="room-code-label">房间号</text>
          <text class="room-code-value">{{ roomCode }}</text>
          <text class="room-code-hint">将房间号发送给好友</text>
          <button class="btn btn-small" @tap="onCopyRoomCode">复制房间号</button>
        </view>
      </view>

      <!-- 加入房间 -->
      <view class="section">
        <view class="section-title">加入房间</view>
        <text class="section-desc">输入好友的房间号</text>
        <view class="input-row">
          <input
            class="room-input"
            type="text"
            maxlength="6"
            placeholder="输入6位房间号"
            v-model="joinRoomCode"
            :disabled="isJoining"
          />
          <button
            class="btn btn-secondary btn-join"
            @tap="onJoinRoom"
            :disabled="isJoining || !joinRoomCode.trim()"
          >
            {{ isJoining ? '加入中...' : '加入' }}
          </button>
        </view>
      </view>
    </template>

    <!-- 错误提示 -->
    <view class="error-msg" v-if="errorMsg">
      <text class="error-text">{{ errorMsg }}</text>
    </view>
  </view>
</template>

<script>
/**
 * 房间/匹配面板组件
 *
 * Props:
 * - connected: WebSocket 是否已连接
 * - connecting: 是否正在连接
 * - isMatching: 是否正在匹配
 * - matchTimer: 匹配计时（秒）
 * - roomCode: 创建房间后得到的房间号
 * - isCreating: 是否正在创建房间
 * - isJoining: 是否正在加入房间
 * - errorMsg: 错误信息
 *
 * Events:
 * - connect: 连接服务器事件
 * - startMatch: 开始匹配事件
 * - cancelMatch: 取消匹配事件
 * - createRoom: 创建房间事件
 * - joinRoom: 加入房间事件，携带 { roomCode: string }
 */
export default {
  name: 'RoomPanel',
  props: {
    connected: {
      type: Boolean,
      default: false
    },
    connecting: {
      type: Boolean,
      default: false
    },
    isMatching: {
      type: Boolean,
      default: false
    },
    matchTimer: {
      type: Number,
      default: 0
    },
    roomCode: {
      type: String,
      default: ''
    },
    isCreating: {
      type: Boolean,
      default: false
    },
    isJoining: {
      type: Boolean,
      default: false
    },
    errorMsg: {
      type: String,
      default: ''
    }
  },
  emits: ['connect', 'startMatch', 'cancelMatch', 'createRoom', 'joinRoom'],
  data() {
    return {
      joinRoomCode: ''
    }
  },
  watch: {
    /**
     * 游戏开始时清空房间号输入
     */
    connected(val) {
      if (val) {
        // 连接后不做特殊处理
      }
    }
  },
  methods: {
    onConnect() {
      this.$emit('connect')
    },

    onStartMatch() {
      this.$emit('startMatch')
    },

    onCancelMatch() {
      this.$emit('cancelMatch')
    },

    onCreateRoom() {
      this.$emit('createRoom')
    },

    onJoinRoom() {
      const code = this.joinRoomCode.trim().toUpperCase()
      if (!code) return
      this.$emit('joinRoom', { roomCode: code })
    },

    /**
     * 复制房间号到剪贴板
     */
    onCopyRoomCode() {
      uni.setClipboardData({
        data: this.roomCode,
        success: () => {
          uni.showToast({
            title: '已复制房间号',
            icon: 'success',
            duration: 1500
          })
        }
      })
    }
  }
}
</script>

<style scoped>
.room-panel {
  background-color: #fff;
  border-radius: 8px;
  margin: 8px 12px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

/* 连接状态 */
.connection-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 13px;
}

.connection-status.connected {
  background-color: #e8f5e9;
  color: #2e7d32;
}

.connection-status.disconnected {
  background-color: #fce4ec;
  color: #c62828;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.connected .status-dot {
  background-color: #4caf50;
}

.disconnected .status-dot {
  background-color: #f44336;
}

.status-label {
  font-size: 13px;
}

/* 分区 */
.section {
  margin-bottom: 12px;
}

.section-title {
  font-size: 15px;
  font-weight: bold;
  color: #333;
  margin-bottom: 2px;
}

.section-desc {
  font-size: 12px;
  color: #999;
  margin-bottom: 8px;
  display: block;
}

/* 分割线 */
.divider {
  display: flex;
  align-items: center;
  margin: 12px 0;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background-color: #e0e0e0;
}

.divider-text {
  padding: 0 12px;
  font-size: 12px;
  color: #ccc;
}

/* 按钮 */
.btn {
  width: 100%;
  padding: 10px 0;
  border-radius: 6px;
  font-size: 15px;
  text-align: center;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn:active {
  opacity: 0.8;
}

.btn[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background-color: #4CAF50;
  color: white;
}

.btn-secondary {
  background-color: #2196F3;
  color: white;
}

.btn-danger {
  background-color: #f44336;
  color: white;
}

.btn-connect {
  background-color: #ff9800;
  color: white;
}

.btn-small {
  width: auto;
  padding: 6px 16px;
  font-size: 13px;
  background-color: #e0e0e0;
  color: #333;
  border-radius: 4px;
  margin-top: 6px;
}

.btn-join {
  width: auto;
  padding: 8px 20px;
  font-size: 14px;
}

/* 房间号展示 */
.room-code-box {
  margin-top: 10px;
  padding: 12px;
  background-color: #f5f5f5;
  border-radius: 6px;
  text-align: center;
}

.room-code-label {
  font-size: 12px;
  color: #999;
  display: block;
  margin-bottom: 4px;
}

.room-code-value {
  font-size: 28px;
  font-weight: bold;
  color: #333;
  letter-spacing: 4px;
  display: block;
  margin-bottom: 4px;
}

.room-code-hint {
  font-size: 12px;
  color: #999;
  display: block;
}

/* 输入框 */
.input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.room-input {
  flex: 1;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 16px;
  text-align: center;
  letter-spacing: 2px;
  height: 36px;
  background-color: #fff;
}

.room-input:focus {
  border-color: #2196F3;
  outline: none;
}

/* 错误提示 */
.error-msg {
  margin-top: 8px;
  padding: 8px 12px;
  background-color: #fff3e0;
  border-radius: 4px;
  text-align: center;
}

.error-text {
  font-size: 13px;
  color: #e65100;
}
</style>