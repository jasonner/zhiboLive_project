<template>
  <div class="raise-hand-panel">
    <div class="panel-header">
      <span class="title">举手列表</span>
      <span class="count">({{ raiseHandRequests.length }})</span>
    </div>

    <div class="request-list" v-if="isTeacher">
      <div
        v-for="request in raiseHandRequests"
        :key="request.id"
        class="request-item"
      >
        <div class="request-info">
          <el-avatar :size="32" :src="request.avatar">
            {{ request.userName.charAt(0) }}
          </el-avatar>
          <div class="user-info">
            <div class="user-name">{{ request.userName }}</div>
            <div class="request-time">{{ formatTime(request.timestamp) }}</div>
          </div>
        </div>
        <div class="request-actions">
          <el-button
            type="primary"
            size="small"
            @click="handleAllow(request.userId)"
          >
            允许
          </el-button>
          <el-button
            size="small"
            @click="handleReject(request.userId)"
          >
            拒绝
          </el-button>
        </div>
      </div>

      <el-empty
        v-if="raiseHandRequests.length === 0"
        description="暂无举手申请"
        :image-size="80"
      />
    </div>

    <div class="student-actions" v-else>
      <el-button
        type="primary"
        :icon="User"
        @click="handleRaiseHand"
        :disabled="hasRaisedHand"
        style="width: 100%"
      >
        {{ hasRaisedHand ? '已举手' : '举手' }}
      </el-button>
      <el-button
        v-if="hasRaisedHand"
        @click="handleCancelRaiseHand"
        style="width: 100%; margin-top: 8px"
      >
        取消举手
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, type Ref } from 'vue'
import { User } from '@element-plus/icons-vue'
import { useLiveStore } from '@/store/liveStore'
import type { RaiseHandRequest } from '@/store/liveStore'
import type { SignalService } from '@/utils/signal'
import { getMicroAppData } from '@/utils/microApp'

interface Props {
  isTeacher?: boolean
  currentUserId?: string
}

const props = withDefaults(defineProps<Props>(), {
  isTeacher: false,
  currentUserId: 'student-001'
})

const store = useLiveStore()
// 从父组件注入 signalService
const signalServiceRef = inject<Ref<SignalService | null>>('signalService', ref(null))
const signalService = computed(() => signalServiceRef.value)

const raiseHandRequests = computed(() => store.raiseHandRequests)

const hasRaisedHand = computed(() => {
  return raiseHandRequests.value.some(r => r.userId === props.currentUserId)
})

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function handleRaiseHand() {
  const userId = props.currentUserId || 'student-001'
  // 从微前端主应用获取真实姓名
  const microAppData = getMicroAppData()
  const userName = microAppData?.wsConfig?.userName || '学生'
  const request: Omit<RaiseHandRequest, 'id' | 'timestamp'> = {
    userId,
    userName: userName,
    avatar: microAppData?.wsConfig?.avatar || ''
  }

  // 先添加到本地（用于学生端显示"已举手"状态）
  store.addRaiseHandRequest({
    ...request,
    id: Date.now().toString(),
    timestamp: Date.now()
  })

  // 通过 WebSocket 发送举手请求给教师端（使用后端 handUp 事件）
  const service = signalService.value
  if (service) {
    // 获取 classroomId
    const classroomId = service.currentClassroomId || 1
    const handUpData = {
      action: 'raise',
      userId,
      userName: request.userName,
      timestamp: Date.now()
    }
    console.log('[RaiseHand] 📤 发送举手请求:', handUpData)
    service.handUp(classroomId, handUpData)
  } else {
    console.warn('[RaiseHand] ⚠️ signalService 不可用，无法发送举手请求')
  }
}

function handleCancelRaiseHand() {
  const userId = props.currentUserId || 'student-001'
  
  // 从本地移除
  store.removeRaiseHandRequest(userId)
  
  // 通过 WebSocket 通知教师端取消举手（使用后端 handUp 事件）
  const service = signalService.value
  if (service) {
    // 获取 classroomId
    const classroomId = service.currentClassroomId || 1
    const handUpData = {
      action: 'cancel',
      userId,
      timestamp: Date.now()
    }
    console.log('[RaiseHand] 📤 发送取消举手请求:', handUpData)
    service.handUp(classroomId, handUpData)
  } else {
    console.warn('[RaiseHand] ⚠️ signalService 不可用，无法发送取消举手请求')
  }
}

function handleAllow(userId: string) {
  store.allowStudent(userId)
  
  // 通过 WebSocket 通知允许上麦
  const service = signalService.value
  if (service) {
    console.log('[RaiseHand] 📤 发送允许上麦通知:', userId)
    service.allowStudent(userId)
  } else {
    console.warn('[RaiseHand] ⚠️ signalService 不可用，无法发送允许上麦通知')
  }
}

function handleReject(userId: string) {
  store.removeRaiseHandRequest(userId)
  
  // 通过 WebSocket 通知拒绝（可选，服务器端可能不需要单独处理）
  // 因为移除请求已经通过 removeRaiseHandRequest 处理了
  console.log('[RaiseHand] 拒绝举手请求:', userId)
}
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.raise-hand-panel {
  background: $bg-color;
  border-top: 1px solid $border-color;
  height: 100%;
  display: flex;
  flex-direction: column;

  .panel-header {
    padding: 12px 16px;
    border-bottom: 1px solid $border-color;
    display: flex;
    align-items: center;
    gap: 8px;

    .title {
      font-size: 14px;
      font-weight: 500;
      color: $text-primary;
    }

    .count {
      font-size: 12px;
      color: $text-secondary;
    }
  }

  .request-list {
    flex: 1;
    overflow-y: auto;
    padding: 12px;

    .request-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px;
      background: $secondary-color;
      border-radius: 6px;
      margin-bottom: 8px;

      .request-info {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;

        .user-info {
          .user-name {
            font-size: 14px;
            color: $text-primary;
            font-weight: 500;
          }

          .request-time {
            font-size: 12px;
            color: $text-secondary;
            margin-top: 4px;
          }
        }
      }

      .request-actions {
        display: flex;
        gap: 8px;
      }
    }
  }

  .student-actions {
    padding: 16px;
  }
}
</style>
