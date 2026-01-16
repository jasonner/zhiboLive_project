<template>
  <div class="chat-panel">
    <div class="chat-header">
      <span class="title">聊天</span>
      <div class="header-controls">
        <!-- 弹幕开关（教师端和学生端都有） -->
        <el-tooltip :content="danmakuEnabled ? '关闭弹幕' : '开启弹幕'" placement="bottom">
          <el-button 
            text 
            class="danmaku-toggle"
            :class="{ 'is-active': danmakuEnabled }"
            @click="handleToggleDanmaku"
          >
            <el-icon><VideoPlay v-if="danmakuEnabled" /><VideoPause v-else /></el-icon>
            <span class="toggle-text">弹幕</span>
          </el-button>
        </el-tooltip>
        <!-- 聊天模式下拉菜单（仅教师端） -->
        <el-dropdown @command="handleChatModeChange" v-if="isTeacher">
          <el-button text>
            {{ chatModeText }}
            <el-icon class="el-icon--right"><arrow-down /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="all">全体可发言</el-dropdown-item>
              <el-dropdown-item command="teacher">只看老师消息</el-dropdown-item>
              <el-dropdown-item command="muted">全体禁言</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <div class="chat-messages" ref="messagesRef">
      <!-- 空状态提示 -->
      <div v-if="filteredMessages.length === 0" class="empty-state">
        <div class="empty-icon">💬</div>
        <div class="empty-text">暂无消息</div>
        <div class="empty-hint">开始聊天吧～</div>
      </div>
      
      <!-- 消息列表 -->
      <div
        v-for="message in filteredMessages"
        :key="message.id"
        class="message-item"
        :class="{ 
          'is-teacher': message.isTeacher && !props.isTeacher, // 学生端：老师消息在左侧
          'is-current-user': !props.isTeacher && !message.isTeacher && message.userId === props.currentUserId, // 学生端：学生自己的消息在右侧
          'is-teacher-sent': props.isTeacher && message.isTeacher // 教师端：老师自己的消息在右侧
        }"
      >
        <div class="message-avatar">
          <el-avatar :size="36" :src="message.avatar">
            {{ message.userName.charAt(0) }}
          </el-avatar>
        </div>
        <div class="message-content">
          <div class="message-header">
            <span class="user-name">{{ message.userName }}</span>
            <span class="message-time">{{ formatTime(message.timestamp) }}</span>
          </div>
          <div class="message-text">{{ message.content }}</div>
        </div>
      </div>
    </div>

    <div class="chat-input">
      <el-input
        v-model="inputMessage"
        :placeholder="inputPlaceholder"
        :disabled="!canSend"
        @keyup.enter="handleSendMessage"
      >
        <template #append>
          <el-button
            :icon="ChatLineRound"
            @click="handleSendMessage"
            :disabled="!canSend || !inputMessage.trim()"
          />
        </template>
      </el-input>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, inject, type Ref } from 'vue'
import { ChatLineRound, ArrowDown, VideoPlay, VideoPause } from '@element-plus/icons-vue'
import { useLiveStore } from '@/store/liveStore'
import type { ChatMessage } from '@/store/liveStore'
import type { SignalService } from '@/utils/signal'
import { getMicroAppData } from '@/utils/microApp'

interface Props {
  isTeacher?: boolean
  currentUserId?: string
}

const props = withDefaults(defineProps<Props>(), {
  isTeacher: false,
  currentUserId: ''
})

const store = useLiveStore()
// 从父组件注入 signalService（教师端和学生端都提供 ref）
const signalServiceRef = inject<Ref<SignalService | null>>('signalService', ref(null))
const signalService = computed(() => signalServiceRef.value)
const inputMessage = ref('')
const messagesRef = ref<HTMLElement | null>(null)

const chatMessages = computed(() => {
  const messages = store.chatMessages
  console.log('[ChatPanel] 📊 chatMessages computed 更新:', {
    messagesCount: messages.length,
    messages: messages.map(m => ({ id: m.id, content: m.content, userName: m.userName }))
  })
  return messages
})
const chatMode = computed(() => store.chatMode)
const danmakuEnabled = computed(() => store.danmakuEnabled)

const chatModeText = computed(() => {
  const modeMap = {
    all: '全体可发言',
    teacher: '只看老师消息',
    muted: '全体禁言'
  }
  return modeMap[chatMode.value]
})

const canSend = computed(() => {
  return chatMode.value === 'all' || (chatMode.value === 'teacher' && props.isTeacher)
})

const inputPlaceholder = computed(() => {
  if (chatMode.value === 'muted') {
    return '全体禁言中...'
  } else if (chatMode.value === 'teacher' && !props.isTeacher) {
    return '仅老师可发言...'
  } else {
    return '输入消息...'
  }
})

const filteredMessages = computed(() => {
  let filtered: typeof chatMessages.value
  if (chatMode.value === 'teacher') {
    filtered = chatMessages.value.filter(m => m.isTeacher)
  } else {
    filtered = chatMessages.value
  }
  console.log('[ChatPanel] 📊 filteredMessages computed 更新:', {
    chatMode: chatMode.value,
    originalCount: chatMessages.value.length,
    filteredCount: filtered.length,
    filtered: filtered.map(m => ({ id: m.id, content: m.content, userName: m.userName, isTeacher: m.isTeacher }))
  })
  return filtered
})

watch(chatMessages, (newMessages, oldMessages) => {
  console.log('[ChatPanel] 👀 chatMessages watch 触发:', {
    oldCount: oldMessages?.length || 0,
    newCount: newMessages.length,
    isTeacher: props.isTeacher
  })
  nextTick(() => {
    scrollToBottom()
  })
}, { deep: true })

function scrollToBottom() {
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function handleChatModeChange(mode: 'all' | 'teacher' | 'muted') {
  store.chatMode = mode
  
  // 通过 WebSocket 通知服务器（使用后端 sendClassroomMsg 事件）
  const service = signalService.value
  if (service) {
    const classroomId = service.currentClassroomId || 1
    const modeData = {
      action: 'chatModeChange',
      mode: mode,
      timestamp: Date.now()
    }
    console.log('[ChatPanel] 📤 发送聊天模式变化:', modeData)
    service.sendClassroomMsg(classroomId, modeData)
  } else {
    console.warn('[ChatPanel] ⚠️ signalService 不可用，无法发送聊天模式变化')
  }
}

function handleToggleDanmaku() {
  // 本地控制弹幕开关，不需要同步到服务器
  store.danmakuEnabled = !store.danmakuEnabled
  console.log('[ChatPanel] 🎬 弹幕开关已切换为:', store.danmakuEnabled ? '开启' : '关闭')
}

function handleSendMessage() {
  if (!inputMessage.value.trim() || !canSend.value) return

  const timestamp = Date.now()
  const userId = props.currentUserId || (props.isTeacher ? 'teacher-001' : 'student-' + Date.now())
  
  // 从微前端主应用获取 userName
  const microAppData = getMicroAppData()
  const userName = microAppData?.wsConfig?.userName || (props.isTeacher ? '老师' : '学生')
  
  // 生成唯一消息ID（使用时间戳和随机数，确保唯一性）
  const messageId = `${userId}-${timestamp}-${Math.random().toString(36).substr(2, 9)}`
  
  const message: ChatMessage = {
    id: messageId,
    userId: userId,
    userName: userName,
    content: inputMessage.value.trim(),
    type: 'text',
    isTeacher: props.isTeacher,
    timestamp: timestamp
  }

  // 立即添加到本地显示（优化用户体验）
  console.log('[ChatPanel] 📤 发送聊天消息，立即添加到本地:', message)
  // 先记录为待发送消息，然后添加到本地
  store.addPendingSentMessage(message)
  store.addChatMessage(message)

  // 通过 WebSocket 发送消息（服务器会广播给所有用户，包括发送者）
  const service = signalService.value
  if (service) {
    // 发送时使用 Omit<ChatMessage, 'id' | 'timestamp'> 格式
    service.sendChatMessage({
      userId: message.userId,
      userName: message.userName,
      content: message.content,
      type: message.type,
      isTeacher: message.isTeacher
    })
    console.log('[ChatPanel] ✅ 消息已发送到服务器')
  } else {
    console.warn('[ChatPanel] ⚠️ signalService 不可用，消息仅显示在本地')
  }

  inputMessage.value = ''
}
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f5f6f7;

  .chat-header {
    padding: 16px 20px;
    border-bottom: 1px solid #e5e7eb;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #ffffff;

    .title {
      font-size: 16px;
      font-weight: 500;
      color: #1f2937;
    }

    .header-controls {
      display: flex;
      align-items: center;
      gap: 8px;

      .danmaku-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 12px;
        border-radius: 6px;
        transition: all 0.2s;
        color: #6b7280;
        font-size: 14px;

        &:hover {
          background: #f3f4f6;
          color: #1f2937;
        }

        &.is-active {
          color: #409eff;
          background: #ecf5ff;

          &:hover {
            background: #d4e9ff;
          }
        }

        .el-icon {
          font-size: 16px;
        }

        .toggle-text {
          font-size: 13px;
          font-weight: 500;
        }
      }
    }
  }

  .chat-messages {
    flex: 1;
    overflow-y: scroll;
    overflow-x: hidden;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: 60vh;
    background: #f5f6f7;

    &::-webkit-scrollbar {
      width: 4px;
    }

    &::-webkit-scrollbar-track {
      background: transparent;
    }

    &::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.1);
      border-radius: 2px;

      &:hover {
        background: rgba(0, 0, 0, 0.15);
      }
    }

    scrollbar-width: thin;
    scrollbar-color: rgba(0, 0, 0, 0.1) transparent;

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      color: #9ca3af;
      text-align: center;

      .empty-icon {
        font-size: 48px;
        margin-bottom: 12px;
        opacity: 0.5;
      }

      .empty-text {
        font-size: 15px;
        font-weight: 400;
        margin-bottom: 6px;
        color: #6b7280;
      }

      .empty-hint {
        font-size: 13px;
        color: #9ca3af;
      }
    }

    .message-item {
      display: flex;
      gap: 8px;
      animation: fadeIn 0.2s ease-out;
      align-items: flex-start;
      padding: 4px 0;

      // 直播间消息样式：简洁列表，无气泡
      .message-avatar {
        flex-shrink: 0;
        width: 32px;
        height: 32px;

        :deep(.el-avatar) {
          width: 32px;
          height: 32px;
          border: none;
        }
      }

      .message-content {
        flex: 1;
        min-width: 0;
        padding: 0;
        background: transparent;
        box-shadow: none;
        border-radius: 0;

        .message-header {
          display: flex;
          align-items: baseline;
          gap: 8px;
          margin-bottom: 2px;

          .user-name {
            font-size: 13px;
            font-weight: 500;
          }

          .message-time {
            font-size: 11px;
            color: #909399;
            white-space: nowrap;
            font-weight: normal;
          }
        }

        .message-text {
          font-size: 14px;
          line-height: 1.5;
          color: #303133;
          word-break: break-word;
          white-space: pre-wrap;
        }
      }
      
      // 老师消息：用户名用蓝色
      &.is-teacher,
      &.is-teacher-sent {
        .message-content .message-header .user-name {
          color: #409eff;
        }
      }
      
      // 学生自己的消息：用户名用蓝色
      &.is-current-user {
        .message-content .message-header .user-name {
          color: #409eff;
        }
      }
      
      // 其他学生消息：用户名用灰色
      &:not(.is-teacher):not(.is-current-user):not(.is-teacher-sent) {
        .message-content .message-header .user-name {
          color: #909399;
        }
      }
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .chat-input {
    padding: 12px 16px;
    border-top: 1px solid #e5e7eb;
    background: #ffffff;

    :deep(.el-input) {
      .el-input__wrapper {
        border-radius: 20px;
        background: #f3f4f6;
        border: 1px solid transparent;
        box-shadow: none;
        transition: all 0.2s;

        &:hover {
          background: #e5e7eb;
        }

        &.is-focus {
          background: #ffffff;
          border-color: #4a8af4;
          box-shadow: 0 0 0 3px rgba(74, 138, 244, 0.1);
        }
      }

      .el-input__inner {
        padding: 10px 14px;
        font-size: 14px;
        color: #1f2937;

        &::placeholder {
          color: #9ca3af;
        }
      }
    }

    :deep(.el-button) {
      border-radius: 20px;
      background: #4a8af4;
      border: none;
      transition: background 0.2s;

      &:hover:not(:disabled) {
        background: #3b7ae8;
      }

      &:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
    }
  }
}
</style>





