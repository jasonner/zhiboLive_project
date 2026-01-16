<template>
  <div class="top-nav-bar">
    <div class="nav-left">
      <div class="logo">
        <el-icon><VideoCamera /></el-icon>
        <span class="logo-text">教学直播间</span>
      </div>
      <div class="course-name">{{ courseName }}</div>
    </div>

    <div class="nav-center">
      <div class="status-item">
        <el-icon><User /></el-icon>
        <span>在线: {{ onlineCount }}人</span>
      </div>
      <div class="status-item" :class="networkStatus">
        <el-icon><Connection /></el-icon>
        <span v-if="wsDisconnected" class="ws-disconnected-warning">连接已断开</span>
        <span v-else>{{ networkStatusText }}</span>
        <span class="network-detail" v-if="networkDelay > 0 && !wsDisconnected">
          ({{ networkDelay }}ms / {{ formatBitrate(networkBitrate) }})
        </span>
      </div>
      <div class="status-item timer">
        <el-icon><Timer /></el-icon>
        <span>{{ formatTime }}</span>
      </div>
    </div>

    <div class="nav-right">
      <el-button
        type="danger"
        :icon="isLive ? VideoPlay : VideoPause"
        @click="handleStopLive"
        v-if="isTeacher"
      >
        {{ isLive ? '结束直播' : '开始直播' }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, type Ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { VideoCamera, User, Connection, Timer, VideoPlay, VideoPause } from '@element-plus/icons-vue'
import { useLiveStore } from '@/store/liveStore'
import type { SignalService } from '@/utils/signal'

interface Props {
  isTeacher?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isTeacher: false
})

const store = useLiveStore()
// 从父组件注入 signalService（教师端才有）
const signalServiceRef = inject<Ref<SignalService | null>>('signalService', ref(null))
const signalService = computed(() => signalServiceRef.value)
// 从父组件注入开启摄像头函数（教师端才有）
const toggleCameraRef = inject<Ref<(() => Promise<void>) | null>>('toggleCamera', ref(null))
const toggleCamera = computed(() => toggleCameraRef.value)

const courseName = computed(() => store.courseName)
const onlineCount = computed(() => store.onlineCount)
const networkStatus = computed(() => store.networkStatus)
const networkDelay = computed(() => store.networkDelay)
const networkBitrate = computed(() => store.networkBitrate)
const wsDisconnected = computed(() => store.wsDisconnected)
const formatTime = computed(() => store.formatTime)
const isLive = computed(() => store.isLive)

const networkStatusText = computed(() => {
  const statusMap = {
    good: '网络良好',
    normal: '网络一般',
    poor: '网络较差'
  }
  return statusMap[networkStatus.value]
})

function formatBitrate(bitrate: number): string {
  if (bitrate < 1000) {
    return `${bitrate} bps`
  } else if (bitrate < 1000000) {
    return `${(bitrate / 1000).toFixed(1)} Kbps`
  } else {
    return `${(bitrate / 1000000).toFixed(1)} Mbps`
  }
}

async function handleStopLive() {
  const service = signalService.value
  const enableCamera = toggleCamera.value
  if (!store.isLive) {
    // 开始直播
    const startTime = Date.now()
    store.startLive()
    // 通过 WebSocket 通知学生端（使用后端 lesson 事件）
    if (service) {
      console.log('[TopNavBar] 准备发送开始直播事件，signalService 可用')
      // 发送 lesson 事件通知学生端（开启直播）
      service.startLive()
      console.log('[TopNavBar] ✅ 已发送 lesson 事件（开启直播），开始时间:', new Date(startTime).toLocaleString())
    } else {
      console.error('[TopNavBar] ❌ signalService 不可用，无法同步直播状态')
    }
    // 同时开启摄像头
    if (enableCamera && !store.cameraEnabled) {
      console.log('[TopNavBar] 开启直播时，同时开启摄像头')
      // 先设置摄像头状态为启用
      store.cameraEnabled = true
      try {
        await enableCamera()
        console.log('[TopNavBar] ✅ 摄像头已开启')
      } catch (error) {
        console.error('[TopNavBar] ❌ 开启摄像头失败:', error)
        // 如果失败，恢复状态
        store.cameraEnabled = false
      }
    }
    return
  }

  ElMessageBox.confirm('确定要结束直播吗？', '提示', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  })
    .then(() => {
      store.stopLive()
      // 通过 WebSocket 通知学生端（使用后端 finishClass 事件）
      if (service) {
        service.stopLive()
        console.log('[TopNavBar] ✅ 已发送 finishClass 事件（下播）')
      } else {
        console.error('[TopNavBar] ❌ signalService 不可用，无法同步直播状态')
      }
      // 这里可以触发路由跳转到总结页
    })
    .catch(() => {})
}
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.top-nav-bar {
  height: 60px;
  background: $bg-color;
  border-bottom: 1px solid $border-color;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);

  .nav-left {
    display: flex;
    align-items: center;
    gap: 20px;

    .logo {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 18px;
      font-weight: 600;
      color: $primary-color;

      .el-icon {
        font-size: 24px;
      }
    }

    .course-name {
      font-size: 16px;
      color: $text-primary;
      font-weight: 500;
    }
  }

  .nav-center {
    display: flex;
    align-items: center;
    gap: 30px;

    .status-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      color: $text-secondary;

      &.good {
        color: #67c23a;
      }

      &.normal {
        color: #e6a23c;
      }

      &.poor {
        color: #f56c6c;
      }

      .ws-disconnected-warning {
        color: #f56c6c;
        font-weight: 500;
        animation: blink 1.5s infinite;
      }

      &.timer {
        color: $primary-color;
        font-weight: 500;
      }

      .network-detail {
        font-size: 12px;
        color: $text-secondary;
      }
    }
  }

  .nav-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }
}

@keyframes blink {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>


