/**
 * WebSocket 信令服务（原生 WebSocket 实现）
 */
import type { ChatMessage, RaiseHandRequest, Quiz } from '@/store/liveStore'
import { getMicroAppData } from './microApp'

export interface SignalEvents {
  // 连接事件
  connect: () => void
  disconnect: () => void
  error: (error: Error | { message: string }) => void

  // 后端定义的事件（接收）
  'onStartVote': (data: { id: number; jsonStr: string }) => void  // 收到发起投票事件（学生端监听）
  'onRejectVote': (data: { id: number; jsonStr: string }) => void  // 收到学生投票信息（教师端监听）
  'onHandUp': (data: { id: number; jsonStr: string }) => void  // 收到学生举手信息
  'onUserJoinClassroom': (data: { id: number; jsonStr: string; userId: number; totalNum: number }) => void  // 有用户加入房间
  'onUserLeaveClassroom': (data: { id: number; jsonStr: string; userId: number; totalNum: number }) => void  // 有用户离开房间
  'onFinishClass': (data: { id: number }) => void  // 收到下课命令
  'onTaskStart': (data: { id: number; itemId: number; jsonStr: string }) => void  // 收到随堂练习消息（学生）
  'onClassroomMsg': (data: { id: number; jsonStr: string }) => void  // 收到发言/发言设置
  'onMediaOffer': (data: { id: number; jsonStr: string }) => void  // 收到媒体 Offer（学生端）
  'onMediaAnswer': (data: { id: number; jsonStr: string }) => void  // 收到媒体 Answer（学生端）
  'onMediaIceCandidate': (data: { id: number; jsonStr: string }) => void  // 收到媒体 ICE Candidate（学生端）

  // 聊天事件
  'chatMessage': (data: ChatMessage) => void
  'chatModeChanged': (data: { mode: 'all' | 'teacher' | 'muted' }) => void

  // 举手事件
  'raiseHandRequest': (data: RaiseHandRequest) => void
  'raiseHandCancel': (data: { userId: string }) => void
  'raiseHandAllowed': (data: { userId: string }) => void

  // 互动题事件
  'quizCreated': (data: Quiz) => void
  'quizAnswer': (data: { userId: string; quizId: string; answer: string | string[] }) => void
  'quizFinished': (data: { quizId: string; statistics: any }) => void

  // 文档事件
  'documentSwitched': (data: { documentId: string; document?: any }) => void
  'documentAdded': (data: { document: any }) => void

  // 白板事件
  'whiteboardDraw': (data: { action: string; data: any }) => void
  'whiteboardClear': () => void
  'whiteboardEnabled': (data: { enabled: boolean }) => void
  'whiteboardSyncState': (data: { canvasState: any }) => void

  // 屏幕共享事件
  'screenStart': (data: { userId: string }) => void
  'screenStop': (data: { userId: string }) => void
  'onScreenSharing': (data: { id: number; jsonStr: string }) => void  // 后端屏幕共享事件（学生端监听）

  // 直播状态事件
  'liveStarted': (data: { startTime: number }) => void
  'liveStopped': () => void
}

// WebSocket 消息格式（根据后端文档）
interface WebSocketMessage {
  event: string  // 后端使用 event 字段
  data: any
  message?: string  // 错误消息
}

export class SignalService {
  private socket: WebSocket | null = null
  private classroomId: number = 0  // 课堂ID（统一使用数字类型，后端使用，来源于微前端主应用传递的 roomId）
  private userId: string = ''
  private wsUrl: string = ''
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 5
  private reconnectDelay: number = 1000
  private reconnectTimer: number | null = null
  private eventListeners: Map<string, Set<Function>> = new Map()
  private pendingMessages: WebSocketMessage[] = []
  private isManualClose: boolean = false
  private joinRoomParams: { roomId: string | number; userId: string | number; userInfo?: any } | null = null  // 保存 joinRoom 参数，用于重连后自动重新加入
  
  // ICE candidate 批量发送相关
  private iceCandidateQueue: Array<{ to: string; candidate: RTCIceCandidateInit; streamType: 'camera' | 'screen' }> = []
  private iceCandidateFlushTimer: number | null = null
  private readonly ICE_CANDIDATE_BATCH_DELAY = 20 // 批量发送延迟（毫秒）- 极短延迟，快速批量发送
  private readonly MAX_CANDIDATES_PER_BATCH = 5 // 每批最多发送的 candidates 数量 - 非常小的批次
  private readonly MIN_CANDIDATES_TO_BATCH = 2 // 最少 candidates 数量才批量发送
  
  // 暴露 socket 以便检查连接状态（保持 API 兼容性）
  get socketInstance() {
    return this.socket
  }
  
  get isConnected() {
    return this.socket?.readyState === WebSocket.OPEN
  }
  
  // 暴露 classroomId 以便组件访问
  get currentClassroomId() {
    return this.classroomId
  }

  constructor(serverUrl?: string) {
    // 构建 WebSocket URL
    const microAppData = getMicroAppData()
    
    if (!serverUrl) {
      // 优先从 micro-app 主应用传递的数据获取
      if (microAppData?.wsConfig) {
        // 新方式：通过 wsConfig 配置构建 URL
        const wsConfig = microAppData.wsConfig
        const { basePath, userId, roomId, token, proxyUrl } = wsConfig
        // classroomId 来源于微前端主应用传递的 roomId
        if(roomId){
          this.classroomId = typeof roomId === 'string' ? parseInt(roomId) : roomId
          console.log('[SignalService] 从微前端主应用获取 classroomId:', this.classroomId)
        }
        if(userId){
          this.userId = userId
        }
        if (basePath && userId && token) {
          // 构建完整的 WebSocket URL: ws://{host}{basePath}/ws/webSocket/{userId}?Authorization={token}
          const protocol = window.location.protocol === 'https:' ? 'ws:' : 'ws:'
          
          // 如果提供了 proxyUrl（主应用的代理地址），提取其路径作为 basePath
          // 否则使用当前页面的 host（子应用本地，通过 Vite 代理转发）
          let finalBasePath = basePath
          let finalHost = window.location.host // 默认使用当前页面 host（子应用）
          
          if (proxyUrl) {
            // 如果主应用传递了代理地址（如 http://localhost:8086）
            // 提取路径部分作为 basePath，host 使用当前页面（子应用）的 host
            try {
              const proxyUrlObj = new URL(proxyUrl)
              // 使用主应用传递的路径作为 basePath
              finalBasePath = proxyUrlObj.pathname || basePath
              // 但 host 使用当前页面（子应用）的 host，因为代理在子应用本地配置
              console.log('[SignalService] 主应用传递代理地址:', proxyUrl, '提取路径:', finalBasePath)
            } catch (e) {
              console.warn('[SignalService] 解析代理地址失败，使用原始 basePath:', e)
            }
          }
          
          const encodedToken = encodeURIComponent(token)
          
          // 如果 basePath 以 / 开头，直接使用；否则添加 /
          const normalizedBasePath = finalBasePath.startsWith('/') ? finalBasePath : `/${finalBasePath}`
          // 确保 basePath 不以 / 结尾（除非是根路径）
          const cleanBasePath = normalizedBasePath === '/' ? '' : normalizedBasePath.replace(/\/$/, '')
          
          serverUrl = `${protocol}//${finalHost}${cleanBasePath}/ws/webSocket/${userId}?Authorization=${encodedToken}`
          
          console.log('[SignalService] 从 micro-app 主应用获取 wsConfig，构建 WebSocket URL:', serverUrl)
          console.log('[SignalService] wsConfig 详情:', { 
            basePath, 
            proxyUrl,
            finalBasePath: cleanBasePath,
            finalHost,
            userId, 
            token: token.substring(0, 20) + '...' 
          })
        }
      } else if (microAppData?.wsUrl) {
        // 兼容旧方式：直接传递完整 wsUrl
        // 如果传递的是 HTTP URL，需要转换为 WebSocket URL 并使用当前页面 host
        let wsUrl = microAppData.wsUrl
        
        // 如果传递的是主应用的代理地址（如 http://localhost:8086），需要提取路径
        if (wsUrl.startsWith('http://') || wsUrl.startsWith('https://')) {
          try {
            const urlObj = new URL(wsUrl)
            // 提取路径，但使用当前页面（子应用）的 host
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
            const host = window.location.host
            const path = urlObj.pathname || ''
            
            // 如果路径为空，说明是根路径，可能需要添加默认路径
            wsUrl = `${protocol}//${host}${path}`
            console.log('[SignalService] 从主应用代理地址提取路径，使用子应用 host:', wsUrl)
          } catch (error) {
            // 如果解析失败，直接转换协议
            wsUrl = wsUrl.replace(/^http/, 'ws')
            console.warn('[SignalService] 解析代理地址失败，直接转换协议:', wsUrl, error)
          }
        }
        
        serverUrl = wsUrl
        console.log('[SignalService] 从 micro-app 主应用获取 WebSocket 地址（旧方式）:', serverUrl)
      } 
      // 其次从环境变量获取
      else if (import.meta.env.VITE_WS_URL) {
        serverUrl = import.meta.env.VITE_WS_URL
        // 如果环境变量是 HTTP URL，转换为 WebSocket URL
        if (serverUrl.startsWith('http://')) {
          serverUrl = serverUrl.replace('http://', 'ws://')
        } else if (serverUrl.startsWith('https://')) {
          serverUrl = serverUrl.replace('https://', 'wss://')
        }
        console.log('[SignalService] 从环境变量获取 WebSocket 地址:', serverUrl)
      }
      // 最后使用默认值（开发环境）
      else {
        const hostname = window.location.hostname
        const port = 3001
        
        const finalHostname = (hostname === 'localhost' || hostname === '127.0.0.1') 
          ? 'localhost' 
          : hostname
        
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        serverUrl = `${protocol}//${finalHostname}:${port}`
        console.log('[SignalService] 使用默认 WebSocket 地址（开发环境）:', serverUrl)
      }
    }
    
    if (!serverUrl) {
      throw new Error('无法确定 WebSocket 服务器地址')
    }
    
    this.wsUrl = serverUrl
    console.log('[SignalService] ========== WebSocket 连接信息 ==========')
    console.log('[SignalService] WebSocket 服务器地址:', this.wsUrl)
    console.log('[SignalService] 当前页面地址:', window.location.href)
    console.log('[SignalService] 当前页面 host:', window.location.host)
    console.log('[SignalService] 当前页面协议:', window.location.protocol)
    console.log('[SignalService] 是否匹配 /dev-api 路径:', this.wsUrl.includes('/dev-api'))
    console.log('[SignalService] =========================================')
    
    // 建立连接
    this.connect()
  }

  /**
   * 建立 WebSocket 连接
   */
  private connect() {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
      console.log('[SignalService] WebSocket 已连接或正在连接中')
      return
    }

    try {
      console.log('[SignalService] 正在连接 WebSocket:', this.wsUrl)
      this.socket = new WebSocket(this.wsUrl)
      this.setupEventListeners()
    } catch (error) {
      console.error('[SignalService] 创建 WebSocket 连接失败:', error)
      this.emit('error', error as Error)
      this.scheduleReconnect()
    }
  }

  /**
   * 设置 WebSocket 事件监听器
   */
  private setupEventListeners() {
    if (!this.socket) return

    this.socket.onopen = () => {
      console.log('[SignalService] WebSocket 连接成功')
      this.reconnectAttempts = 0
      this.isManualClose = false
      
      // 发送待发送的消息
      this.flushPendingMessages()
      
      // 如果之前已经加入过房间，自动重新加入（重连场景）
      if (this.joinRoomParams) {
        console.log('[SignalService] 检测到之前已加入房间，重连后自动重新加入:', this.joinRoomParams)
        const { roomId, userInfo } = this.joinRoomParams
        // 重新设置 classroomId
        this.classroomId = typeof roomId === 'string' ? parseInt(roomId) : roomId
        // 使用 sendJoinClassroom 直接发送，因为此时 socket 已经连接
        this.sendJoinClassroom(userInfo)
      }
      
      // 触发 connect 事件
      this.emit('connect')
    }

    this.socket.onclose = (event) => {
      console.log('[SignalService] WebSocket 断开连接', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      })
      
      this.emit('disconnect')
      
      // 如果不是手动关闭，尝试重连
      if (!this.isManualClose && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect()
      }
    }

    this.socket.onerror = (event) => {
      console.error('[SignalService] WebSocket 错误:', event)
      const error = new Error('WebSocket connection error')
      this.emit('error', error)
    }

    this.socket.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data)
        console.log('[SignalService] 📥 收到消息:', message.event, message.data)
        
        // 处理错误消息
        if (message.event === 'error') {
          const errorMsg = message.message || '未知错误'
          console.error('[SignalService] 服务器返回错误:', errorMsg)
          this.emit('error', { message: errorMsg })
          return
        }
        
        // 统一处理消息数据：后端只有 data.jsonStr 格式
        let finalEventData = message.data
        if (message.data && typeof message.data === 'object' && 'jsonStr' in message.data && message.data.jsonStr) {
          try {
            // 从 jsonStr 中解析数据
            const parsedData = JSON.parse(message.data.jsonStr)
            // 保留 id 字段（房间号），合并解析后的数据
            finalEventData = {
              id: message.data.id,
              totalNum: message.data.totalNum,
              userId: message.data.userId,
              jsonStr: message.data.jsonStr, // 保留原始 jsonStr，供后续使用
              ...parsedData
            }
            console.log('[SignalService] ✅ 已从 jsonStr 解析数据:', {
              event: message.event,
              finalEventData,
              parsedKeys: Object.keys(parsedData)
            })
            
            // 特别处理白板绘制事件：确保 action 和 data 字段正确传递
            if (message.event === 'onWhiteboardDraw' || message.event === 'whiteboardDraw') {
              console.log('[SignalService] 📝 白板绘制事件数据解析:', {
                originalEvent: message.event,
                hasAction: !!finalEventData.action,
                hasData: !!finalEventData.data,
                action: finalEventData.action,
                dataType: typeof finalEventData.data,
                dataKeys: finalEventData.data ? Object.keys(finalEventData.data) : [],
                fullData: finalEventData
              })
              
              // 确保数据格式正确：如果 action 和 data 在顶层，直接使用
              // 如果数据格式不正确，尝试修复
              if (!finalEventData.action && finalEventData.data && typeof finalEventData.data === 'object') {
                // 可能数据嵌套在 data 字段中
                if (finalEventData.data.action) {
                  finalEventData.action = finalEventData.data.action
                  finalEventData.data = finalEventData.data.data || finalEventData.data
                }
              }
            }
            
            // 特别处理白板状态变化事件
            if (message.event === 'onWhiteboardEnabled' || message.event === 'onWhiteboardToggle' || message.event === 'whiteboardToggle') {
              console.log('[SignalService] 📝 白板状态变化事件数据解析:', {
                originalEvent: message.event,
                enabled: finalEventData.enabled,
                hasEnabled: 'enabled' in finalEventData,
                fullData: finalEventData,
                parsedKeys: Object.keys(finalEventData)
              })
              
              // 确保 enabled 字段存在
              if (!('enabled' in finalEventData) && finalEventData.data && typeof finalEventData.data === 'object') {
                if ('enabled' in finalEventData.data) {
                  finalEventData.enabled = finalEventData.data.enabled
                  console.log('[SignalService] ✅ 从 data 字段提取 enabled:', finalEventData.enabled)
                }
              }
            }
          } catch (parseError) {
            console.warn('[SignalService] ⚠️ 解析 jsonStr 失败，使用原始数据:', parseError, {
              event: message.event,
              jsonStr: message.data.jsonStr
            })
            // 如果解析失败，使用原始数据
            finalEventData = message.data
          }
        }
        
        // 事件名称映射：将后端事件名映射到前端事件名
        let mappedEvent = message.event
        const eventMap: Record<string, string> = {
          'lesson': 'liveStarted',           // 后端开启直播事件
          'finishClass': 'liveStopped',       // 后端下播事件
          'screen:start': 'screenStart',
          'screen:stop': 'screenStop',
          'screenSharing': 'onScreenSharing',  // 后端屏幕共享事件
          // 兼容后端可能直接转发 mediaOffer/mediaAnswer/mediaIceCandidate 的情况
          'mediaOffer': 'onMediaOffer',
          'mediaAnswer': 'onMediaAnswer',
          'mediaIceCandidate': 'onMediaIceCandidate',
          // 白板事件映射
          'onWhiteboardDraw': 'whiteboardDraw',  // 后端白板绘制事件
          'onWhiteboardClear': 'whiteboardClear',  // 后端白板清除事件
          'onWhiteboardEnabled': 'whiteboardEnabled',  // 后端白板状态变化事件
          'onWhiteboardToggle': 'whiteboardEnabled',  // 后端可能转发为 onWhiteboardToggle
          'whiteboardToggle': 'whiteboardEnabled'  // 兼容教师端发送的 whiteboardToggle 事件
        }
        if (eventMap[message.event]) {
          mappedEvent = eventMap[message.event]
          console.log('[SignalService] 🔄 事件名称映射:', message.event, '->', mappedEvent)
        }
        
        // 特别处理 onClassroomMsg 事件：如果是聊天消息，转换为 chatMessage 事件
        if (message.event === 'onClassroomMsg' && finalEventData) {
          try {
            console.log('[SignalService] 📨 收到 onClassroomMsg 事件，开始处理:', {
              event: message.event,
              finalEventData,
              hasType: !!finalEventData.type,
              hasMessageType: !!finalEventData.messageType,
              hasContent: !!finalEventData.content,
              hasAction: !!finalEventData.action,
              type: finalEventData.type,
              messageType: finalEventData.messageType,
              content: finalEventData.content,
              action: finalEventData.action
            })
            
            // 检查消息类型是否为聊天消息
            const msgType = finalEventData.type || finalEventData.messageType
            // 只有当类型明确为 'chat' 或者有 content 字段且没有其他 action 时才认为是聊天消息
            if (msgType === 'chat' || (finalEventData.content && !finalEventData.action && !finalEventData.quizId)) {
              // 解析聊天消息数据
              // 使用时间戳和用户ID生成唯一消息ID，避免使用房间ID
              const messageId = finalEventData.timestamp 
                ? `${finalEventData.userId}-${finalEventData.timestamp}` 
                : `${finalEventData.userId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
              
              const chatMessage: ChatMessage = {
                id: messageId,
                userId: finalEventData.userId?.toString() || '',
                userName: finalEventData.userName || (finalEventData.isTeacher ? '老师' : '学生'),
                content: finalEventData.content || '',
                type: (finalEventData.messageType || finalEventData.type || 'text') as 'text' | 'image' | 'question',
                isTeacher: finalEventData.isTeacher || false,
                avatar: finalEventData.avatar || '',
                timestamp: finalEventData.timestamp || Date.now()
              }
              
              console.log('[SignalService] 💬 检测到聊天消息，转换为 chatMessage 事件:', chatMessage)
              console.log('[SignalService] 📊 chatMessage 事件监听器状态:', {
                hasListeners: this.eventListeners.has('chatMessage'),
                listenersCount: this.eventListeners.get('chatMessage')?.size || 0,
                allListeners: Array.from(this.eventListeners.keys())
              })
              
              // 触发 chatMessage 事件
              this.emit('chatMessage', chatMessage)
              console.log('[SignalService] ✅ chatMessage 事件已触发')
              
              // 继续触发 onClassroomMsg 事件（供其他用途使用，如聊天模式变化等）
              this.emit('onClassroomMsg', finalEventData)
              return
            } else if (finalEventData.action === 'chatModeChange') {
              // 处理聊天模式变化
              console.log('[SignalService] 🔄 检测到聊天模式变化:', finalEventData.mode)
              this.emit('chatModeChanged', { mode: finalEventData.mode })
              
              // 继续触发 onClassroomMsg 事件
              this.emit('onClassroomMsg', finalEventData)
              return
            } else {
              console.log('[SignalService] ⚠️ onClassroomMsg 不是聊天消息，跳过处理:', {
                msgType,
                hasContent: !!finalEventData.content,
                hasAction: !!finalEventData.action,
                hasQuizId: !!finalEventData.quizId
              })
            }
          } catch (error) {
            console.error('[SignalService] ❌ 处理 onClassroomMsg 失败:', error, {
              finalEventData,
              errorStack: error instanceof Error ? error.stack : 'N/A'
            })
          }
        }
        
        // 特别检查媒体事件和直播事件
        if (message.event === 'onMediaOffer' || message.event === 'onMediaIceCandidate' || message.event === 'onMediaAnswer' || 
            message.event === 'mediaOffer' || message.event === 'mediaIceCandidate' || message.event === 'mediaAnswer' ||
            message.event === 'lesson' || message.event === 'finishClass' ||
            mappedEvent === 'liveStarted' || mappedEvent === 'liveStopped' ||
            mappedEvent === 'onMediaOffer' || mappedEvent === 'onMediaAnswer' || mappedEvent === 'onMediaIceCandidate') {
          console.log('[SignalService] 🎯 重要事件触发:', {
            originalEvent: message.event,
            mappedEvent,
            finalEventData,
            hasListeners: this.eventListeners.has(mappedEvent),
            listenersCount: this.eventListeners.get(mappedEvent)?.size || 0,
            allListeners: Array.from(this.eventListeners.keys()),
            jsonStrPreview: finalEventData?.jsonStr ? finalEventData.jsonStr.substring(0, 100) + '...' : 'N/A',
            parsedFrom: finalEventData?.from,
            parsedTo: finalEventData?.to,
            streamType: finalEventData?.streamType || '未指定'
          })
          
          // 如果是 onMediaOffer 事件但没有监听器，给出严重警告
          if (mappedEvent === 'onMediaOffer' && 
              (!this.eventListeners.has(mappedEvent) || this.eventListeners.get(mappedEvent)?.size === 0)) {
            console.error(`[SignalService] ❌❌❌ onMediaOffer 事件没有注册监听器！`)
            console.error('[SignalService] 当前所有已注册的监听器:', Array.from(this.eventListeners.keys()))
            console.error('[SignalService] 这会导致学生端无法接收屏幕共享流！')
          }
          
          // 如果是媒体事件但没有监听器，给出警告
          if ((mappedEvent === 'onMediaAnswer' || mappedEvent === 'onMediaIceCandidate') && 
              (!this.eventListeners.has(mappedEvent) || this.eventListeners.get(mappedEvent)?.size === 0)) {
            console.error(`[SignalService] ❌ ${mappedEvent} 事件没有注册监听器！`)
            console.error('[SignalService] 当前所有已注册的监听器:', Array.from(this.eventListeners.keys()))
          }
        }
        
        // 特别处理白板状态变化事件，确保数据格式正确
        if (mappedEvent === 'whiteboardEnabled') {
          // 确保数据格式为 { enabled: boolean }
          const whiteboardData = typeof finalEventData.enabled === 'boolean' 
            ? { enabled: finalEventData.enabled }
            : { enabled: finalEventData.data?.enabled ?? false }
          
          console.log('[SignalService] 🎯 触发 whiteboardEnabled 事件:', {
            originalEvent: message.event,
            mappedEvent,
            whiteboardData,
            hasListeners: this.eventListeners.has('whiteboardEnabled'),
            listenersCount: this.eventListeners.get('whiteboardEnabled')?.size || 0
          })
          
          this.emit('whiteboardEnabled', whiteboardData)
        } else {
          // 触发对应的事件（使用类型断言，因为后端可能发送任意事件类型）
          this.emit(mappedEvent as keyof SignalEvents, finalEventData)
        }
      } catch (error) {
        console.error('[SignalService] ❌ 解析消息失败:', error, event.data)
      }
    }
  }

  /**
   * 发送消息（根据后端文档格式：{ event, data }）
   */
  private send(event: string, data: any) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn(`[SignalService] WebSocket 未连接，消息将加入待发送队列: ${event}`)
      this.pendingMessages.push({ event, data })
      return
    }

    try {
      const message: WebSocketMessage = { event, data }
      const messageStr = JSON.stringify(message)
      const messageSize = messageStr.length
      
      // 记录消息大小信息（仅用于日志，不做限制）
      console.log(`[SignalService] 📤 发送消息: ${event}，大小: ${(messageSize / 1024).toFixed(2)} KB`)
      
      this.socket.send(messageStr)
    } catch (error) {
      console.error(`[SignalService] 发送消息失败: ${event}`, error)
      // 如果发送失败，加入待发送队列
      this.pendingMessages.push({ event, data })
    }
  }

  /**
   * 发送待发送的消息
   */
  private flushPendingMessages() {
    if (this.pendingMessages.length === 0) return

    console.log(`[SignalService] 发送 ${this.pendingMessages.length} 条待发送消息`)
    const messages = [...this.pendingMessages]
    this.pendingMessages = []

    messages.forEach(msg => {
      this.send(msg.event, msg.data)
    })
  }

  /**
   * 安排重连
   */
  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1) // 指数退避
    
    console.log(`[SignalService] ${delay}ms 后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
    
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  /**
   * 触发事件（内部事件系统）
   */
  private emit<K extends keyof SignalEvents>(event: K, ...args: any[]) {
    const listeners = this.eventListeners.get(event as string)
    if (listeners) {
      listeners.forEach(callback => {
        try {
          (callback as any)(...args)
        } catch (error) {
          console.error(`[SignalService] 事件监听器执行错误: ${event}`, error)
        }
      })
    }
  }

  /**
   * 加入房间（根据后端文档：joinClassroom）
   */
  joinRoom(roomId: string | number, userId: string | number, userInfo?: any) {
    if (!this.socket) {
      console.error('[SignalService] joinRoom: socket 不可用')
      return
    }
    
    // 统一使用 classroomId（数字类型，后端使用）
    // 优先使用构造函数中从微前端主应用获取的 classroomId；如果没有，则使用传入的 roomId
    const classroomId = this.classroomId || (typeof roomId === 'string' ? parseInt(roomId) : roomId)
    const userIdNum = typeof userId === 'string' ? parseInt(userId) : userId
    
    // 更新 classroomId（如果构造函数中已从微前端获取，这里会保持；否则使用传入的值）
    this.classroomId = classroomId
    this.userId = userId.toString()
    console.log('[SignalService] joinRoom - classroomId:', this.classroomId, '来源:', this.classroomId ? '微前端主应用' : '传入参数')
    
    // 保存 joinRoom 参数，用于重连后自动重新加入
    this.joinRoomParams = { roomId, userId, userInfo }

    // 如果未连接，等待连接
    if (this.socket.readyState !== WebSocket.OPEN) {
      console.warn('[SignalService] joinRoom: socket 未连接，等待连接...')
      const onConnect = () => {
        this.off('connect', onConnect)
        this.sendJoinClassroom(userInfo)
        console.log('[SignalService] ✅ 已发送加入房间请求:', { classroomId, userId: userIdNum })
      }
      this.on('connect', onConnect)
      return
    }

    this.sendJoinClassroom(userInfo)
  }

  /**
   * 发送加入房间消息（内部方法）
   */
  private sendJoinClassroom( jsonStr?: any) {
    const data = {
      id: this.classroomId,
      jsonStr: jsonStr ? (typeof jsonStr === 'string' ? jsonStr : JSON.stringify(jsonStr)) : ''
    }
    this.send('joinClassroom', data)
    console.log('[SignalService] ✅ 已发送加入房间请求:', data)
  }

  /**
   * 离开房间（根据后端文档：leaveClassroom）
   */
  leaveRoom() {
    if (!this.socket || !this.classroomId) return

    this.send('leaveClassroom', {
      id: this.classroomId,
      jsonStr: ''
    })
    console.log('[SignalService] ✅ 已发送离开房间请求')
    
    // 清除 joinRoom 参数，离开房间后不再自动重新加入
    this.joinRoomParams = null
  }

  /**
   * 开始教学（老师）- 根据后端文档：lesson
   */
  async startLesson(classroomId?: number, userId?: number) {
    if (!this.socket) {
      await this.scheduleReconnect()
    }
    const id = classroomId || this.classroomId
    const uid = userId || (typeof this.userId === 'string' ? parseInt(this.userId) : this.userId)
    
    if (!id || !uid) {
      console.error('[SignalService] startLesson: classroomId 或 userId 不可用')
      return
    }

    this.send('lesson', {
      id,
      jsonStr: JSON.stringify({
        userId: uid
      })
    })
    console.log('[SignalService] ✅ 已发送开始教学请求')
  }

  /**
   * 下课（老师）- 根据后端文档：finishClass
   */
  finishClass(classroomId?: number) {
    if (!this.socket) return

    const id = classroomId || this.classroomId
    if (!id) {
      console.error('[SignalService] finishClass: classroomId 不可用')
      return
    }

    this.send('finishClass', {
      id,
      jsonStr: ''
    })
    console.log('[SignalService] ✅ 已发送下课请求')
  }

  /**
   * 发起投票（仅教师端调用）- 根据后端文档：startVote
   * 教师端调用此方法发起投票，学生端会收到 onStartVote 事件
   */
  startVote(classroomId: number, jsonStr: string | object) {
    if (!this.socket) return

    const jsonStrValue = typeof jsonStr === 'string' ? jsonStr : JSON.stringify(jsonStr)
    
    this.send('startVote', {
      id: classroomId,
      jsonStr: jsonStrValue
    })
    console.log('[SignalService] ✅ 已发送发起投票请求（教师端）')
  }

  /**
   * 发送投票结果（仅学生端调用）- 根据后端文档：sendVote
   * 学生端调用此方法提交投票结果，教师端会收到 onRejectVote 事件
   */
  sendVote(classroomId: number, jsonStr: string | object) {
    if (!this.socket) return

    const jsonStrValue = typeof jsonStr === 'string' ? jsonStr : JSON.stringify(jsonStr)
    
    this.send('sendVote', {
      id: classroomId,
      jsonStr: jsonStrValue
    })
    console.log('[SignalService] ✅ 已发送投票结果（学生端）')
  }

  /**
   * 举手/取消举手（学生）- 根据后端文档：handUp
   */
  handUp(classroomId: number, jsonStr: string | object) {
    if (!this.socket) return

    const jsonStrValue = typeof jsonStr === 'string' ? jsonStr : JSON.stringify(jsonStr)
    
    this.send('handUp', {
      id: classroomId,
      jsonStr: jsonStrValue
    })
    console.log('[SignalService] ✅ 已发送举手请求')
  }

  /**
   * 发布随堂练习（老师）- 根据后端文档：pushTask
   */
  pushTask(classroomId: number, itemId: number, jsonStr: string | object) {
    if (!this.socket) return

    // 将 itemId 和 jsonStr 合并到 jsonStr 中
    const jsonData = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr
    const finalData = {
      itemId,
      ...jsonData
    }
    
    this.send('pushTask', {
      id: classroomId,
      itemId:itemId,
      jsonStr: JSON.stringify(finalData)
    })
    console.log('[SignalService] ✅ 已发送发布随堂练习请求')
  }

  /**
   * 发言/发言设置 - 根据后端文档：sendClassroomMsg
   */
  sendClassroomMsg(classroomId: number, jsonStr: string | object) {
    if (!this.socket) return

    const jsonStrValue = typeof jsonStr === 'string' ? jsonStr : JSON.stringify(jsonStr)
    
    this.send('sendClassroomMsg', {
      id: classroomId,
      jsonStr: jsonStrValue
    })
    console.log('[SignalService] ✅ 已发送发言消息')
  }

  /**
   * 发送 Offer
   * @param to 接收方（'broadcast' 或具体用户ID）
   * @param offer WebRTC Offer
   * @param streamType 流类型：'camera' 表示摄像头流，'screen' 表示屏幕共享流
   */
  sendOffer(to: string, offer: RTCSessionDescriptionInit, streamType: 'camera' | 'screen' = 'camera') {
    if (!this.socket) {
      console.warn('[SignalService] sendOffer: socket 不可用')
      return
    }

    const payload = {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        from: this.userId,
        to,
        offer,
        streamType  // 添加流类型标识，用于区分摄像头流和屏幕共享流
      })
    }
    
    // 记录消息大小信息（仅用于日志，不做限制）
    const messageSize = JSON.stringify({ event: 'mediaOffer', data: payload }).length
    const sdpLength = offer.sdp?.length || 0
    
    console.log('[SignalService] 📤 发送 mediaOffer 事件:', {
      event: 'mediaOffer',
      classroomId: this.classroomId,
      userId: this.userId,
      to,
      offerType: offer.type,
      streamType,
      sdpLength,
      messageSize: `${(messageSize / 1024).toFixed(2)} KB`,
      socketConnected: this.isConnected
    })
    
    this.send('mediaOffer', payload)
  }

  /**
   * 发送 Answer
   */
  sendAnswer(to: string, answer: RTCSessionDescriptionInit) {
    if (!this.socket) {
      console.warn('[SignalService] sendAnswer: socket 不可用')
      return
    }

    const payload = {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        from: this.userId,
        to,
        answer
      })
    }
    
    // 记录消息大小信息（仅用于日志，不做限制）
    const messageSize = JSON.stringify({ event: 'mediaAnswer', data: payload }).length
    const sdpLength = answer.sdp?.length || 0
    
    console.log('[SignalService] 📤 发送 mediaAnswer 事件:', {
      event: 'mediaAnswer',
      classroomId: this.classroomId,
      userId: this.userId,
      to,
      answerType: answer.type,
      sdpLength,
      messageSize: `${(messageSize / 1024).toFixed(2)} KB`,
      socketConnected: this.isConnected
    })
    
    this.send('mediaAnswer', payload)
  }

  /**
   * 发送 ICE Candidate（批量发送版本，避免消息过大导致 WebSocket 断开）
   * @param to 接收方（'broadcast' 或具体用户ID）
   * @param candidate WebRTC ICE Candidate
   * @param streamType 流类型：'camera' 表示摄像头流，'screen' 表示屏幕共享流
   */
  sendIceCandidate(to: string, candidate: RTCIceCandidateInit, streamType: 'camera' | 'screen' = 'camera') {
    if (!this.socket) {
      console.warn('[SignalService] sendIceCandidate: socket 不可用')
      return
    }

    // 将 candidate 加入队列
    this.iceCandidateQueue.push({ to, candidate, streamType })
    
    const queueLength = this.iceCandidateQueue.length
    
    // 如果队列达到最大数量，立即刷新（不等待定时器）
    if (queueLength >= this.MAX_CANDIDATES_PER_BATCH) {
      console.log(`[SignalService] 🚀 队列达到最大数量 (${queueLength})，立即批量发送`)
      this.flushIceCandidates()
      return
    }
    
    // 如果队列达到最小批量数量，立即刷新（更激进的批量发送，不等待定时器）
    if (queueLength >= this.MIN_CANDIDATES_TO_BATCH) {
      console.log(`[SignalService] 🚀 队列达到最小批量数量 (${queueLength})，立即批量发送`)
      // 清除现有定时器，立即发送
      if (this.iceCandidateFlushTimer) {
        clearTimeout(this.iceCandidateFlushTimer)
        this.iceCandidateFlushTimer = null
      }
      this.flushIceCandidates()
      return
    }
    
    // 如果队列中只有一个 candidate，启动定时器（但延迟很短）
    if (queueLength === 1) {
      console.log('[SignalService] ⏳ 队列中只有 1 个 candidate，启动定时器等待批量发送')
      this.scheduleIceCandidateFlush()
    }
  }

  /**
   * 安排 ICE candidate 批量发送
   */
  private scheduleIceCandidateFlush() {
    if (this.iceCandidateFlushTimer) {
      clearTimeout(this.iceCandidateFlushTimer)
    }
    
    this.iceCandidateFlushTimer = window.setTimeout(() => {
      this.iceCandidateFlushTimer = null
      this.flushIceCandidates()
    }, this.ICE_CANDIDATE_BATCH_DELAY)
  }

  /**
   * 批量发送 ICE candidates
   */
  private flushIceCandidates() {
    if (this.iceCandidateQueue.length === 0) {
      return
    }

    const queueLength = this.iceCandidateQueue.length
    console.log(`[SignalService] 🔄 开始批量发送 ${queueLength} 个 ICE candidates`)

    // 清除定时器
    if (this.iceCandidateFlushTimer) {
      clearTimeout(this.iceCandidateFlushTimer)
      this.iceCandidateFlushTimer = null
    }

    // 按接收方和流类型分组
    const grouped: Map<string, Array<{ candidate: RTCIceCandidateInit; streamType: 'camera' | 'screen' }>> = new Map()
    
    for (const item of this.iceCandidateQueue) {
      const key = `${item.to}:${item.streamType}`
      if (!grouped.has(key)) {
        grouped.set(key, [])
      }
      grouped.get(key)!.push({ candidate: item.candidate, streamType: item.streamType })
    }

    // 清空队列
    this.iceCandidateQueue = []

    // 发送分组后的 candidates
    for (const [key, candidates] of grouped.entries()) {
      const [to, streamType] = key.split(':') as [string, 'camera' | 'screen']
      
      console.log(`[SignalService] 📦 准备发送 ${candidates.length} 个 ${streamType} candidates 给 ${to}`)
      
      // 始终批量发送，即使只有 1 个 candidate 也使用批量格式（统一处理）
      this.sendBatchIceCandidates(to, candidates, streamType)
    }
  }

  /**
   * 发送单个 ICE candidate（保持向后兼容）
   */
  private sendSingleIceCandidate(to: string, candidate: RTCIceCandidateInit, streamType: 'camera' | 'screen') {
    const payload = {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        from: this.userId,
        to,
        candidate,
        streamType
      })
    }
    
    console.log('[SignalService] 📤 发送单个 mediaIceCandidate 事件:', {
      event: 'mediaIceCandidate',
      classroomId: this.classroomId,
      userId: this.userId,
      to,
      candidate: candidate.candidate ? candidate.candidate.substring(0, 50) + '...' : 'null',
      streamType,
      socketConnected: this.isConnected
    })
    
    this.send('mediaIceCandidate', payload)
  }

  /**
   * 批量发送多个 ICE candidates
   */
  private sendBatchIceCandidates(
    to: string, 
    candidates: Array<{ candidate: RTCIceCandidateInit; streamType: 'camera' | 'screen' }>,
    defaultStreamType: 'camera' | 'screen'
  ) {
    // 如果只有一个 candidate，直接发送（简化处理，避免不必要的分组）
    if (candidates.length === 1) {
      this.sendBatchIceCandidateMessage(to, [candidates[0].candidate], candidates[0].streamType)
      return
    }
    
    // 按流类型分组
    const cameraCandidates: RTCIceCandidateInit[] = []
    const screenCandidates: RTCIceCandidateInit[] = []
    
    for (const item of candidates) {
      if (item.streamType === 'screen') {
        screenCandidates.push(item.candidate)
      } else {
        cameraCandidates.push(item.candidate)
      }
    }

    // 发送摄像头流的 candidates
    if (cameraCandidates.length > 0) {
      this.sendBatchIceCandidatesForStream(to, cameraCandidates, 'camera')
    }

    // 发送屏幕共享流的 candidates
    if (screenCandidates.length > 0) {
      this.sendBatchIceCandidatesForStream(to, screenCandidates, 'screen')
    }
  }

  /**
   * 为特定流类型批量发送 ICE candidates
   */
  private sendBatchIceCandidatesForStream(
    to: string,
    candidates: RTCIceCandidateInit[],
    streamType: 'camera' | 'screen'
  ) {
    // 直接发送所有 candidates，不做大小限制
    if (candidates.length > 0) {
      this.sendBatchIceCandidateMessage(to, candidates, streamType)
    }
  }

  /**
   * 发送批量 ICE candidate 消息
   */
  private sendBatchIceCandidateMessage(
    to: string,
    candidates: RTCIceCandidateInit[],
    streamType: 'camera' | 'screen'
  ) {
    // 检查 WebSocket 连接状态
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('[SignalService] ⚠️ WebSocket 未连接，批量 ICE candidates 将被丢弃（避免队列堆积）:', {
        candidatesCount: candidates.length,
        streamType
      })
      // 不加入待发送队列，因为 ICE candidates 有时效性，重连后发送可能已经过期
      return
    }

    const payload = {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        from: this.userId,
        to,
        candidates, // 批量发送多个 candidates
        streamType
      })
    }

    const messageSize = JSON.stringify(payload).length
    console.log('[SignalService] 📤 批量发送 mediaIceCandidate 事件:', {
      event: 'mediaIceCandidate',
      classroomId: this.classroomId,
      userId: this.userId,
      to,
      candidatesCount: candidates.length,
      streamType,
      messageSize: `${(messageSize / 1024).toFixed(2)} KB`,
      socketConnected: this.isConnected
    })

    this.send('mediaIceCandidate', payload)
  }

  /**
   * 发送聊天消息（使用后端 sendClassroomMsg 事件）
   */
  sendChatMessage(message: Omit<ChatMessage, 'id' | 'timestamp'>) {
    if (!this.socket) return

    // 使用后端 sendClassroomMsg 事件发送聊天消息
    const classroomId = this.classroomId || 1
    const messageData = {
      type: 'chat',
      userId: this.userId,
      userName: message.userName,
      content: message.content,
      messageType: message.type || 'text',
      isTeacher: message.isTeacher,
      timestamp: Date.now()
    }
    
    this.sendClassroomMsg(classroomId, messageData)
    console.log('[SignalService] ✅ 已发送聊天消息（通过 sendClassroomMsg）')
  }

  /**
   * 改变聊天模式
   */
  changeChatMode(mode: 'all' | 'teacher' | 'muted') {
    if (!this.socket) return

    this.send('chatModeChange', {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        roomId: this.classroomId,
        mode
      })
    })
  }

  /**
   * 举手请求
   */
  requestRaiseHand(userInfo: Omit<RaiseHandRequest, 'id' | 'timestamp'>) {
    if (!this.socket) return

    this.send('raiseHandRequest', {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        roomId: this.classroomId,
        userId: this.userId,
        request: {
          ...userInfo,
          id: Date.now().toString(),
          timestamp: Date.now()
        }
      })
    })
  }

  /**
   * 取消举手
   */
  cancelRaiseHand() {
    if (!this.socket) return

    this.send('raiseHandCancel', {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        roomId: this.classroomId,
        userId: this.userId
      })
    })
  }

  /**
   * 允许学生上麦
   */
  allowStudent(userId: string) {
    if (!this.socket) return

    this.send('raiseHandAllow', {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        roomId: this.classroomId,
        userId
      })
    })
  }

  /**
   * 创建互动题
   */
  createQuiz(quiz: Quiz) {
    if (!this.socket) return

    this.send('quizCreate', {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        roomId: this.classroomId,
        quiz
      })
    })
  }

  /**
   * 提交答案
   */
  submitQuizAnswer(quizId: string, answer: string | string[]) {
    if (!this.socket) return

    this.send('quizAnswer', {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        roomId: this.classroomId,
        userId: this.userId,
        quizId,
        answer
      })
    })
  }

  /**
   * 结束互动题
   */
  finishQuiz(quizId: string) {
    if (!this.socket) return

    this.send('quizFinish', {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        roomId: this.classroomId,
        quizId
      })
    })
  }

  /**
   * 切换文档
   */
  switchDocument(documentId: string, document?: any) {
    if (!this.socket) {
      console.warn('[SignalService] switchDocument: socket 不可用')
      return
    }

    const payload = {
      roomId: this.classroomId,
      documentId,
      document // 可选的完整文档信息
    }
    
    // 验证 payload 是否可以序列化
    let payloadSize = 0
    try {
      const payloadStr = JSON.stringify(payload)
      payloadSize = payloadStr.length
      console.log('[SignalService] 📤 发送文档切换事件:', {
        roomId: payload.roomId,
        documentId: payload.documentId,
        hasDocument: !!payload.document,
        documentName: payload.document?.name,
        documentType: payload.document?.type,
        documentUrlLength: payload.document?.url ? payload.document.url.length : 0,
        documentUrlPreview: payload.document?.url ? payload.document.url.substring(0, 50) + '...' : 'N/A',
        payloadSize: `${(payloadSize / 1024).toFixed(2)} KB`,
        canSerialize: true
      })
    } catch (e) {
      console.error('[SignalService] ❌ 无法序列化 payload:', e)
      console.error('[SignalService] payload 对象:', payload)
      return // 如果无法序列化，不发送
    }
    
    // 检查 payload 大小
    if (payloadSize > 9 * 1024 * 1024) {
      console.warn(`[SignalService] ⚠️ 警告：payload 大小 ${(payloadSize / 1024 / 1024).toFixed(2)} MB 接近限制`)
    }
    
    try {
      this.send('documentSwitch', {
        id: this.classroomId,
        jsonStr: JSON.stringify(payload)
      })
      console.log('[SignalService] ✅ 已发送文档切换事件到服务器')
    } catch (e) {
      console.error('[SignalService] ❌ 发送文档切换事件失败:', e)
    }
  }

  /**
   * 白板绘制
   */
  whiteboardDraw(action: string, data: any) {
    if (!this.socket) return

    this.send('whiteboardDraw', {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        roomId: this.classroomId,
        userId: this.userId,
        action,
        data
      })
    })
  }

  /**
   * 清空白板
   */
  whiteboardClear() {
    if (!this.socket) return

    this.send('whiteboardClear', {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        roomId: this.classroomId,
        userId: this.userId
      })
    })
  }

  /**
   * 切换白板状态
   */
  whiteboardToggle(enabled: boolean) {
    if (!this.socket) return

    this.send('whiteboardToggle', {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        roomId: this.classroomId,
        userId: this.userId,
        enabled
      })
    })
  }

  /**
   * 同步整个画布状态（类似投屏的完整画面传输）
   */
  whiteboardSyncState(canvasState: any) {
    if (!this.socket) return

    this.send('whiteboardSyncState', {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        roomId: this.classroomId,
        userId: this.userId,
        canvasState
      })
    })
  }

  /**
   * 开始屏幕共享（使用后端 screenSharing 方法）
   */
  startScreenShare() {
    if (!this.socket) return

    this.send('screenSharing', {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        roomId: this.classroomId,
        userId: this.userId,
        action: 'start'  // 开始屏幕共享
      })
    })
    console.log('[SignalService] ✅ 已发送屏幕共享开始请求（screenSharing）')
  }

  /**
   * 停止屏幕共享（使用后端 screenSharing 方法）
   */
  stopScreenShare() {
    if (!this.socket) return

    this.send('screenSharing', {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        roomId: this.classroomId,
        userId: this.userId,
        action: 'stop'  // 停止屏幕共享
      })
    })
    console.log('[SignalService] ✅ 已发送屏幕共享停止请求（screenSharing）')
  }

  /**
   * 开始直播（使用后端 lesson 事件）
   */
  startLive() {
    if (!this.socket) {
      console.error('[SignalService] startLive: socket 不可用')
      return
    }
    
    if (!this.classroomId || !this.userId) {
      console.error('[SignalService] startLive: classroomId 或 userId 不可用', {
        classroomId: this.classroomId,
        userId: this.userId
      })
      return
    }

    const userIdNum = typeof this.userId === 'string' ? parseInt(this.userId) : this.userId
    
    console.log('[SignalService] 📤 发送 lesson 事件（开启直播）:', {
      classroomId: this.classroomId,
      userId: userIdNum
    })
    console.log('[SignalService] Socket 状态:', {
      connected: this.isConnected,
      readyState: this.socket?.readyState
    })
    
    // 使用后端 lesson 事件开启直播
    this.send('lesson', {
      id: this.classroomId,
      jsonStr: JSON.stringify({
        userId: userIdNum
      })
    })
    console.log('[SignalService] ✅ lesson 事件已发送（开启直播）')
  }

  /**
   * 停止直播（使用后端 finishClass 事件）
   */
  stopLive() {
    if (!this.socket) return

    console.log('[SignalService] 📤 发送 finishClass 事件（下播）:', {
      classroomId: this.classroomId
    })
    
    // 使用后端 finishClass 事件下播
    this.send('finishClass', {
      id: this.classroomId,
      jsonStr: ''
    })
    console.log('[SignalService] ✅ finishClass 事件已发送（下播）')
  }

  /**
   * 监听事件
   */
  on<K extends keyof SignalEvents>(event: K, callback: SignalEvents[K]) {
    const eventStr = event as string
    if (!this.eventListeners.has(eventStr)) {
      this.eventListeners.set(eventStr, new Set())
    }
    this.eventListeners.get(eventStr)!.add(callback)
    console.log(`[SignalService] 注册事件监听器: ${eventStr}`, {
      socketConnected: this.isConnected,
      listenersCount: this.eventListeners.get(eventStr)!.size
    })
  }

  /**
   * 取消监听
   */
  off<K extends keyof SignalEvents>(event: K, callback?: SignalEvents[K]) {
    const eventStr = event as string
    const listeners = this.eventListeners.get(eventStr)
    if (listeners) {
      if (callback) {
        listeners.delete(callback)
      } else {
        listeners.clear()
      }
    }
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.isManualClose = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    // 清理 ICE candidate 批量发送定时器
    if (this.iceCandidateFlushTimer) {
      clearTimeout(this.iceCandidateFlushTimer)
      this.iceCandidateFlushTimer = null
    }
    // 发送剩余的 ICE candidates
    if (this.iceCandidateQueue.length > 0) {
      this.flushIceCandidates()
    }
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
  }
}
