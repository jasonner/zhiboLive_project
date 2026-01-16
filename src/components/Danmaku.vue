<template>
  <div class="danmaku-container" ref="containerRef" v-if="danmakuEnabled">
    <div
      v-for="(line, lineIndex) in danmakuLines"
      :key="lineIndex"
      class="danmaku-line"
      :style="{ top: `${lineIndex * lineHeight + 20}px` }"
    >
      <transition-group name="danmaku" tag="div" class="danmaku-items">
        <div
          v-for="item in line.items"
          :key="item.id"
          class="danmaku-item"
          :class="{ 'is-teacher': item.isTeacher }"
          :style="getItemStyle(item)"
        >
          <span class="danmaku-user">{{ item.userName }}:</span>
          <span class="danmaku-content">{{ item.content }}</span>
        </div>
      </transition-group>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useLiveStore } from '@/store/liveStore'
import type { ChatMessage } from '@/store/liveStore'

interface Props {
  messages?: ChatMessage[]
}

interface DanmakuItem extends ChatMessage {
  lineIndex: number
  animationDuration: number
  startTime: number
}

interface DanmakuLine {
  items: DanmakuItem[]
}

const props = withDefaults(defineProps<Props>(), {
  messages: () => []
})

const store = useLiveStore()
const danmakuEnabled = computed(() => store.danmakuEnabled)

// 弹幕配置
const maxLines = 4
const lineHeight = 50 // 每行高度（px）
const minSpeed = 100 // 最小滚动速度（px/s）
const maxSpeed = 150 // 最大滚动速度（px/s）
const minDuration = 8 // 最小动画时长（秒）
const maxDuration = 15 // 最大动画时长（秒）

// 弹幕行数据
const danmakuLines = ref<DanmakuLine[]>(
  Array.from({ length: maxLines }, () => ({ items: [] }))
)

// 容器宽度（用于计算动画时长）
const containerWidth = ref(0)
const containerRef = ref<HTMLElement | null>(null)

// 计算弹幕项样式
function getItemStyle(item: DanmakuItem) {
  const duration = item.animationDuration
  const delay = Math.max(0, (item.startTime - Date.now()) / 1000)
  return {
    animationDuration: `${duration}s`,
    animationDelay: `${delay}s`
  }
}

// 计算动画时长（根据内容长度和容器宽度）
function calculateDuration(content: string, containerWidth: number): number {
  // 估算文本宽度（每个字符约 12px，加上用户名和冒号）
  const textWidth = (content.length + 20) * 12
  const totalDistance = containerWidth + textWidth
  
  // 根据距离计算时长，速度在 minSpeed 到 maxSpeed 之间随机
  const speed = minSpeed + Math.random() * (maxSpeed - minSpeed)
  const duration = totalDistance / speed
  
  // 限制在最小和最大时长之间
  return Math.max(minDuration, Math.min(maxDuration, duration))
}

// 选择最合适的行（选择当前项目最少的行，如果相同则随机选择）
function selectBestLine(): number {
  let minCount = Infinity
  const candidates: number[] = []
  
  for (let i = 0; i < danmakuLines.value.length; i++) {
    const count = danmakuLines.value[i].items.length
    if (count < minCount) {
      minCount = count
      candidates.length = 0
      candidates.push(i)
    } else if (count === minCount) {
      candidates.push(i)
    }
  }
  
  // 如果有多个候选行，随机选择一个
  return candidates[Math.floor(Math.random() * candidates.length)]
}

// 添加弹幕
function addDanmaku(message: ChatMessage) {
  console.log('[Danmaku] 🎬 添加弹幕:', {
    id: message.id,
    userName: message.userName,
    content: message.content.substring(0, 30),
    isTeacher: message.isTeacher,
    containerWidth: containerWidth.value
  })
  
  if (!containerWidth.value) {
    // 如果容器宽度未初始化，延迟添加
    console.log('[Danmaku] ⏳ 容器宽度未初始化，延迟添加弹幕')
    setTimeout(() => addDanmaku(message), 100)
    return
  }
  
  const lineIndex = selectBestLine()
  const duration = calculateDuration(message.content, containerWidth.value)
  
  const danmakuItem: DanmakuItem = {
    ...message,
    lineIndex,
    animationDuration: duration,
    startTime: Date.now()
  }
  
  danmakuLines.value[lineIndex].items.push(danmakuItem)
  console.log('[Danmaku] ✅ 弹幕已添加到第', lineIndex, '行，当前该行有', danmakuLines.value[lineIndex].items.length, '条弹幕')
  
  // 动画结束后移除（延迟一点确保动画完成）
  setTimeout(() => {
    const line = danmakuLines.value[lineIndex]
    const index = line.items.findIndex(item => item.id === message.id)
    if (index !== -1) {
      line.items.splice(index, 1)
      console.log('[Danmaku] 🗑️ 弹幕已移除:', message.id)
    }
  }, duration * 1000 + 1000)
}

// 更新容器宽度
function updateContainerWidth() {
  if (containerRef.value) {
    containerWidth.value = containerRef.value.offsetWidth
  }
}

// 监听消息变化
const processedMessageIds = ref<Set<string>>(new Set())
watch(() => props.messages, (newMessages) => {
  console.log('[Danmaku] 📊 消息变化监听触发:', {
    totalMessages: newMessages.length,
    processedCount: processedMessageIds.value.size,
    messages: newMessages.map(m => ({ id: m.id, content: m.content.substring(0, 20), isTeacher: m.isTeacher }))
  })
  
  // 找出未处理的新消息
  const newMessagesList = newMessages.filter(message => {
    if (processedMessageIds.value.has(message.id)) {
      return false
    }
    // 只处理文本消息
    if (message.type === 'text' && message.content.trim()) {
      processedMessageIds.value.add(message.id)
      console.log('[Danmaku] ✅ 发现新消息，准备显示为弹幕:', {
        id: message.id,
        userName: message.userName,
        content: message.content.substring(0, 30),
        isTeacher: message.isTeacher
      })
      return true
    }
    return false
  })
  
  console.log('[Danmaku] 📊 新消息列表:', {
    count: newMessagesList.length,
    messages: newMessagesList.map(m => ({ id: m.id, content: m.content.substring(0, 20) }))
  })
  
  // 添加新弹幕（只有在弹幕开启时才添加）
  if (danmakuEnabled.value) {
    newMessagesList.forEach(message => {
      addDanmaku(message)
    })
  } else {
    console.log('[Danmaku] 🚫 弹幕已关闭，跳过添加弹幕')
  }
  
  // 清理过期的消息ID（保留最近100条）
  if (processedMessageIds.value.size > 100) {
    const recentIds = new Set(
      newMessages.slice(-100).map(m => m.id)
    )
    processedMessageIds.value = recentIds
  }
}, { immediate: false, deep: true })

onMounted(() => {
  updateContainerWidth()
  window.addEventListener('resize', updateContainerWidth)
  
  console.log('[Danmaku] 🚀 弹幕组件已挂载:', {
    containerWidth: containerWidth.value,
    messagesCount: props.messages.length,
    messages: props.messages.map(m => ({ id: m.id, content: m.content.substring(0, 20), isTeacher: m.isTeacher }))
  })
  
  // 初始化已处理的消息ID（处理现有消息，但不显示为弹幕）
  // 只标记为已处理，不显示，因为弹幕应该只显示新消息
  if (props.messages.length > 0) {
    props.messages.forEach(message => {
      if (message.type === 'text' && message.content.trim()) {
        processedMessageIds.value.add(message.id)
      }
    })
    console.log('[Danmaku] 📝 已标记', processedMessageIds.value.size, '条现有消息为已处理')
  }
  
  // 延迟一下，确保容器宽度已更新
  setTimeout(() => {
    updateContainerWidth()
    console.log('[Danmaku] 📏 容器宽度已更新:', containerWidth.value)
  }, 100)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateContainerWidth)
})
</script>

<style scoped lang="scss">
.danmaku-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 200;
  overflow: hidden;
}

.danmaku-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 50px;
  overflow: hidden;
}

.danmaku-items {
  position: relative;
  width: 100%;
  height: 100%;
}

.danmaku-item {
  position: absolute;
  white-space: nowrap;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 20px;
  color: #fff;
  font-size: 14px;
  line-height: 1.4;
  backdrop-filter: blur(4px);
  animation: danmaku-move linear forwards;
  pointer-events: none;
  will-change: transform, left; // 优化动画性能
  top: 50%;
  transform: translateY(-50%); // 垂直居中
  
  &.is-teacher {
    background: rgba(64, 158, 255, 0.7);
    border: 1px solid rgba(64, 158, 255, 0.9);
  }
  
  .danmaku-user {
    font-weight: 500;
    margin-right: 4px;
    color: #ffd700;
    
    .is-teacher & {
      color: #fff;
    }
  }
  
  .danmaku-content {
    color: #fff;
  }
}

@keyframes danmaku-move {
  0% {
    left: 100%; // 从容器右边开始（元素左边缘在容器右边缘）
    transform: translateY(-50%);
  }
  100% {
    left: -200%; // 移动到容器左边完全移出（元素左边缘移出容器左边缘，使用-200%确保即使是很长的弹幕也能完全消失）
    transform: translateY(-50%);
  }
}

// 过渡动画
.danmaku-enter-active,
.danmaku-leave-active {
  transition: opacity 0.3s;
}

.danmaku-enter-from,
.danmaku-leave-to {
  opacity: 0;
}
</style>

