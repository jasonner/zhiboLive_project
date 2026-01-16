<template>
  <div class="class-note">
    <div class="note-header">
      <div class="header-title">
        <el-icon class="note-icon"><Document /></el-icon>
        <span>随堂笔记</span>
      </div>
      <div class="header-actions">
        <el-button
          type="primary"
          size="small"
          :icon="DocumentChecked"
          @click="handleSave"
          :loading="saving"
        >
          保存
        </el-button>
      </div>
    </div>
    
    <div class="note-content">
      <el-input
        v-model="noteText"
        type="textarea"
        :rows="10"
        placeholder="在这里记录课堂笔记..."
        class="note-textarea"
        @input="handleInput"
        @blur="autoSave"
        resize="none"
      />
      <div class="note-footer">
        <span class="char-count">{{ noteText.length }} 字</span>
        <span v-if="lastSavedTime" class="save-time">
          <el-icon><Clock /></el-icon>
          已保存 {{ formatTime(lastSavedTime) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { Document, DocumentChecked, Clock } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { sendDataToMainApp, getMicroAppData } from '@/utils/microApp'

const noteText = ref('')
const saving = ref(false)
const lastSavedTime = ref<number | null>(null)
const autoSaveTimer = ref<NodeJS.Timeout | null>(null)

// 获取课堂ID和用户ID
const getRoomAndUserId = () => {
  const microAppData = getMicroAppData()
  const roomId = microAppData?.wsConfig?.roomId || new URLSearchParams(window.location.search).get('roomId') || 'default'
  const userId = microAppData?.wsConfig?.userId || (window as any).__USER_ID__ || 'default'
  return { roomId, userId }
}

// 生成存储键（基于课堂ID或用户ID）
const getStorageKey = (): string => {
  const { roomId, userId } = getRoomAndUserId()
  return `class_note_${roomId}_${userId}`
}

// 加载保存的笔记
const loadNote = () => {
  try {
    const saved = localStorage.getItem(getStorageKey())
    if (saved) {
      const data = JSON.parse(saved)
      noteText.value = data.text || ''
      lastSavedTime.value = data.savedTime || null
      console.log('[ClassNote] 已加载保存的笔记')
    }
  } catch (error) {
    console.error('[ClassNote] 加载笔记失败:', error)
  }
}

// 保存笔记
const saveNote = async (showMessage = true) => {
  if (saving.value) return
  
  saving.value = true
  try {
    const savedTime = Date.now()
    const { roomId, userId } = getRoomAndUserId()
    
    const data = {
      text: noteText.value,
      savedTime: savedTime
    }
    
    // 保存到本地存储
    localStorage.setItem(getStorageKey(), JSON.stringify(data))
    lastSavedTime.value = savedTime
    
    // 将笔记内容传递给主应用
    sendDataToMainApp({
      type: 'classNoteSaved',
      data: {
        noteText: noteText.value,
        savedTime: savedTime,
        roomId: roomId,
        userId: userId,
        charCount: noteText.value.length
      }
    })
    console.log('[ClassNote] 笔记已保存并发送给主应用:', {
      roomId,
      userId,
      charCount: noteText.value.length
    })
    
    if (showMessage) {
      ElMessage.success('笔记已保存')
    }
    
    console.log('[ClassNote] 笔记已保存')
  } catch (error) {
    console.error('[ClassNote] 保存笔记失败:', error)
    if (showMessage) {
      ElMessage.error('保存失败，请重试')
    }
  } finally {
    saving.value = false
  }
}

// 自动保存（延迟保存，避免频繁写入）
const autoSave = () => {
  if (autoSaveTimer.value) {
    clearTimeout(autoSaveTimer.value)
  }
  
  autoSaveTimer.value = setTimeout(() => {
    saveNote(false) // 自动保存不显示消息
  }, 1000) // 1秒后自动保存
}

// 手动保存
const handleSave = () => {
  saveNote(true)
}

// 输入处理
const handleInput = () => {
  // 输入时延迟自动保存
  autoSave()
}

// 格式化时间
const formatTime = (timestamp: number): string => {
  const now = Date.now()
  const diff = now - timestamp
  
  if (diff < 60000) {
    return '刚刚'
  } else if (diff < 3600000) {
    return `${Math.floor(diff / 60000)} 分钟前`
  } else if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)} 小时前`
  } else {
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
}

// 组件挂载时加载笔记
onMounted(() => {
  loadNote()
  
  // 页面卸载前保存
  window.addEventListener('beforeunload', () => {
    if (noteText.value.trim()) {
      saveNote(false)
    }
  })
})

// 清理定时器
watch(() => noteText.value, () => {
  // 输入变化时触发自动保存
  autoSave()
})
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.class-note {
  width: 100%;
  height: 100%;
  min-height: 300px;
  max-height: calc(100vh - 250px);
  background: $bg-color;
  border-radius: 8px;
  border: 1px solid $border-color;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);

  .note-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: linear-gradient(135deg, #f6f9ff 0%, #ffffff 100%);
    border-bottom: 1px solid $border-color;

    .header-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
      color: $text-primary;

      .note-icon {
        font-size: 18px;
        color: $primary-color;
      }
    }

    .header-actions {
      display: flex;
      gap: 8px;
    }
  }

  .note-content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;

    .note-textarea {
      flex: 1;
      border: none;
      resize: none;
      overflow: hidden;

      :deep(.el-textarea__inner) {
        border: none;
        padding: 16px;
        font-size: 14px;
        line-height: 1.6;
        color: $text-primary;
        background: $bg-color;
        resize: none;
        height: 100% !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
        overflow-y: auto;

        &:focus {
          border: none;
          box-shadow: none;
        }

        &::placeholder {
          color: $text-secondary;
        }

        // 自定义滚动条样式
        &::-webkit-scrollbar {
          width: 6px;
        }
        &::-webkit-scrollbar-track {
          background: transparent;
        }
        &::-webkit-scrollbar-thumb {
          background: $border-color;
          border-radius: 3px;
          &:hover {
            background: darken($border-color, 10%);
          }
        }
      }
    }

    .note-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background: $bg-secondary;
      border-top: 1px solid $border-color;
      font-size: 12px;
      color: $text-secondary;

      .char-count {
        font-weight: 500;
      }

      .save-time {
        display: flex;
        align-items: center;
        gap: 4px;
        color: $text-secondary;

        .el-icon {
          font-size: 12px;
        }
      }
    }
  }
}
</style>

