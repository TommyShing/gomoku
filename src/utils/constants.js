// 游戏常量定义
// 集中管理所有常量，方便维护和修改

// 棋盘尺寸
export const BOARD_SIZE = 15

// 棋子颜色
export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2

// 游戏状态
export const GAME_IDLE = 'idle'           // 空闲状态
export const GAME_MATCHING = 'matching'   // 匹配中
export const GAME_PLAYING = 'playing'     // 对弈中
export const GAME_OVER = 'over'           // 游戏结束

// 角色
export const ROLE_NONE = 'none'
export const ROLE_BLACK = 'black'         // 黑棋
export const ROLE_WHITE = 'white'         // 白棋

// 棋子颜色 → 角色映射
export const COLOR_TO_ROLE = {
  [BLACK]: ROLE_BLACK,
  [WHITE]: ROLE_WHITE
}

export const ROLE_TO_COLOR = {
  [ROLE_BLACK]: BLACK,
  [ROLE_WHITE]: WHITE
}

// 胜负原因
export const WIN_REASON_FIVE = 'five'           // 五子连珠
export const WIN_REASON_RESIGN = 'resign'       // 对方认输
export const WIN_REASON_TIMEOUT = 'timeout'     // 对方超时
export const WIN_REASON_FORBIDDEN = 'forbidden' // 对方禁手

// WebSocket 消息类型
export const WS_MSG = {
  // 客户端 → 服务器
  C_MATCH: 'c_match',               // 请求匹配
  C_CANCEL_MATCH: 'c_cancel_match', // 取消匹配
  C_CREATE_ROOM: 'c_create_room',   // 创建房间
  C_JOIN_ROOM: 'c_join_room',       // 加入房间
  C_LEAVE_ROOM: 'c_leave_room',     // 离开房间
  C_MOVE: 'c_move',                 // 落子
  C_RESIGN: 'c_resign',             // 认输
  C_PING: 'c_ping',                 // 心跳
  C_PRE_LOCK: 'c_pre_lock',         // 预落子同步
  C_REMATCH: 'c_rematch',           // 再来一局
  C_REMATCH_READY: 'c_rematch_ready', // 准备再来一局

  // 服务器 → 客户端
  S_MATCHED: 's_matched',           // 匹配成功
  S_ROOM_CREATED: 's_room_created', // 房间创建成功
  S_JOINED: 's_joined',             // 加入房间成功
  S_GAME_START: 's_game_start',     // 游戏开始
  S_MOVE: 's_move',                 // 对方落子
  S_PRE_LOCK: 's_pre_lock',         // 对手预落子
  S_GAME_OVER: 's_game_over',       // 游戏结束
  S_ERROR: 's_error',               // 错误
  S_PONG: 's_pong',                 // 心跳回复
  S_OPPONENT_DISCONNECT: 's_opponent_disconnect', // 对方断连
  S_OPPONENT_RECONNECT: 's_opponent_reconnect',   // 对方重连
  S_ROOM_DESTROYED: 's_room_destroyed',           // 房间被销毁
  S_PLAYER_LEFT: 's_player_left',                  // 对方离开房间
  S_REMATCH: 's_rematch',                           // 再来一局
  S_REMATCH_READY: 's_rematch_ready'                // 对方已准备
}

// 超时时间（毫秒）
export const MOVE_TIMEOUT = 30000     // 每步30秒
export const PING_INTERVAL = 10000    // 心跳间隔10秒
export const RECONNECT_TIMEOUT = 15000 // 重连等待15秒

// 禁手类型
export const FORBIDDEN_NONE = 0
export const FORBIDDEN_THREE_THREE = 'three_three'    // 三三禁手
export const FORBIDDEN_FOUR_FOUR = 'four_four'        // 四四禁手
export const FORBIDDEN_OVERLINE = 'overline'          // 长连禁手