<template>
  <div class="student-room">
    <TopNavBar :is-teacher="false" />

    <div class="room-content">
      <!-- 左侧：老师视频缩略 -->
      <div class="left-panel">
        <div class="teacher-video-mini">
          <LiveVideo :stream="teacherStream" :user-name="'老师'" :is-small="true" />
          <div v-if="!teacherStream" class="video-placeholder-overlay">
            <el-icon>
              <VideoCamera />
            </el-icon>
            <p>等待老师开启摄像头</p>
          </div>
        </div>
        <!-- 随堂笔记 -->
        <ClassNote />
      </div>

      <!-- 中央主讲区 -->
      <div class="center-panel">
        <ControlBar :course-name="store.courseName" :online-count="store.onlineCount" />
        <div class="video-area-wrapper">
          <VideoArea
            ref="videoAreaRef"
            :display-mode="displayMode"
            :current-document="currentDocument"
            :teacher-stream="teacherStream"
            :screen-stream="screenStream"
            :chat-messages="store.chatMessages"
          />
        </div>
      </div>

      <!-- 右侧互动区 -->
      <div class="right-panel">
        <el-tabs v-model="activeTab" class="interaction-tabs">
          <el-tab-pane label="聊天" name="chat">
            <ChatPanel :is-teacher="false" :current-user-id="currentUserId" />
          </el-tab-pane>
          <el-tab-pane label="举手" name="raiseHand">
            <RaiseHand :is-teacher="false" :current-user-id="currentUserId" />
          </el-tab-pane>
          <el-tab-pane label="课堂工具" name="classroomTools">
            <ClassroomToolsPanel :is-teacher="false" :current-user-id="currentUserId" />
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>

    <!-- 投票弹窗 -->
    <el-dialog
      v-model="showVoteDialog"
      :title="currentVoteData?.title || '投票'"
      width="500px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <div v-if="currentVoteData" class="vote-dialog-content">
        <div v-if="currentVoteData.content" class="vote-content-text" style="margin-bottom: 16px; color: #666;">
          {{ currentVoteData.content }}
        </div>
        <div
          v-if="hasVoted"
          style="margin-bottom: 16px; padding: 12px; background: #f0f9ff; border: 1px solid #b3d8ff; border-radius: 4px; color: #409eff;"
        >
          <el-icon>
            <Check />
          </el-icon>
          <span style="margin-left: 8px;">您已经投过票了</span>
        </div>
        <el-radio-group v-model="selectedVoteOption" style="width: 100%" :disabled="hasVoted">
          <el-radio
            v-for="(option, index) in currentVoteData.options"
            :key="index"
            :label="index"
            style="display: block; margin-bottom: 12px; padding: 8px; border: 1px solid #e4e7ed; border-radius: 4px;"
          >
            {{ index + 1 }}. {{ option }}
          </el-radio>
        </el-radio-group>
      </div>
      <template #footer>
        <el-button @click="handleCancelVote">关闭</el-button>
        <el-button
          v-if="!hasVoted && isVoteActive"
          type="primary"
          @click="handleSubmitVote"
          :disabled="selectedVoteOption === null"
        >
          提交投票
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref } from 'vue'
import { Check, VideoCamera } from '@element-plus/icons-vue'
import { useLiveStore } from '@/store/liveStore'
import { getMicroAppData } from '@/utils/microApp'
import TopNavBar from '@/components/TopNavBar.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import ClassNote from '@/components/ClassNote.vue'
import ClassroomToolsPanel from '@/components/ClassroomToolsPanel.vue'
import ControlBar from '@/components/ControlBar.vue'
import LiveVideo from '@/components/LiveVideo.vue'
import RaiseHand from '@/components/RaiseHand.vue'
import VideoArea from '@/components/VideoArea.vue'
import { useMediaStream } from '@/composables/useMediaStream'
import { useRoomLifecycle } from '@/composables/useRoomLifecycle'
import { useRoomSocket } from '@/composables/useRoomSocket'
import { useRoomState } from '@/composables/useRoomState'

const store = useLiveStore()

const activeTab = ref('chat')
const videoAreaRef = ref<InstanceType<typeof VideoArea> | null>(null)

// micro-app 基础信息
const microAppData = getMicroAppData()
const currentUserId = ref<string | undefined>(microAppData?.wsConfig?.userId)
store.setCourseName(microAppData?.data?.name || '')

// 投票相关状态
const showVoteDialog = ref(false)
const currentVoteData = ref<{
  voteId?: string
  title: string
  content?: string
  duration?: number
  options: string[]
  createdAt?: number
} | null>(null)
const selectedVoteOption = ref<number | null>(null)

const hasVoted = computed(() => {
  if (!currentVoteData.value?.voteId || !currentUserId.value) return false
  return store.hasUserVoted(currentVoteData.value.voteId, currentUserId.value.toString())
})

const isVoteActive = computed(() => {
  if (!currentVoteData.value?.voteId) return false
  const voteId = currentVoteData.value.voteId
  const vote = store.votes.find(v => v.id === voteId)
  return vote ? vote.isActive : false
})

function handleSubmitVote() {
  const service = signalServiceRef.value
  if (!currentVoteData.value || selectedVoteOption.value === null || !service) return

  const classroomId = service.currentClassroomId || 1
  const voteId = currentVoteData.value.voteId
  if (!voteId) return

  const voteData = {
    voteId,
    userId: currentUserId.value,
    option: selectedVoteOption.value,
    timestamp: Date.now()
  }

  service.sendVote(classroomId, voteData)

  if (currentUserId.value) {
    const userId = currentUserId.value.toString()
    if (!store.hasUserVoted(voteId, userId)) {
      const vote = store.votes.find(v => v.id === voteId)
      if (vote) {
        store.submitVote(voteId, selectedVoteOption.value, userId)
      }
    }
  }

  showVoteDialog.value = false
  selectedVoteOption.value = null
  currentVoteData.value = null

  if (store.currentVote && store.currentVote.id === voteId) {
    store.currentVote = null
  }
}

function handleCancelVote() {
  showVoteDialog.value = false
  selectedVoteOption.value = null
}

// 房间生命周期
const { rtcManager, signalService, signalServiceRef, initRTCAndNetwork, initWebSocket, joinRoomAfterConnection, cleanup } =
  useRoomLifecycle()

provide('signalService', signalServiceRef)

// UI 状态
const { displayMode, currentDocument, teacherStream, screenStream, setupStateWatchers } = useRoomState()

// 白板实例（从 `VideoArea` expose）
const whiteboardInstanceRef = computed(() => (videoAreaRef.value as any)?.whiteboardRef?.value ?? null)

// 媒体流
const mediaStream = useMediaStream(rtcManager, signalService, currentUserId)

const roomSocket = useRoomSocket(
  rtcManager,
  signalService,
  currentUserId,
  showVoteDialog,
  currentVoteData,
  selectedVoteOption,
  whiteboardInstanceRef,
  mediaStream.parseStreamTypeFromSDP,
  mediaStream.trackStreamTypeMap,
  mediaStream.knownCameraTrackIds,
  () => mediaStream.screenShareStartTime(),
  (time: number) => mediaStream.setScreenShareStartTime(time),
  () => mediaStream.currentStreamType(),
  (type: 'camera' | 'screen' | null) => mediaStream.setCurrentStreamType(type),
  mediaStream.getOnTrackCallback
)

onMounted(async () => {
  initRTCAndNetwork()

  mediaStream.restoreStreamState()
  mediaStream.setupTrackCallback()
  mediaStream.setupPageRefreshTrackRecovery()
  mediaStream.setupIceCandidateHandler()

  initWebSocket()

  setupStateWatchers()
  roomSocket.setupSignalListeners()

  await joinRoomAfterConnection()
})

onUnmounted(() => {
  roomSocket.cleanupSignalListeners()
  cleanup()
})
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.student-room {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: $bg-secondary;

  .room-content {
    flex: 1;
    display: flex;
    overflow: hidden;

    .left-panel {
      width: 240px;
      padding: 16px;
      padding-top: 0;
      background: $bg-color;
      border-right: 1px solid $border-color;
      display: flex;
      flex-direction: column;
      overflow: hidden;

      .teacher-video-mini {
        position: relative;
        width: 240px;
        height: 180px;
        margin-left: -16px;
        margin-right: -16px;
        margin-top: 0;
        overflow: hidden;
        background: #000;
        margin-bottom: 12px;
        flex-shrink: 0;

        .video-placeholder-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: rgba(26, 26, 26, 0.9);
          color: $text-secondary;
          z-index: 10;
          pointer-events: none;

          .el-icon {
            font-size: 48px;
            margin-bottom: 12px;
          }

          p {
            font-size: 14px;
          }
        }
      }

      // 随堂笔记组件样式
      :deep(.class-note) {
        flex: 1;
        min-height: 300px;
        max-height: calc(100vh - 250px);
        display: flex;
        flex-direction: column;
        margin-top: 0;
        overflow: hidden;
      }
    }

    .center-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #000;
      padding: 16px;

      .video-area-wrapper {
        flex: 1;
        min-height: 0;
        margin-top: 12px;
      }
    }

    .right-panel {
      width: 320px;
      display: flex;
      flex-direction: column;
      background: $bg-color;
      border-left: 1px solid $border-color;

      .interaction-tabs {
        flex: 1;
        display: flex;
        flex-direction: column;

        :deep(.el-tabs__content) {
          flex: 1;
          overflow: hidden;
        }

        :deep(.el-tab-pane) {
          height: 100%;
        }
      }
    }
  }
}
</style>
