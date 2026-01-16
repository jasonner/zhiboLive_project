import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface Document {
  id: string
  name: string
  type: 'ppt' | 'pdf' | 'image' | 'video' | 'audio'
  url: string
  thumbnail?: string
}

export interface ChatMessage {
  id: string
  userId: string
  userName: string
  avatar?: string
  content: string
  type: 'text' | 'image' | 'question'
  timestamp: number
  isTeacher?: boolean
}

export interface RaiseHandRequest {
  id: string
  userId: string
  userName: string
  avatar?: string
  timestamp: number
}

export interface Quiz {
  id: string
  type: 'single' | 'multiple' | 'judge'
  question: string
  options?: string[]
  correctAnswer: string | string[]
  isActive: boolean
  statistics?: {
    total: number
    correct: number
    answers: Record<string, number>
  }
}

export interface Vote {
  id: string
  title: string
  content: string
  duration: number // 投票时长（秒）
  options: string[]
  isActive: boolean
  createdAt: number
  statistics?: {
    total: number
    votes: Record<string, number> // 选项索引 -> 得票数
  }
  votedUsers?: Set<string> // 已投票的学生ID集合
}

export interface VoteResult {
  optionIndex: number
  option: string
  count: number
  percentage: number
}

export interface Student {
  userId: string
  name: string
  role: 'student' | 'teacher'
  avatar?: string
  isOnline: boolean
}

export type DisplayMode = 'document' | 'video' | 'whiteboard' | 'screen'

export const useLiveStore = defineStore('live', () => {
  // 基础信息
  const courseName = ref('')
  const onlineCount = ref(0)
  const networkStatus = ref<'good' | 'normal' | 'poor'>('good')
  const networkDelay = ref(0)
  const networkBitrate = ref(0)
  const wsDisconnected = ref(false) // WebSocket 断开状态
  const startTime = ref(Date.now())
  // 教师端默认关闭直播状态，学生端会在初始化时根据服务器状态设置
  const isLive = ref(false)
  // 用于触发计时器更新的响应式变量
  const timerTick = ref(0)

  // 显示模式
  const displayMode = ref<DisplayMode>('document')
  const currentDocument = ref<Document | null>(null)
  const documents = ref<Document[]>([])

  // 媒体控制
  const cameraEnabled = ref(true)
  const microphoneEnabled = ref(true)
  const screenSharing = ref(false)
  
  // 视频流（学生端使用）
  const teacherStream = ref<MediaStream | null>(null)
  const screenStream = ref<MediaStream | null>(null)

  // 白板
  const whiteboardEnabled = ref(false)
  const whiteboardCanvas = ref<HTMLCanvasElement | null>(null)

  // 聊天
  const chatMessages = ref<ChatMessage[]>([])
  // 记录刚刚发送的消息，用于匹配服务器广播回来的消息（避免重复）
  const pendingSentMessages = ref<Map<string, ChatMessage>>(new Map())
  const chatMode = ref<'all' | 'teacher' | 'muted'>('all')
  const allowImage = ref(true)
  const danmakuEnabled = ref(true) // 弹幕开关，默认开启

  // 举手
  const raiseHandRequests = ref<RaiseHandRequest[]>([])
  const allowedStudents = ref<Set<string>>(new Set())

  // 互动题
  const currentQuiz = ref<Quiz | null>(null)
  const quizHistory = ref<Quiz[]>([])

  // 投票
  const votes = ref<Vote[]>([])
  const currentVote = ref<Vote | null>(null)

  // 学生列表
  const students = ref<Student[]>([])

  // 计时器引用
  let timerInterval: number | null = null

  // 计算属性
  const elapsedTime = computed(() => {
    // 访问 timerTick 来建立依赖关系，触发响应式更新
    const _ = timerTick.value
    if (!isLive.value) return 0
    return Math.floor((Date.now() - startTime.value) / 1000)
  })

  const formatTime = computed(() => {
    const seconds = elapsedTime.value
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  })

  // Actions
  function startLive(serverStartTime?: number) {
    console.log('[Store] 🎬 startLive 被调用:', {
      serverStartTime: serverStartTime ? new Date(serverStartTime).toLocaleString() : 'undefined',
      currentIsLive: isLive.value,
      currentStartTime: startTime.value ? new Date(startTime.value).toLocaleString() : 'undefined'
    })
    
    isLive.value = true
    // 如果提供了服务器开始时间，使用服务器时间；否则使用本地时间
    startTime.value = serverStartTime || Date.now()
    timerTick.value = 0
    
    console.log('[Store] ✅ startLive 执行完成:', {
      isLive: isLive.value,
      startTime: new Date(startTime.value).toLocaleString(),
      timerInterval: timerInterval !== null
    })
    
    // 启动定时器，每秒更新一次
    if (timerInterval === null) {
      timerInterval = window.setInterval(() => {
        if (isLive.value) {
          timerTick.value = Date.now() // 触发响应式更新
        } else {
          // 如果直播已停止，清除定时器
          if (timerInterval !== null) {
            clearInterval(timerInterval)
            timerInterval = null
          }
        }
      }, 1000) // 每秒更新一次
      console.log('[Store] ✅ 定时器已启动')
    } else {
      console.log('[Store] ⚠️ 定时器已存在，跳过启动')
    }
  }

  function stopLive() {
    isLive.value = false
    // 清除定时器
    if (timerInterval !== null) {
      clearInterval(timerInterval)
      timerInterval = null
    }
  }

  function setDisplayMode(mode: DisplayMode) {
    displayMode.value = mode
  }

  function addDocument(doc: Document) {
    documents.value.push(doc)
    if (!currentDocument.value) {
      currentDocument.value = doc
    }
  }

  function switchDocument(docId: string) {
    const doc = documents.value.find(d => d.id === docId)
    if (doc) {
      currentDocument.value = doc
    }
  }

  function syncDocument(doc: Document) {
    // 如果文档不存在，先添加到列表
    const existingDoc = documents.value.find(d => d.id === doc.id)
    if (!existingDoc) {
      documents.value.push(doc)
    }
    // 切换到该文档
    currentDocument.value = doc
  }

  function addChatMessage(message: ChatMessage) {
    console.log('[LiveStore] 📥 添加聊天消息到 store:', {
      message,
      currentMessagesCount: chatMessages.value.length,
      messageId: message.id,
      messageContent: message.content,
      pendingCount: pendingSentMessages.value.size
    })
    
    // 检查消息是否已存在（避免重复）
    // 1. 先检查ID是否相同
    const existingById = chatMessages.value.findIndex(m => m.id === message.id)
    if (existingById >= 0) {
      console.log('[LiveStore] ⚠️ 消息ID已存在，跳过添加:', message.id)
      return
    }
    
    // 2. 检查是否是刚刚发送的消息（通过 pendingSentMessages 匹配）
    // 使用 userId + content 作为匹配键（允许时间戳有差异）
    const matchKey = `${message.userId}:${message.content}`
    const pendingMessage = pendingSentMessages.value.get(matchKey)
    
    if (pendingMessage) {
      // 找到匹配的待发送消息，更新现有消息的ID（使用服务器返回的ID）
      const existingIndex = chatMessages.value.findIndex(m => m.id === pendingMessage.id)
      if (existingIndex >= 0) {
        console.log('[LiveStore] 🔄 找到匹配的待发送消息，更新ID:', {
          oldId: pendingMessage.id,
          newId: message.id,
          content: message.content
        })
        // 更新消息ID为服务器返回的ID
        chatMessages.value[existingIndex].id = message.id
        // 更新时间戳为服务器返回的时间戳（如果服务器返回了）
        if (message.timestamp && message.timestamp !== pendingMessage.timestamp) {
          chatMessages.value[existingIndex].timestamp = message.timestamp
        }
        // 从待发送列表中移除
        pendingSentMessages.value.delete(matchKey)
        console.log('[LiveStore] ✅ 消息ID已更新，当前消息数:', chatMessages.value.length)
        return
      }
    }
    
    // 3. 如果ID不同且不是待发送消息，检查是否是同一消息（通过userId + content + timestamp判断，允许2秒内的误差）
    const existingByContent = chatMessages.value.findIndex(m => {
      const sameUser = m.userId === message.userId
      const sameContent = m.content === message.content
      const timeDiff = Math.abs(m.timestamp - message.timestamp)
      return sameUser && sameContent && timeDiff < 2000 // 2秒内的相同内容视为重复
    })
    if (existingByContent >= 0) {
      console.log('[LiveStore] ⚠️ 消息内容已存在（可能是重复广播），跳过添加:', {
        messageId: message.id,
        existingId: chatMessages.value[existingByContent].id
      })
      return
    }
    
    chatMessages.value.push(message)
    console.log('[LiveStore] ✅ 消息已添加，当前消息数:', chatMessages.value.length)
    
    // 限制消息数量
    if (chatMessages.value.length > 500) {
      chatMessages.value.shift()
    }
  }
  
  // 记录待发送的消息（发送时调用）
  function addPendingSentMessage(message: ChatMessage) {
    const matchKey = `${message.userId}:${message.content}`
    pendingSentMessages.value.set(matchKey, message)
    console.log('[LiveStore] 📝 记录待发送消息:', {
      matchKey,
      messageId: message.id,
      content: message.content.substring(0, 20),
      pendingCount: pendingSentMessages.value.size
    })
    
    // 5秒后自动清理（防止内存泄漏）
    setTimeout(() => {
      if (pendingSentMessages.value.has(matchKey)) {
        pendingSentMessages.value.delete(matchKey)
        console.log('[LiveStore] 🗑️ 待发送消息已超时清理:', matchKey)
      }
    }, 5000)
  }

  function addRaiseHandRequest(request: RaiseHandRequest) {
    raiseHandRequests.value.push(request)
  }

  function removeRaiseHandRequest(userId: string) {
    raiseHandRequests.value = raiseHandRequests.value.filter(r => r.userId !== userId)
  }

  function allowStudent(userId: string) {
    allowedStudents.value.add(userId)
    removeRaiseHandRequest(userId)
  }

  function createQuiz(quiz: Quiz) {
    currentQuiz.value = quiz
    quiz.isActive = true
  }

  function submitQuizAnswer(_userId: string, _answer: string | string[]) {
    if (!currentQuiz.value) return
    // 这里应该通过 WebSocket 发送到服务器
  }

  function finishQuiz() {
    if (currentQuiz.value) {
      currentQuiz.value.isActive = false
      quizHistory.value.push(currentQuiz.value)
      currentQuiz.value = null
    }
  }

  // 投票相关方法
  function createVote(vote: Vote) {
    vote.isActive = true
    vote.createdAt = Date.now()
    votes.value.push(vote)
    currentVote.value = vote
  }

  function submitVote(voteId: string, optionIndex: number, userId?: string) {
    const vote = votes.value.find(v => v.id === voteId)
    if (!vote) return
    
    // 如果提供了 userId，检查是否已投票
    if (userId) {
      if (!vote.votedUsers) {
        vote.votedUsers = new Set()
      }
      // 如果已经投过票，不允许再次投票
      if (vote.votedUsers.has(userId)) {
        console.warn(`[Store] 用户 ${userId} 已经投过票，不允许重复投票`)
        return
      }
      // 记录已投票
      vote.votedUsers.add(userId)
    }
    
    if (!vote.statistics) {
      vote.statistics = {
        total: 0,
        votes: {}
      }
    }
    
    if (!vote.statistics.votes[optionIndex]) {
      vote.statistics.votes[optionIndex] = 0
    }
    
    vote.statistics.votes[optionIndex]++
    vote.statistics.total++
  }

  // 检查用户是否已投票
  function hasUserVoted(voteId: string, userId: string): boolean {
    const vote = votes.value.find(v => v.id === voteId)
    if (!vote || !vote.votedUsers) return false
    return vote.votedUsers.has(userId)
  }

  function finishVote(voteId: string) {
    const vote = votes.value.find(v => v.id === voteId)
    if (vote) {
      vote.isActive = false
      if (currentVote.value?.id === voteId) {
        currentVote.value = null
      }
    }
  }

  function getVoteResults(voteId: string): VoteResult[] {
    const vote = votes.value.find(v => v.id === voteId)
    if (!vote) return []
    
    // 如果没有统计数据，初始化一个空的统计对象
    if (!vote.statistics) {
      vote.statistics = {
        total: 0,
        votes: {}
      }
    }
    
    // 获取所有选项的结果
    const results: VoteResult[] = vote.options.map((option, index) => {
      const count = vote.statistics!.votes[index] || 0
      const percentage = vote.statistics!.total > 0 
        ? Math.round((count / vote.statistics!.total) * 100) 
        : 0
      
      return {
        optionIndex: index,
        option,
        count,
        percentage
      }
    })
    
    // 添加弃权选项
    // 计算弃权票数：总参与人数 - 已投票人数
    const votedCount = Object.values(vote.statistics.votes).reduce((sum, count) => sum + count, 0)
    const abstainCount = vote.statistics.total - votedCount
    const abstainPercentage = vote.statistics.total > 0 
      ? Math.round((abstainCount / vote.statistics.total) * 100) 
      : 0
    
    results.push({
      optionIndex: -1, // 弃权选项使用 -1 作为索引
      option: '弃权',
      count: abstainCount,
      percentage: abstainPercentage
    })
    
    return results
  }

  function updateNetworkStatus(status: 'good' | 'normal' | 'poor', delay: number, bitrate: number) {
    networkStatus.value = status
    networkDelay.value = delay
    networkBitrate.value = bitrate
  }

  function setWsDisconnected(disconnected: boolean) {
    wsDisconnected.value = disconnected
  }

  function updateOnlineCount(count: number) {
    onlineCount.value = count
  }
  function setCourseName(name: string) {
    courseName.value = name
  }
  function setTeacherStream(stream: MediaStream | null) {
    console.log('[Store] 设置 teacherStream:', stream ? `stream-${stream.id}` : 'null')
    if (stream) {
      console.log('[Store] 流信息 - 视频轨道:', stream.getVideoTracks().length, '音频轨道:', stream.getAudioTracks().length)
      stream.getTracks().forEach(track => {
        console.log(`[Store] 轨道: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState}`)
      })
    }
    // 直接设置，Vue 的响应式系统应该能检测到 MediaStream 的变化
    teacherStream.value = stream
  }

  function setScreenStream(stream: MediaStream | null) {
    console.log('[Store] 设置 screenStream:', stream ? `stream-${stream.id}` : 'null')
    if (stream) {
      console.log('[Store] screenStream 流信息 - 视频轨道:', stream.getVideoTracks().length, '音频轨道:', stream.getAudioTracks().length)
      stream.getTracks().forEach(track => {
        console.log(`[Store] screenStream 轨道: ${track.kind}, label: ${track.label}, enabled: ${track.enabled}, readyState: ${track.readyState}`)
      })
    }
    screenStream.value = stream
  }

  // 学生列表管理
  function addStudent(student: Student) {
    const existingIndex = students.value.findIndex(s => s.userId === student.userId)
    if (existingIndex === -1) {
      students.value.push(student)
    } else {
      // 更新已存在的学生信息
      students.value[existingIndex] = { ...students.value[existingIndex], ...student }
    }
  }

  function removeStudent(userId: string) {
    students.value = students.value.filter(s => s.userId !== userId)
  }

  function updateStudentStatus(userId: string, isOnline: boolean) {
    const student = students.value.find(s => s.userId.toString() === userId)
    if (student) {
      student.isOnline = isOnline
    }
  }

  function setStudents(studentList: Student[]) {
    students.value = studentList
  }

  function clearStudents() {
    students.value = []
  }

  return {
    // State
    courseName,
    onlineCount,
    networkStatus,
    networkDelay,
    networkBitrate,
    wsDisconnected,
    startTime,
    isLive,
    displayMode,
    currentDocument,
    documents,
    cameraEnabled,
    microphoneEnabled,
    screenSharing,

    teacherStream,
    screenStream,
    whiteboardEnabled,
    whiteboardCanvas,
    chatMessages,
    chatMode,
    allowImage,
    danmakuEnabled,
    raiseHandRequests,
    allowedStudents,
    currentQuiz,
    quizHistory,
    votes,
    currentVote,
    students,
    // Computed
    elapsedTime,
    formatTime,
    // Actions
    startLive,
    stopLive,
    setDisplayMode,
    addDocument,
    switchDocument,
    syncDocument,
    addChatMessage,
    addPendingSentMessage,
    addRaiseHandRequest,
    removeRaiseHandRequest,
    allowStudent,
    createQuiz,
    submitQuizAnswer,
    finishQuiz,
    createVote,
    submitVote,
    hasUserVoted,
    finishVote,
    getVoteResults,
    updateNetworkStatus,
    setWsDisconnected,
    updateOnlineCount,
    setStudents,
    setTeacherStream,
    setScreenStream,
    addStudent,
    removeStudent,
    updateStudentStatus,
    clearStudents,
    setCourseName
  }
})


