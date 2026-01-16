<template>
  <div class="student-room">
    <TopNavBar :is-teacher="false" />

    <div class="room-content">
      <!-- 左侧：老师视频缩略 -->
      <div class="left-panel">
        <div class="teacher-video-mini">
          <LiveVideo
            :stream="teacherStream"
            :user-name="'老师'"
            :is-small="true"
          />
          <div v-if="!teacherStream" class="video-placeholder-overlay">
            <el-icon><VideoCamera /></el-icon>
            <p>等待老师开启摄像头</p>
          </div>
        </div>
        <!-- 随堂笔记 -->
        <ClassNote />
      </div>

      <!-- 中央主讲区 -->
      <div class="center-panel">
        <div class="main-display" ref="mainDisplayRef">
          <!-- 白板模式 -->
          <div v-if="displayMode === 'whiteboard'" class="display-container">
            <Whiteboard
              ref="whiteboardRef"
              :is-teacher="false"
            />
          </div>

          <!-- 屏幕共享模式 -->
          <div v-else-if="displayMode === 'screen'" class="display-container">
            <LiveVideo
              :stream="screenStream"
              :is-small="false"
            />
            <!-- 隐藏的音频播放器，用于播放摄像头流的音频（如果屏幕共享流没有音频） -->
            <LiveVideo
              v-if="teacherStream && teacherStream.getAudioTracks().length > 0 && (!screenStream || screenStream.getAudioTracks().length === 0)"
              :stream="teacherStream"
              :is-small="false"
              style="position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; z-index: -1;"
            />
            <div v-if="!screenStream" class="video-placeholder-overlay">
              <el-icon><VideoCamera /></el-icon>
              <p>等待老师开启屏幕共享</p>
            </div>
          </div>

          <!-- 文档/视频模式 -->
          <div v-else class="document-video-container">
            <DocumentViewer :document="currentDocument" />
          </div>
          
          <!-- 弹幕组件 -->
          <Danmaku :messages="store.chatMessages" />
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
        <div v-if="hasVoted" style="margin-bottom: 16px; padding: 12px; background: #f0f9ff; border: 1px solid #b3d8ff; border-radius: 4px; color: #409eff;">
          <el-icon><Check /></el-icon>
          <span style="margin-left: 8px;">您已经投过票了</span>
        </div>
        <el-radio-group
          v-model="selectedVoteOption"
          style="width: 100%"
          :disabled="hasVoted"
        >
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
import { ref, computed, onMounted, onUnmounted, watch, provide } from 'vue'
import { VideoCamera, Check } from '@element-plus/icons-vue'
import { useLiveStore, type Document, type Vote, type DisplayMode } from '@/store/liveStore'
import { RTCManager } from '@/utils/rtc'
import { SignalService } from '@/utils/signal'
import { getMicroAppData, onMicroAppDataChange, isMicroApp, sendDataToMainApp } from '@/utils/microApp'
import { NetworkMonitor } from '@/utils/networkMonitor'
import { logger } from '@/utils/logger'
import TopNavBar from '@/components/TopNavBar.vue'
import LiveVideo from '@/components/LiveVideo.vue'
import DocumentViewer from '@/components/DocumentViewer.vue'
import Whiteboard from '@/components/Whiteboard.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import RaiseHand from '@/components/RaiseHand.vue'
import ClassroomToolsPanel from '@/components/ClassroomToolsPanel.vue'
import Danmaku from '@/components/Danmaku.vue'
import ClassNote from '@/components/ClassNote.vue'

const store = useLiveStore()

const activeTab = ref('chat')
const whiteboardRef = ref<InstanceType<typeof Whiteboard> | null>(null)
const mainDisplayRef = ref<HTMLElement | null>(null)

// 优先从 micro-app 主应用获取 userId，否则使用默认值
const microAppData = getMicroAppData()
const currentUserId = ref(microAppData?.wsConfig?.userId)
const CourseName = ref(microAppData?.data?.name)
store.setCourseName(CourseName.value)
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

// 检查当前投票是否已投票
const hasVoted = computed(() => {
  if (!currentVoteData.value?.voteId || !currentUserId.value) return false
  return store.hasUserVoted(currentVoteData.value.voteId, currentUserId.value.toString())
})

// 检查当前投票是否还在进行中
const isVoteActive = computed(() => {
  if (!currentVoteData.value?.voteId) return false
  const voteId = currentVoteData.value.voteId
  const vote = store.votes.find(v => v.id === voteId)
  return vote ? vote.isActive : false
})

const displayMode = computed(() => store.displayMode)
const currentDocument = computed(() => store.currentDocument)
const isLive = computed(() => store.isLive)

// 监听 displayMode 变化
watch(() => store.displayMode, () => {
  // 显示模式变化时的处理逻辑（如果需要）
}, { immediate: true })

// 监听 screenStream 变化
watch(() => store.screenStream, () => {
  // 屏幕流变化时的处理逻辑（如果需要）
}, { immediate: true, deep: true })

// 监听 currentDocument 变化
watch(() => store.currentDocument, () => {
  // 文档变化时的处理逻辑（如果需要）
}, { immediate: true })

// 从 store 获取流
const teacherStream = computed(() => store.teacherStream)
const screenStream = computed(() => store.screenStream)

let rtcManager: RTCManager | null = null
let signalService: SignalService | null = null
let networkMonitor: NetworkMonitor | null = null

// 记录屏幕共享开始的时间戳，用于识别后到达的屏幕共享轨道
let screenShareStartTime = 0
// 记录已识别的摄像头轨道ID，用于区分新轨道
const knownCameraTrackIds = new Set<string>()
// 记录当前 Offer/ICE 对应的流类型（用于在 ontrack 回调中识别轨道类型）
let currentStreamType: 'camera' | 'screen' | null = null
// 方案B：从 SDP 中解析的轨道类型映射（trackId -> streamType）
const trackStreamTypeMap = new Map<string, 'camera' | 'screen'>()

// 提供 signalService 给子组件使用（学生端也需要，使用 ref 以便后续更新）
const signalServiceRef = ref<SignalService | null>(null)
provide('signalService', signalServiceRef)

// 处理提交投票
function handleSubmitVote() {
  const service = signalServiceRef.value
  if (!currentVoteData.value || selectedVoteOption.value === null || !service) {
    console.warn('[StudentRoom] ⚠️ 无法提交投票：数据不完整', {
      hasVoteData: !!currentVoteData.value,
      hasSelectedOption: selectedVoteOption.value !== null,
      hasSignalService: !!service
    })
    return
  }

  const classroomId = service.currentClassroomId || 1
  const voteId = currentVoteData.value.voteId
  if (!voteId) {
    console.warn('[StudentRoom] ⚠️ 投票ID不存在')
    return
  }
  
  const voteData = {
    voteId: voteId,
    userId: currentUserId.value,
    option: selectedVoteOption.value,
    timestamp: Date.now()
  }
  
  console.log('[StudentRoom] 📤 提交投票:', voteData)
  service.sendVote(classroomId, voteData)
  
  // 更新本地投票统计（如果投票在 store 中）
  if (currentUserId.value) {
    const userId = currentUserId.value.toString()
    
    // 检查是否已投票
    if (store.hasUserVoted(voteId, userId)) {
      console.warn('[StudentRoom] ⚠️ 您已经投过票了，不能重复投票')
      return
    }
    
    const vote = store.votes.find(v => v.id === voteId)
    if (vote) {
      store.submitVote(voteId, selectedVoteOption.value, userId)
      console.log('[StudentRoom] ✅ 已更新本地投票统计')
    }
  }
  
  // 关闭弹窗并清除投票数据
  showVoteDialog.value = false
  selectedVoteOption.value = null
  // 清除当前投票数据，因为已经投过票了
  currentVoteData.value = null
  
  // 清除 store 中的 currentVote（仅学生端，已投票后不再显示）
  if (store.currentVote && store.currentVote.id === voteId) {
    store.currentVote = null
  }
  
  console.log('[StudentRoom] ✅ 投票已提交，投票记录已保存')
}

// 处理取消投票
function handleCancelVote() {
  // 只关闭弹窗，不清空投票数据，这样投票会保留在 store 中，可以在投票列表中查看
  showVoteDialog.value = false
  selectedVoteOption.value = null
  // 不清空 currentVoteData，保留投票信息以便在投票列表中查看
  console.log('[StudentRoom] 已取消投票，投票记录已保存')
}

// 保存 ontrack 回调函数，以便在重新创建 RTCManager 时复用
let onTrackCallback: (() => void) | null = null

/**
 * 方案B：从 SDP 中解析 stream-type 标识
 * 返回媒体行索引 -> streamType 的映射
 * 注意：stream-type 标识可能在媒体行（m=）之后的任意位置
 */
function parseStreamTypeFromSDP(sdp: string): Map<string, 'camera' | 'screen'> {
  const streamTypeMap = new Map<string, 'camera' | 'screen'>()
  // 处理不同的 SDP 分隔符（\r\n 或 \n）
  const lines = sdp.split(/\r?\n/)
  let mediaLineIndex = -1
  let currentMediaIndex = -1
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    // 检测媒体行（m=video 或 m=audio）
    if (line.startsWith('m=')) {
      mediaLineIndex++
      currentMediaIndex = mediaLineIndex
      
      // 在当前媒体块中查找 stream-type 标识
      // stream-type 标识可能在媒体行之后的任意位置，直到下一个媒体行或会话结束
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j]
        
        // 如果遇到下一个媒体行，停止搜索
        if (nextLine.startsWith('m=')) {
          break
        }
        
        // 如果找到 stream-type 标识
        if (nextLine.startsWith('a=stream-type:')) {
          const streamType = nextLine.substring('a=stream-type:'.length).trim() as 'camera' | 'screen'
          streamTypeMap.set(currentMediaIndex.toString(), streamType)
          console.log('[StudentRoom] ✅ 从 SDP 解析到 stream-type:', {
            mediaLineIndex: currentMediaIndex,
            streamType,
            mediaLine: line,
            streamTypeLine: nextLine,
            lineIndex: j
          })
          break // 找到后停止搜索当前媒体块
        }
      }
      
      // 如果没有找到 stream-type 标识，默认为 camera（兼容旧版本）
      if (!streamTypeMap.has(currentMediaIndex.toString())) {
        console.log('[StudentRoom] ⚠️ 媒体行没有 stream-type 标识，默认为 camera:', {
          mediaLineIndex: currentMediaIndex,
          mediaLine: line
        })
      }
    }
  }
  
  console.log('[StudentRoom] 📌 SDP 解析结果:', Array.from(streamTypeMap.entries()))
  return streamTypeMap
}

onMounted(async () => {
  // 初始化 WebRTC
  rtcManager = new RTCManager()
  
  // 初始化网络状态监听器
  networkMonitor = new NetworkMonitor(store, signalService, rtcManager)
  
  // 重要：页面刷新后，需要恢复流状态
  // 1. 如果 store 中显示模式是 'screen'，说明屏幕共享正在进行
  // 2. 无论显示模式是什么，如果教师端开启了摄像头，都需要恢复摄像头流
  // 3. 需要恢复屏幕共享状态，以便正确识别屏幕共享轨道
  console.log('[StudentRoom] 🔄 页面刷新后，检查需要恢复的流状态:', {
    displayMode: store.displayMode,
    hasTeacherStream: !!store.teacherStream,
    hasScreenStream: !!store.screenStream
  })
  
  if (store.displayMode === 'screen') {
    console.log('[StudentRoom] 🔄 页面刷新后检测到屏幕共享模式，恢复屏幕共享状态')
    currentStreamType = 'screen'
    // 设置一个较早的时间戳，确保屏幕共享轨道能被正确识别
    // 使用当前时间减去一个较大的值，模拟屏幕共享已经开始一段时间
    // 但不要设置得太早，否则 screenShareActive 判断会失效（30秒内）
    screenShareStartTime = Date.now() - 5000 // 假设屏幕共享已经开始了5秒
    console.log('[StudentRoom] 📌 已恢复屏幕共享状态:', {
      currentStreamType,
      screenShareStartTime: new Date(screenShareStartTime).toISOString(),
      注意: '页面刷新后恢复的屏幕共享状态，用于正确识别屏幕共享轨道'
    })
  } else {
    // 即使不是屏幕共享模式，也要确保摄像头流能恢复
    // 如果 store 中没有摄像头流，但可能有轨道，需要恢复
    console.log('[StudentRoom] 🔄 页面刷新后，非屏幕共享模式，确保摄像头流能恢复')
    
    // 重要：即使显示模式不是 'screen'，如果教师端正在屏幕共享，也应该识别屏幕共享轨道
    // 页面刷新后，可能显示模式还没有恢复，但屏幕共享轨道已经存在
    // 所以需要检查是否有多个视频轨道，如果有，可能一个是摄像头，一个是屏幕共享
    console.log('[StudentRoom] ⚠️ 注意：即使显示模式不是 screen，也会检查是否有屏幕共享轨道')
  }
  
  // 设置 track 回调，接收教师视频流（必须在初始化后立即设置）
  // 注意：虽然回调参数是 stream，但我们直接从 PeerConnection 接收器获取轨道，以确保正确分离
  onTrackCallback = () => {
    console.log('[StudentRoom] ========== 收到轨道事件 ==========')
    
    // 直接从 PeerConnection 的接收器中获取所有轨道，而不是依赖合并的流
    // 这样可以确保每次都能正确分离摄像头流和屏幕共享流
    if (!rtcManager) {
      console.warn('[StudentRoom] ⚠️ rtcManager 不可用')
      return
    }
    
    const connectionPc = rtcManager.getPeerConnection()
    if (!connectionPc) {
      console.warn('[StudentRoom] ⚠️ PeerConnection 不可用')
      return
    }
    
    const receivers = connectionPc.getReceivers()
    const transceivers = connectionPc.getTransceivers()
    console.log('[StudentRoom] 📊 当前接收器数量:', receivers.length, 'transceiver 数量:', transceivers.length)
    
    // 方案B：从 transceiver 和 SDP 中解析轨道类型
    // 建立 transceiver 索引到 stream-type 的映射
    const transceiverStreamTypeMap = new Map<number, 'camera' | 'screen'>()
    
    // 如果 trackStreamTypeMap 为空，尝试从当前 SDP 解析
    if (trackStreamTypeMap.size === 0 && rtcManager) {
      const localDescription = connectionPc.localDescription
      const remoteDescription = connectionPc.remoteDescription
      const sdp = remoteDescription?.sdp || localDescription?.sdp
      if (sdp) {
        const parsedMap = parseStreamTypeFromSDP(sdp)
        parsedMap.forEach((type, key) => {
          // key 是媒体行索引的字符串表示
          const mediaIndex = parseInt(key)
          if (!isNaN(mediaIndex) && mediaIndex < transceivers.length) {
            const transceiver = transceivers[mediaIndex]
            if (transceiver.receiver.track) {
              trackStreamTypeMap.set(transceiver.receiver.track.id, type)
            }
          }
        })
        console.log('[StudentRoom] 📌 从当前 SDP 解析的轨道类型映射:', Array.from(trackStreamTypeMap.entries()))
      }
    }
    
    // 分别收集摄像头轨道和屏幕共享轨道
    const cameraVideoTracks: MediaStreamTrack[] = []
    const screenVideoTracks: MediaStreamTrack[] = []
    const cameraAudioTracks: MediaStreamTrack[] = []
    const screenAudioTracks: MediaStreamTrack[] = [] // 屏幕共享的音频轨道（系统音频）
    
    // 获取当前显示模式，用于辅助识别
    const currentDisplayMode = store.displayMode
    
    // 优化：预先计算常用值，避免在循环中重复计算
    const isScreenMode = currentDisplayMode === 'screen'
    const now = Date.now()
    // 重要：页面刷新后，如果 currentStreamType 是 'screen'，也应该认为屏幕共享是活跃的
    // 即使 screenShareStartTime 可能不在 30 秒内，也应该识别屏幕共享轨道
    const screenShareActive = (screenShareStartTime > 0 && now - screenShareStartTime < 30000) || currentStreamType === 'screen'
    
    // 方案B：从 transceiver 中识别轨道类型（优先使用 SDP 中的 stream-type）
    // 如果 trackStreamTypeMap 为空，尝试从当前 SDP 重新解析
    if (trackStreamTypeMap.size === 0) {
      const localDescription = connectionPc.localDescription
      const remoteDescription = connectionPc.remoteDescription
      const sdp = remoteDescription?.sdp || localDescription?.sdp
      if (sdp) {
        const parsedMap = parseStreamTypeFromSDP(sdp)
        console.log('[StudentRoom] 📌 从当前 SDP 解析的 stream-type 映射:', Array.from(parsedMap.entries()))
        // 通过 transceiver 索引映射到 trackId
        parsedMap.forEach((streamType, mediaIndexStr) => {
          const mediaIndex = parseInt(mediaIndexStr)
          if (!isNaN(mediaIndex) && mediaIndex < transceivers.length) {
            const transceiver = transceivers[mediaIndex]
            if (transceiver.receiver.track) {
              trackStreamTypeMap.set(transceiver.receiver.track.id, streamType)
              console.log('[StudentRoom] 📌 映射轨道类型（从 SDP）:', {
                trackId: transceiver.receiver.track.id,
                trackLabel: transceiver.receiver.track.label,
                streamType,
                mediaIndex
              })
            }
          }
        })
        console.log('[StudentRoom] 📌 完成轨道类型映射（从 SDP）:', Array.from(trackStreamTypeMap.entries()))
      }
    }
    
    for (let i = 0; i < transceivers.length; i++) {
      const transceiver = transceivers[i]
      const receiver = transceiver.receiver
      if (!receiver.track) continue
      
      const track = receiver.track
      const label = track.label?.toLowerCase() || ''
      
      // 方案B：优先从 trackStreamTypeMap 中获取轨道类型
      let streamTypeFromSDP = trackStreamTypeMap.get(track.id)
      
      // 如果 trackStreamTypeMap 中没有，尝试通过 transceiver 索引查找
      if (!streamTypeFromSDP) {
        const localDescription = connectionPc.localDescription
        const remoteDescription = connectionPc.remoteDescription
        const sdp = remoteDescription?.sdp || localDescription?.sdp
        if (sdp) {
          const parsedMap = parseStreamTypeFromSDP(sdp)
          const mediaIndexStr = i.toString()
          streamTypeFromSDP = parsedMap.get(mediaIndexStr) || undefined
          if (streamTypeFromSDP) {
            trackStreamTypeMap.set(track.id, streamTypeFromSDP)
            console.log('[StudentRoom] 📌 通过 transceiver 索引找到轨道类型:', {
              trackId: track.id,
              trackLabel: track.label,
              streamType: streamTypeFromSDP,
              transceiverIndex: i
            })
          }
        }
      }
      
      if (track.kind === 'video') {
        if (streamTypeFromSDP) {
          // 方案B：使用 SDP 中的 stream-type 标识
          if (streamTypeFromSDP === 'screen') {
            screenVideoTracks.push(track)
            console.log('[StudentRoom] 识别为屏幕共享轨道（SDP stream-type）:', track.label, track.id)
          } else {
            cameraVideoTracks.push(track)
            knownCameraTrackIds.add(track.id)
            console.log('[StudentRoom] 识别为摄像头轨道（SDP stream-type）:', track.label, track.id)
          }
        } else {
          // 如果没有 SDP 标识，回退到标签识别（兼容旧版本）
          const isScreen = label.includes('screen') || label.includes('display') || label.includes('desktop') || label.includes('window')
          const isCamera = label.includes('camera') || label.includes('webcam') || label.includes('video') || label.includes('user')
          const isKnownCamera = knownCameraTrackIds.has(track.id)
          
          if (isScreen) {
            screenVideoTracks.push(track)
            console.log('[StudentRoom] 识别为屏幕共享轨道（标签，无 SDP 标识）:', track.label, track.id)
          } else if (isCamera || isKnownCamera) {
            cameraVideoTracks.push(track)
            if (!isKnownCamera) {
              knownCameraTrackIds.add(track.id)
            }
            console.log('[StudentRoom] 识别为摄像头轨道（标签，无 SDP 标识）:', track.label, track.id)
          } else {
            // 标签不明确，使用 currentStreamType 或默认规则
            if (isKnownCamera) {
              cameraVideoTracks.push(track)
              console.log('[StudentRoom] 识别为摄像头轨道（已知列表，无 SDP 标识）:', track.id, track.label)
            } else if (currentStreamType === 'screen' && screenShareActive) {
              screenVideoTracks.push(track)
              console.log('[StudentRoom] 识别为屏幕共享轨道（currentStreamType，无 SDP 标识）:', track.label, track.id)
            } else if (currentStreamType === 'camera') {
              cameraVideoTracks.push(track)
              knownCameraTrackIds.add(track.id)
              console.log('[StudentRoom] 识别为摄像头轨道（currentStreamType，无 SDP 标识）:', track.label, track.id)
            } else {
              // 默认识别为摄像头
              cameraVideoTracks.push(track)
              knownCameraTrackIds.add(track.id)
              console.log('[StudentRoom] 识别为摄像头轨道（默认，无 SDP 标识）:', track.label, track.id)
            }
          }
        }
      } else if (track.kind === 'audio') {
        // 音频轨道：优先使用 SDP 标识，否则使用标签
        const streamTypeFromSDP = trackStreamTypeMap.get(track.id)
        if (streamTypeFromSDP === 'screen') {
          screenAudioTracks.push(track)
        } else {
          const isScreenAudio = label.includes('screen') || label.includes('display') || label.includes('desktop') || label.includes('system')
          if (isScreenMode && isScreenAudio) {
            screenAudioTracks.push(track)
          } else {
            cameraAudioTracks.push(track)
          }
        }
      }
    }
    
    
    // 分别创建和更新摄像头流和屏幕共享流
    // 只在有对应轨道时才创建/更新流，避免覆盖
    
    // 优先处理屏幕共享流（如果当前显示模式是 screen，确保屏幕共享流优先设置）
    // 这样可以避免屏幕共享流被错误地设置到 teacherStream
    
    // 特殊处理：如果当前显示模式是 screen，但没有识别到屏幕共享轨道
    // 重要：如果屏幕共享刚刚开始（2秒内），即使有摄像头轨道，也应该优先识别为屏幕共享轨道
    if (currentDisplayMode === 'screen' && screenVideoTracks.length === 0) {
      // 检查是否有明确的摄像头轨道
      const hasExplicitCameraTracks = cameraVideoTracks.length > 0
      const isScreenShareJustStarted = screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000
      
      if (isScreenShareJustStarted || !hasExplicitCameraTracks) {
        const allVideoTracks = receivers
          .filter(r => r.track?.kind === 'video')
          .map(r => r.track!)
          .filter(t => !screenVideoTracks.some(st => st.id === t.id) && !cameraVideoTracks.some(ct => ct.id === t.id))
        
        if (allVideoTracks.length > 0) {
          allVideoTracks.forEach(track => {
            screenVideoTracks.push(track)
          })
        } else {
          // 如果没有未分类的轨道，可能是所有轨道都被识别为摄像头轨道了
          // 如果屏幕共享刚刚开始，尝试从摄像头轨道中找出可能是屏幕共享的轨道
          if (isScreenShareJustStarted && cameraVideoTracks.length > 0) {
            console.log('[StudentRoom] ⚠️ 屏幕共享刚刚开始，但所有轨道都被识别为摄像头轨道，尝试重新识别')
            // 检查是否有不在 knownCameraTrackIds 中的轨道
            const possibleScreenTracks = cameraVideoTracks.filter(t => !knownCameraTrackIds.has(t.id))
            if (possibleScreenTracks.length > 0) {
              console.log('[StudentRoom] ⚠️ 找到可能被误识别的屏幕共享轨道:', possibleScreenTracks.map(t => t.label))
              possibleScreenTracks.forEach(track => {
                // 从摄像头轨道中移除
                const index = cameraVideoTracks.indexOf(track)
                if (index > -1) {
                  cameraVideoTracks.splice(index, 1)
                }
                // 添加到屏幕共享轨道
                screenVideoTracks.push(track)
                console.log('[StudentRoom] ✅ 将可能被误识别的轨道重新识别为屏幕共享轨道:', track.label)
              })
            }
          }
        }
      } else {
        console.log('[StudentRoom] ⚠️ 显示模式是screen但没有屏幕共享轨道，且已有摄像头轨道，等待屏幕共享轨道到达')
      }
    }
    
    // 处理屏幕共享流（优先处理，避免被摄像头流覆盖）
    // 重要：在屏幕共享模式下，需要确保摄像头流不会被清除
    console.log('[StudentRoom] 🔍 准备处理屏幕共享流，检查条件:', {
      屏幕共享轨道数: screenVideoTracks.length,
      摄像头轨道数: cameraVideoTracks.length,
      当前显示模式: currentDisplayMode,
      屏幕共享刚刚开始: screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000,
      屏幕共享开始时间: screenShareStartTime > 0 ? new Date(screenShareStartTime).toISOString() : 0,
      当前摄像头流: store.teacherStream ? `stream-${store.teacherStream.id}` : 'null',
      当前屏幕共享流: store.screenStream ? `stream-${store.screenStream.id}` : 'null'
    })
    
    // 重要：无论显示模式是什么，只要有屏幕共享轨道，就应该创建屏幕共享流
    // 页面刷新后，即使显示模式不是 'screen'，如果识别到屏幕共享轨道，也应该创建流
    if (screenVideoTracks.length > 0) {
      console.log('[StudentRoom] ✅ 有屏幕共享轨道，进入处理逻辑', {
        显示模式: currentDisplayMode,
        屏幕共享轨道数: screenVideoTracks.length,
        注意: '无论显示模式是什么，都会创建屏幕共享流'
      })
      // 重要：在屏幕共享模式下，确保摄像头流不会被清除
      // 如果摄像头轨道存在，应该同时维护摄像头流
      if (currentDisplayMode === 'screen' && cameraVideoTracks.length > 0) {
        console.log('[StudentRoom] ⚠️ 屏幕共享模式下，检测到摄像头轨道，确保摄像头流不会被清除')
        console.log('[StudentRoom] 摄像头轨道详情:', cameraVideoTracks.map(t => ({
          id: t.id,
          label: t.label,
          enabled: t.enabled,
          readyState: t.readyState
        })))
      }
      
      // 检查是否有有效的屏幕共享视频轨道
      // 放宽检查：只要轨道未结束就认为有效（与摄像头轨道一致）
      // 方案B：页面刷新后，即使轨道状态不是 'live'，只要不是 'ended' 就认为有效
      const hasValidScreenVideo = screenVideoTracks.some(t => {
        const isValid = t.readyState !== 'ended'
        if (!isValid) {
          console.log('[StudentRoom] 轨道状态检查:', {
            trackId: t.id,
            readyState: t.readyState,
            enabled: t.enabled,
            muted: t.muted
          })
        }
        return isValid
      })
      const hasConnectingScreenVideo = screenVideoTracks.some(t => t.readyState !== 'ended')
      
      console.log('[StudentRoom] 📊 屏幕共享轨道状态:', {
        轨道数: screenVideoTracks.length,
        有效轨道: hasValidScreenVideo,
        连接中轨道: hasConnectingScreenVideo,
        轨道详情: screenVideoTracks.map(t => ({
          id: t.id,
          label: t.label,
          enabled: t.enabled,
          readyState: t.readyState,
          muted: t.muted
        })),
        屏幕共享开始时间: screenShareStartTime > 0 ? new Date(screenShareStartTime).toISOString() : 0,
        距离开始时间: screenShareStartTime > 0 ? Date.now() - screenShareStartTime : 0
      })
      
      // 即使 readyState 不是 'live'，也尝试创建流（可能是正在连接中）
      // 重要：即使轨道状态不是 'live'，也可能是正在建立连接，所以也尝试创建流
      if (hasValidScreenVideo || screenVideoTracks.length > 0) {
        console.log('[StudentRoom] ========== 开始处理屏幕共享流 ==========')
        console.log('[StudentRoom] ✅ 进入屏幕共享流处理逻辑')
        console.log('[StudentRoom] 屏幕共享轨道数量:', screenVideoTracks.length)
        console.log('[StudentRoom] 轨道详情:', screenVideoTracks.map(t => ({
          id: t.id,
          label: t.label,
          readyState: t.readyState,
          enabled: t.enabled,
          muted: t.muted
        })))
        console.log('[StudentRoom] 当前显示模式:', currentDisplayMode)
        console.log('[StudentRoom] 当前 screenStream:', store.screenStream ? `stream-${store.screenStream.id}` : 'null')
        
        // 检查是否需要更新流
        const currentScreenStream = store.screenStream
        let needsUpdate = true
        
        // 重要：如果屏幕共享刚刚开始（2秒内），强制更新流
        const isScreenShareJustStarted = screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000
        if (isScreenShareJustStarted) {
          console.log('[StudentRoom] 🔄 屏幕共享刚刚开始，强制更新流（确保使用新轨道）')
          needsUpdate = true
        } else if (currentScreenStream) {
          const currentTracks = currentScreenStream.getVideoTracks()
          const allTracksPresent = screenVideoTracks.every(t => currentTracks.some(ct => ct.id === t.id))
          // 放宽检查：只要轨道未结束就认为正常（与摄像头流一致）
          const allTracksValid = currentTracks.every(t => t.readyState !== 'ended')
          
          console.log('[StudentRoom] 当前流检查:', {
            currentTracksCount: currentTracks.length,
            screenTracksCount: screenVideoTracks.length,
            allTracksPresent,
            allTracksValid,
            currentTracks: currentTracks.map(t => ({
              id: t.id,
              readyState: t.readyState,
              enabled: t.enabled,
              muted: t.muted
            }))
          })
          
          // 如果所有轨道都已存在且状态正常，不更新流（避免重复设置导致 readyState 重置）
          if (allTracksPresent && currentTracks.length === screenVideoTracks.length && allTracksValid) {
            // 进一步检查：如果有 live 状态的轨道，说明连接已建立
            const hasLiveTracks = currentTracks.some(t => t.readyState === 'live')
            if (hasLiveTracks) {
              // 但需要检查轨道是否被静音，如果被静音，需要更新
              const allTracksMuted = currentTracks.every(t => t.muted)
              if (allTracksMuted) {
                console.warn('[StudentRoom] ⚠️ 当前流所有轨道都被静音，需要更新流')
                needsUpdate = true
              } else {
                // 检查是否有未静音的有效轨道
                const hasValidUnmutedTracks = currentTracks.some(t => !t.muted && t.readyState !== 'ended')
                if (hasValidUnmutedTracks) {
                  needsUpdate = false
                  console.log('[StudentRoom] 屏幕共享流已是最新且轨道状态正常，无需更新（避免重复设置）')
                  // 重要：即使不需要更新，也要确保流已设置到 store
                  if (!store.screenStream) {
                    console.warn('[StudentRoom] ⚠️ 屏幕共享流未设置到 store，强制创建')
                    needsUpdate = true
                  } else {
                    return // 直接返回，不创建新流
                  }
                } else {
                  console.warn('[StudentRoom] ⚠️ 当前流没有有效的未静音轨道，需要更新流')
                  needsUpdate = true
                }
              }
            } else {
              // 轨道存在但还未完全连接，仍然更新以确保显示
              console.log('[StudentRoom] 屏幕共享流轨道存在但还未完全连接，更新以确保显示')
            }
          } else if (allTracksPresent && currentTracks.length === screenVideoTracks.length) {
            // 如果轨道已存在但状态不正常，检查是否需要更新轨道
            const hasNewValidTracks = screenVideoTracks.some(t => t.readyState !== 'ended' && !currentTracks.some(ct => ct.id === t.id && ct.readyState !== 'ended'))
            if (!hasNewValidTracks) {
              // 检查是否有未静音的轨道
              const hasUnmutedTracks = screenVideoTracks.some(t => !t.muted && t.readyState !== 'ended')
              if (hasUnmutedTracks) {
                console.log('[StudentRoom] 检测到未静音的轨道，需要更新流')
                needsUpdate = true
              } else {
                // 即使没有未静音的轨道，如果屏幕共享刚刚开始，也强制更新
                if (isScreenShareJustStarted) {
                  console.log('[StudentRoom] 屏幕共享刚刚开始，强制更新流（即使轨道暂时静音）')
                  needsUpdate = true
                } else {
                  // 重要：即使轨道暂时静音，如果屏幕共享刚刚开始，也要创建流
                  // 这样可以确保流能立即显示，而不是一直等待
                  if (isScreenShareJustStarted) {
                    console.log('[StudentRoom] 屏幕共享刚刚开始，即使轨道暂时静音也创建流')
                    needsUpdate = true
                  } else {
                    needsUpdate = false
                    console.log('[StudentRoom] 屏幕共享流轨道已存在，等待轨道状态变为 live 或取消静音')
                    // 重要：即使不需要更新，也要确保流已设置到 store
                    if (!store.screenStream) {
                      console.warn('[StudentRoom] ⚠️ 屏幕共享流未设置到 store，强制创建')
                      needsUpdate = true
                    } else {
                      return
                    }
                  }
                }
              }
            }
          }
        }
        
        if (needsUpdate) {
          console.log('[StudentRoom] ✅ needsUpdate = true，开始处理屏幕共享流更新')
          
          // 检查是否是第一次屏幕共享（没有旧的流）
          // 重要：如果屏幕共享刚刚开始（screenShareStartTime 很近），即使有流也认为是重新推流
          const isFirstScreenShare = !store.screenStream || (screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000)
          console.log('[StudentRoom] 是否第一次屏幕共享:', isFirstScreenShare, {
            hasScreenStream: !!store.screenStream,
            screenShareStartTime: screenShareStartTime > 0 ? new Date(screenShareStartTime).toISOString() : 0,
            timeSinceStart: screenShareStartTime > 0 ? Date.now() - screenShareStartTime : 0
          })
          
          // 获取旧流的轨道 ID（用于识别新旧轨道）
          // 重要：如果屏幕共享刚刚开始，从 PeerConnection 的接收器中获取旧的屏幕共享轨道ID
          const oldStreamTrackIds = new Set<string>()
          if (store.screenStream) {
            store.screenStream.getTracks().forEach(track => {
              oldStreamTrackIds.add(track.id)
            })
            console.log('[StudentRoom] 旧流的轨道 ID（从 store.screenStream）:', Array.from(oldStreamTrackIds))
          }
          
          // 如果屏幕共享刚刚开始，也从 PeerConnection 中获取旧的屏幕共享轨道ID
          if (screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000 && rtcManager) {
            const pc = rtcManager.getPeerConnection()
            if (pc) {
              const receivers = pc.getReceivers()
              receivers.forEach(receiver => {
                const track = receiver.track
                if (track && track.kind === 'video') {
                  const label = track.label?.toLowerCase() || ''
                  const isScreen = label.includes('screen') || label.includes('display') || label.includes('desktop') || label.includes('window')
                  // 如果轨道状态不是 live，或者轨道被静音，可能是旧的已停止的轨道
                  if (isScreen && (track.readyState !== 'live' || track.muted)) {
                    oldStreamTrackIds.add(track.id)
                    console.log('[StudentRoom] 从 PeerConnection 找到旧的屏幕共享轨道:', track.id, 'readyState:', track.readyState, 'muted:', track.muted)
                  }
                }
              })
              console.log('[StudentRoom] 合并后的旧流轨道 ID:', Array.from(oldStreamTrackIds))
            }
          }
          
          // 创建新的屏幕共享流
          // 策略：
          // 1. 如果是重新推流，排除旧流中的轨道（通过轨道 ID 判断）
          // 2. 只使用新的轨道，且轨道必须是 live、enabled
          // 3. 对于暂时 muted 的轨道，如果是新轨道（不在旧流中），也允许使用
          let liveScreenTracks: MediaStreamTrack[]
          
          if (isFirstScreenShare) {
            // 第一次屏幕共享：页面刷新后，完全放宽检查
            // 重要：页面刷新后，轨道可能暂时状态不是 'live'，但只要不是 'ended' 就使用
            // 甚至如果所有轨道都是 'ended'，也尝试使用（可能是状态检查的时机问题）
            const isPageRefresh = !store.screenStream
            
            if (isPageRefresh) {
              // 页面刷新后：使用所有轨道，即使状态是 'ended' 也尝试（可能是状态检查时机问题）
              console.log('[StudentRoom] ⚠️ 页面刷新后，使用所有屏幕共享轨道（包括可能已结束的）')
              liveScreenTracks = [...screenVideoTracks]
            } else {
              // 正常情况：只使用未结束的轨道
              liveScreenTracks = screenVideoTracks.filter(t => {
                const isValid = t.readyState !== 'ended'
                if (!isValid) {
                  console.log('[StudentRoom] 第一次屏幕共享：轨道被过滤（已结束）:', {
                    trackId: t.id,
                    readyState: t.readyState,
                    enabled: t.enabled,
                    muted: t.muted
                  })
                }
                return isValid
              })
            }
            
            console.log('[StudentRoom] 第一次屏幕共享，筛选前的轨道数量:', screenVideoTracks.length)
            console.log('[StudentRoom] 第一次屏幕共享，筛选后的轨道数量:', liveScreenTracks.length)
            console.log('[StudentRoom] 屏幕共享轨道详情（筛选前）:', screenVideoTracks.map(t => ({
              id: t.id,
              label: t.label,
              readyState: t.readyState,
              enabled: t.enabled,
              muted: t.muted
            })))
            console.log('[StudentRoom] 屏幕共享轨道详情（筛选后）:', liveScreenTracks.map(t => ({
              id: t.id,
              label: t.label,
              readyState: t.readyState,
              enabled: t.enabled,
              muted: t.muted,
              注意: isPageRefresh ? '页面刷新后，使用所有轨道' : '正常筛选'
            })))
          } else {
            // 重新推流：优先使用新轨道（不在旧流中的轨道），且必须是 live、enabled
            // 对于新轨道，即使暂时 muted 也允许使用（数据可能正在传输中）
            console.log('[StudentRoom] 🔍 重新推流，检查轨道:', {
              总屏幕共享轨道数: screenVideoTracks.length,
              旧流轨道ID: Array.from(oldStreamTrackIds),
              当前屏幕共享轨道ID: screenVideoTracks.map(t => t.id),
              当前屏幕共享轨道状态: screenVideoTracks.map(t => ({
                id: t.id,
                label: t.label,
                readyState: t.readyState,
                enabled: t.enabled,
                muted: t.muted,
                isOldTrack: oldStreamTrackIds.has(t.id)
              }))
            })
            
            // 重要：对于新轨道，即使暂时 muted 也允许使用（数据可能正在传输中）
            // 但对于旧轨道，如果被静音，不应该使用（可能是已停止的轨道）
            const isScreenShareJustStarted = screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000
            const newTracks = screenVideoTracks.filter(t => {
              const isNewTrack = !oldStreamTrackIds.has(t.id)
              // 放宽检查：只要轨道未结束就认为有效（与摄像头轨道一致）
              const isValid = t.readyState !== 'ended'
              
              // 如果是新轨道，即使暂时 muted 也允许使用（屏幕共享刚刚开始）
              // 如果是旧轨道，必须未静音才使用
              const isMutedButAllowed = isNewTrack && isScreenShareJustStarted && t.muted
              const isUnmuted = !t.muted
              
              const result = isNewTrack && isValid && (isMutedButAllowed || isUnmuted)
              
              if (!result && isNewTrack) {
                if (!isValid) {
                  console.log('[StudentRoom] 轨道被过滤（状态无效）:', t.id, 'readyState:', t.readyState, 'enabled:', t.enabled)
                } else if (t.muted && !isScreenShareJustStarted) {
                  console.log('[StudentRoom] 轨道被过滤（新轨道但被静音且屏幕共享未刚刚开始）:', t.id, 'muted:', t.muted)
                }
              } else if (!result && !isNewTrack) {
                console.log('[StudentRoom] 轨道被过滤（旧轨道）:', t.id)
              }
              return result
            })
            
            // 如果没有新轨道，但所有轨道都未结束，也使用它们（可能是轨道 ID 变化了）
            // 重要：页面刷新后，轨道可能暂时被静音，但仍应创建流
            if (newTracks.length === 0 && screenVideoTracks.length > 0) {
              // 放宽检查：只要轨道未结束就使用（与摄像头轨道一致）
              const allLiveTracks = screenVideoTracks.filter(t => t.readyState !== 'ended')
              if (allLiveTracks.length > 0) {
                // 方案B：页面刷新后，即使轨道暂时被静音，也应该创建流
                // 因为轨道可能在连接建立过程中暂时被标记为 muted
                const isScreenShareJustStarted = screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000
                const isPageRefresh = !store.screenStream && allLiveTracks.length > 0
                const allTracksMuted = allLiveTracks.every(t => t.muted)
                
                // 只有在不是页面刷新且不是刚刚开始时，才拒绝所有轨道都被静音的情况
                if (allTracksMuted && !isScreenShareJustStarted && !isPageRefresh) {
                  console.error('[StudentRoom] ❌ 所有轨道都被静音，可能是旧的已停止的轨道，不创建流')
                  console.error('[StudentRoom] 轨道详情:', allLiveTracks.map(t => ({
                    id: t.id,
                    label: t.label,
                    readyState: t.readyState,
                    enabled: t.enabled,
                    muted: t.muted,
                    isOldTrack: oldStreamTrackIds.has(t.id)
                  })))
                  liveScreenTracks = []
                } else {
                  // 页面刷新后或屏幕共享刚刚开始时，即使轨道被静音也使用
                  if (isPageRefresh || isScreenShareJustStarted) {
                    console.log('[StudentRoom] ⚠️ 页面刷新后或屏幕共享刚刚开始，即使轨道被静音也创建流')
                  }
                  console.warn('[StudentRoom] ⚠️ 重新推流时没有找到新轨道（ID 可能变化），使用所有 live 轨道')
                  console.warn('[StudentRoom] 使用的轨道详情:', allLiveTracks.map(t => ({
                    id: t.id,
                    label: t.label,
                    readyState: t.readyState,
                    enabled: t.enabled,
                    muted: t.muted,
                    isOldTrack: oldStreamTrackIds.has(t.id)
                  })))
                  liveScreenTracks = allLiveTracks
                }
              } else {
                console.error('[StudentRoom] ❌ 没有 live 且 enabled 的轨道！')
                liveScreenTracks = []
              }
            } else {
              liveScreenTracks = newTracks
            }
            
            console.log('[StudentRoom] 重新推流，筛选结果:', {
              新轨道数量: liveScreenTracks.length,
              总轨道数: screenVideoTracks.length,
              新轨道详情: liveScreenTracks.map(t => ({
                id: t.id,
                label: t.label,
                readyState: t.readyState,
                enabled: t.enabled,
                muted: t.muted
              }))
            })
          }
          
          // 方案B：如果 liveScreenTracks 为空，但 screenVideoTracks 不为空，尝试使用所有未结束的轨道
          // 页面刷新后，轨道可能暂时被静音，但仍应创建流
          if (liveScreenTracks.length === 0 && screenVideoTracks.length > 0) {
            const allUnendedTracks = screenVideoTracks.filter(t => t.readyState !== 'ended')
            if (allUnendedTracks.length > 0) {
              const isPageRefresh = !store.screenStream
              const isScreenShareJustStarted = screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000
              
              // 页面刷新后或屏幕共享刚刚开始时，即使轨道被静音也使用
              if (isPageRefresh || isScreenShareJustStarted) {
                console.log('[StudentRoom] ⚠️ 页面刷新后或屏幕共享刚刚开始，使用所有未结束的轨道（即使被静音）')
                liveScreenTracks = allUnendedTracks
              } else {
                console.warn('[StudentRoom] ⚠️ 没有可用的屏幕共享轨道')
                console.warn('[StudentRoom] 所有屏幕共享轨道状态:', screenVideoTracks.map(t => ({
                  id: t.id,
                  label: t.label,
                  readyState: t.readyState,
                  enabled: t.enabled,
                  muted: t.muted,
                  isOldTrack: oldStreamTrackIds.has(t.id)
                })))
              }
            } else {
              console.warn('[StudentRoom] ⚠️ 没有可用的屏幕共享轨道')
              console.warn('[StudentRoom] 所有屏幕共享轨道状态:', screenVideoTracks.map(t => ({
                id: t.id,
                label: t.label,
                readyState: t.readyState,
                enabled: t.enabled,
                muted: t.muted,
                isOldTrack: oldStreamTrackIds.has(t.id)
              })))
            }
          }
          
          if (liveScreenTracks.length === 0) {
            const isPageRefresh = !store.screenStream
            
            // 页面刷新后：即使所有轨道都是 'ended'，也尝试使用（可能是状态检查时机问题）
            if (isPageRefresh && screenVideoTracks.length > 0) {
              console.log('[StudentRoom] ⚠️ 页面刷新后，即使轨道状态是 ended，也尝试使用所有轨道')
              liveScreenTracks = [...screenVideoTracks]
            } else {
              // 如果是重新推流，清除旧的流，等待新轨道到达
              if (!isFirstScreenShare) {
                console.warn('[StudentRoom] ⚠️ 重新推流时没有新轨道，清除旧流，等待新轨道...')
                if (store.screenStream) {
                  // 停止旧流中的所有轨道
                  const oldTracks = store.screenStream.getTracks()
                  oldTracks.forEach(track => {
                    console.log('[StudentRoom] 停止旧轨道:', track.id)
                    track.stop()
                  })
                  store.setScreenStream(null)
                }
              }
              
              // 重要：即使没有新轨道，也尝试使用所有可用的轨道（可能是轨道 ID 变化了）
              // 放宽检查：只要轨道未结束就使用（与摄像头轨道一致）
              const fallbackTracks = screenVideoTracks.filter(t => t.readyState !== 'ended')
              if (fallbackTracks.length > 0) {
                console.warn('[StudentRoom] ⚠️ 使用备用策略：使用所有 live 且 enabled 的轨道')
                liveScreenTracks = fallbackTracks
              } else {
                console.warn('[StudentRoom] ⚠️ 没有可用的轨道，等待新轨道到达...')
                return // 不创建流，等待新轨道到达
              }
            }
          }
          
          // 如果之前有屏幕共享流，先清除（避免显示旧的已停止的轨道）
          // 重要：只清除流引用，不停止轨道，因为停止轨道会导致 PeerConnection 状态混乱
          // 旧的已停止的轨道会通过 oldStreamTrackIds 被过滤掉
          if (store.screenStream) {
            console.log('[StudentRoom] 清除旧的屏幕共享流引用，准备创建新的')
            console.log('[StudentRoom] 旧流轨道ID:', store.screenStream.getTracks().map(t => ({
              id: t.id,
              readyState: t.readyState,
              enabled: t.enabled,
              muted: t.muted
            })))
            // 不停止轨道，只清除引用，让 WebRTC 自然处理轨道的生命周期
            store.setScreenStream(null)
          }
          
          // 创建新流，只包含屏幕共享的视频轨道和屏幕共享的音频轨道（如果有）
          // 重要：屏幕共享流不应该包含摄像头音频，摄像头音频应该保持在摄像头流中
          // 摄像头音频会通过隐藏的音频播放器播放（在模板中已实现）
          const allScreenTracks = [...liveScreenTracks, ...screenAudioTracks]
          
          console.log('[StudentRoom] 📦 准备创建屏幕共享流:', {
            视频轨道数量: liveScreenTracks.length,
            屏幕共享音频轨道数量: screenAudioTracks.length,
            摄像头音频轨道数量: cameraAudioTracks.length,
            注意: screenAudioTracks.length === 0 && cameraAudioTracks.length > 0 
              ? '屏幕共享流没有音频，摄像头音频将通过隐藏播放器播放' 
              : '屏幕共享流包含音频或没有摄像头音频'
          })
          
          const screenStream = new MediaStream(allScreenTracks)
          
          // 验证流创建成功
          console.log('[StudentRoom] 📦 流创建成功:', {
            streamId: screenStream.id,
            视频轨道数: screenStream.getVideoTracks().length,
            音频轨道数: screenStream.getAudioTracks().length,
            视频轨道ID: screenStream.getVideoTracks().map(t => t.id),
            视频轨道详情: screenStream.getVideoTracks().map(t => ({
              id: t.id,
              label: t.label,
              readyState: t.readyState,
              enabled: t.enabled,
              muted: t.muted
            })),
            音频轨道ID: screenStream.getAudioTracks().map(t => t.id),
            注意: screenStream.getAudioTracks().length > 0 ? '屏幕共享流包含音频' : '屏幕共享流没有音频，摄像头音频将通过隐藏播放器播放'
          })
          
          // 重要：验证视频轨道是否有效
          const videoTracks = screenStream.getVideoTracks()
          if (videoTracks.length === 0) {
            console.error('[StudentRoom] ❌ 屏幕共享流没有视频轨道！')
          } else {
            // 放宽检查：只要轨道未结束就认为有效（与摄像头流一致）
            const validVideoTracks = videoTracks.filter(t => t.readyState !== 'ended')
            if (validVideoTracks.length === 0) {
              console.error('[StudentRoom] ❌ 屏幕共享流没有有效的视频轨道！所有轨道状态:', videoTracks.map(t => ({
                id: t.id,
                readyState: t.readyState,
                enabled: t.enabled,
                muted: t.muted
              })))
            } else {
              console.log('[StudentRoom] ✅ 屏幕共享流有', validVideoTracks.length, '个有效的视频轨道（未结束）')
              // 检查是否有 live 状态的轨道
              const liveTracks = validVideoTracks.filter(t => t.readyState === 'live')
              if (liveTracks.length > 0) {
                console.log('[StudentRoom] ✅ 其中', liveTracks.length, '个轨道已处于 live 状态')
              } else {
                console.log('[StudentRoom] ⚠️ 轨道存在但还未完全连接，等待连接建立...')
              }
            }
          }
          
          // 设置到 store
          store.setScreenStream(screenStream)
          
          // 验证 store 中的流
          const verifyStream = store.screenStream
          console.log('[StudentRoom] ✅ 已更新 screenStream 到 store（屏幕共享）')
          console.log('[StudentRoom] 📊 Store 验证:', {
            storeStreamId: verifyStream?.id,
            storeVideoTracks: verifyStream?.getVideoTracks().length || 0,
            storeAudioTracks: verifyStream?.getAudioTracks().length || 0,
            matches: verifyStream === screenStream,
            同时存在的摄像头流: store.teacherStream ? `stream-${store.teacherStream.id}` : 'null'
          })
          
          // 验证摄像头流是否还在（屏幕共享模式下，摄像头流应该同时存在）
          if (currentDisplayMode === 'screen' && !store.teacherStream) {
            console.warn('[StudentRoom] ⚠️ 屏幕共享模式下，摄像头流不存在！')
            console.warn('[StudentRoom] ⚠️ 这可能导致左侧小窗口无法显示教师摄像头')
            // 尝试从接收器中重新识别摄像头轨道
            if (rtcManager) {
              const pc = rtcManager.getPeerConnection()
              if (pc) {
                const receivers = pc.getReceivers()
                const cameraTracks = receivers
                  .filter(r => {
                    const track = r.track
                    if (!track || track.kind !== 'video') return false
                    const label = track.label?.toLowerCase() || ''
                    const isScreen = label.includes('screen') || label.includes('display') || label.includes('desktop') || label.includes('window')
                    const isCamera = label.includes('camera') || label.includes('webcam') || label.includes('video') || label.includes('user')
                    const isKnownCamera = knownCameraTrackIds.has(track.id)
                    return (isCamera || isKnownCamera) && !isScreen
                  })
                  .map(r => r.track!)
                
                if (cameraTracks.length > 0) {
                  const cameraStream = new MediaStream([...cameraTracks])
                  store.setTeacherStream(cameraStream)
                  console.log('[StudentRoom] ✅ 已从接收器中重新创建摄像头流（屏幕共享模式下）')
                }
              }
            }
          }
          
          console.log('[StudentRoom] 新流轨道详情:', liveScreenTracks.map(t => ({
            id: t.id,
            label: t.label,
            readyState: t.readyState,
            enabled: t.enabled,
            muted: t.muted,
            isNewTrack: !oldStreamTrackIds.has(t.id)
          })))
          console.log('[StudentRoom] 屏幕共享流详情:', {
            streamId: screenStream.id,
            视频轨道数: liveScreenTracks.length,
            有效视频: hasValidScreenVideo,
            轨道标签: liveScreenTracks.map(t => t.label).join(', '),
            轨道ID: liveScreenTracks.map(t => t.id).join(', '),
            轨道状态: liveScreenTracks.map(t => ({
              id: t.id,
              label: t.label,
              enabled: t.enabled,
              readyState: t.readyState,
              muted: t.muted
            })),
            当前显示模式: currentDisplayMode,
            currentStreamType,
            注意: hasValidScreenVideo ? '轨道状态正常' : '轨道可能正在连接中，已创建流等待数据'
          })
          
          // 如果当前显示模式不是 screen，但收到了屏幕共享流，自动切换到 screen 模式
          // 重要：页面刷新后，即使显示模式不是 'screen'，如果识别到屏幕共享轨道，也应该切换显示模式
          if (currentDisplayMode !== 'screen') {
            console.log('[StudentRoom] 🔄 检测到屏幕共享流，自动切换到 screen 模式')
            console.log('[StudentRoom] 📌 页面刷新后恢复屏幕共享显示模式')
            store.setDisplayMode('screen')
            // 确保屏幕共享状态已恢复
            if (currentStreamType !== 'screen') {
              currentStreamType = 'screen'
              if (screenShareStartTime === 0) {
                screenShareStartTime = Date.now() - 5000
              }
              console.log('[StudentRoom] 📌 已恢复屏幕共享状态（从屏幕共享流推断）')
            }
          }
          
          // 重要：验证 LiveVideo 组件是否能接收到流
          console.log('[StudentRoom] 🔍 验证 LiveVideo 组件接收流:', {
            displayMode: store.displayMode,
            screenStream: store.screenStream ? `stream-${store.screenStream.id}` : 'null',
            screenStreamVideoTracks: store.screenStream?.getVideoTracks().length || 0
          })
          
          // 如果轨道状态不是 'live'，监听状态变化
          if (!hasValidScreenVideo) {
            console.log('[StudentRoom] ⚠️ 屏幕共享轨道状态不是 live，监听状态变化...')
            screenVideoTracks.forEach(track => {
              const onStateChange = () => {
                console.log('[StudentRoom] 📊 屏幕共享轨道状态变化:', {
                  id: track.id,
                  label: track.label,
                  readyState: track.readyState,
                  enabled: track.enabled
                })
                if (track.readyState === 'live' && store.screenStream) {
                  console.log('[StudentRoom] ✅ 屏幕共享轨道已变为 live，流应该可以播放了')
                  // 触发一次验证
                  setTimeout(() => {
                    const verifyStream = store.screenStream
                    if (verifyStream) {
                      const videoTracks = verifyStream.getVideoTracks()
                      console.log('[StudentRoom] ✅ 验证：屏幕共享流轨道状态:', videoTracks.map(t => ({
                        id: t.id,
                        readyState: t.readyState,
                        enabled: t.enabled
                      })))
                    }
                  }, 100)
                }
              }
              track.addEventListener('ended', onStateChange)
              track.addEventListener('mute', onStateChange)
              track.addEventListener('unmute', onStateChange)
            })
          }
          
          // 添加数据接收检测：在连接建立后，等待数据开始接收
          if (rtcManager && currentStreamType === 'screen') {
            const pc = rtcManager.getPeerConnection()
            if (pc && pc.connectionState === 'connected') {
              // 延迟检查数据接收（给连接一些时间建立）
              setTimeout(async () => {
                try {
                  const stats = await pc.getStats()
                  let hasVideoData = false
                  
                  stats.forEach(report => {
                    if (report.type === 'inbound-rtp') {
                      const mediaType = (report as any).mediaType
                      if (mediaType === 'video') {
                        const bytesReceived = (report as any).bytesReceived || 0
                        const packetsReceived = (report as any).packetsReceived || 0
                        const framesReceived = (report as any).framesReceived || 0
                        
                        if (bytesReceived > 0 || packetsReceived > 0 || framesReceived > 0) {
                          hasVideoData = true
                          console.log('[StudentRoom] ✅ 屏幕共享流数据已开始接收:', {
                            bytesReceived,
                            packetsReceived,
                            framesReceived
                          })
                        }
                      }
                    }
                  })
                  
                  // 如果数据已接收，确保流已设置并触发视频刷新
                  if (hasVideoData && store.screenStream) {
                    console.log('[StudentRoom] ✅ 屏幕共享数据已接收，流已设置，视频应该可以播放')
                    // 强制触发一次流更新，确保视频元素能接收到数据
                    // 注意：这里不创建新流，只是触发 LiveVideo 组件的 watch
                    const currentStream = store.screenStream
                    if (currentStream) {
                      // 检查视频元素状态
                      setTimeout(() => {
                        const videoElement = document.querySelector('.display-container video') as HTMLVideoElement
                        if (videoElement) {
                          console.log('[StudentRoom] 🔍 检查视频元素状态:', {
                            hasSrcObject: !!videoElement.srcObject,
                            readyState: videoElement.readyState,
                            paused: videoElement.paused,
                            videoWidth: videoElement.videoWidth,
                            videoHeight: videoElement.videoHeight
                          })
                          
                          // 如果视频元素有 srcObject 但 readyState 为 0，尝试重新设置
                          if (videoElement.srcObject && videoElement.readyState === 0) {
                            console.log('[StudentRoom] ⚠️ 视频元素 readyState 为 0，尝试重新设置流...')
                            const currentSrcObject = videoElement.srcObject
                            videoElement.srcObject = null
                            setTimeout(() => {
                              videoElement.srcObject = currentSrcObject
                              console.log('[StudentRoom] ✅ 已重新设置视频元素 srcObject')
                              // 尝试播放
                              if (videoElement.paused) {
                                videoElement.play().catch(err => {
                                  console.error('[StudentRoom] ❌ 播放失败:', err)
                                })
                              }
                            }, 50)
                          } else if (videoElement.paused && videoElement.readyState >= 2) {
                            // 如果视频暂停但 readyState >= 2，尝试播放
                            console.log('[StudentRoom] 🔄 视频暂停但 readyState >= 2，尝试播放...')
                            videoElement.play().catch(err => {
                              console.error('[StudentRoom] ❌ 播放失败:', err)
                            })
                          }
                        }
                      }, 200)
                    }
                  } else if (!hasVideoData) {
                    console.warn('[StudentRoom] ⚠️ 屏幕共享流已设置，但数据尚未接收，可能正在建立连接...')
                  }
                } catch (error) {
                  console.error('[StudentRoom] ❌ 检查数据接收失败:', error)
                }
              }, 1000) // 等待 1 秒后检查
            }
          }
          
          // 验证流是否已正确设置
          setTimeout(() => {
            const verifyStream = store.screenStream
            if (verifyStream) {
              console.log('[StudentRoom] ✅ 验证：screenStream 已正确设置到 store')
              console.log('[StudentRoom] 验证详情:', {
                streamId: verifyStream.id,
                视频轨道数: verifyStream.getVideoTracks().length,
                轨道ID: verifyStream.getVideoTracks().map(t => t.id).join(', '),
                轨道状态: verifyStream.getVideoTracks().map(t => ({
                  id: t.id,
                  readyState: t.readyState,
                  enabled: t.enabled
                }))
              })
            } else {
              console.error('[StudentRoom] ❌ 验证失败：screenStream 未设置到 store')
            }
          }, 100)
        }
      } else {
        console.warn('[StudentRoom] ⚠️ 屏幕共享轨道存在但全部无效（enabled=false）')
        console.warn('[StudentRoom] 轨道详情:', screenVideoTracks.map(t => ({
          id: t.id,
          label: t.label,
          enabled: t.enabled,
          readyState: t.readyState,
          muted: t.muted
        })))
      }
    } else {
      // 如果没有屏幕共享轨道，但当前显示模式是 screen
      if (currentDisplayMode === 'screen') {
        // 只有在没有摄像头轨道时，才将所有视频轨道视为屏幕共享
        // 如果有摄像头轨道，说明屏幕共享轨道可能还没到达，需要等待
        if (cameraVideoTracks.length === 0) {
          // 检查是否有任何视频轨道（可能是标签识别失败）
          const allVideoTracks = receivers
            .filter(r => r.track?.kind === 'video')
            .map(r => r.track!)
            .filter(t => !cameraVideoTracks.some(ct => ct.id === t.id))
          
          if (allVideoTracks.length > 0) {
            console.log('[StudentRoom] ⚠️ 显示模式是screen但没有识别到屏幕共享轨道，且无摄像头轨道，尝试将所有视频轨道视为屏幕共享')
            // 放宽检查：只要轨道未结束就使用（与摄像头流一致）
            const validTracks = allVideoTracks.filter(t => t.readyState !== 'ended')
            if (validTracks.length > 0) {
              const screenStream = new MediaStream([...validTracks])
              store.setScreenStream(screenStream)
              console.log('[StudentRoom] ✅ 已将所有视频轨道设置为屏幕共享流（显示模式为screen，无摄像头轨道）')
              console.log('[StudentRoom] 屏幕共享流详情:', {
                streamId: screenStream.id,
                视频轨道: validTracks.length,
                轨道标签: validTracks.map(t => t.label).join(', ')
              })
            }
          } else {
            console.log('[StudentRoom] ⚠️ 显示模式是 screen 但没有视频轨道，保留现有流等待新轨道')
          }
        } else {
          console.log('[StudentRoom] ⚠️ 显示模式是screen但没有屏幕共享轨道，已有摄像头轨道，等待屏幕共享轨道到达')
          console.log('[StudentRoom] 摄像头轨道数:', cameraVideoTracks.length)
        }
      }
    }
    
    // 处理摄像头流（包含视频和音频）
    // 重要：即使在屏幕共享模式下，也需要维护摄像头流（用于小窗口显示和音频播放）
    // 但需要确保不会错误地将屏幕共享轨道识别为摄像头轨道
    if (cameraVideoTracks.length > 0 || cameraAudioTracks.length > 0) {
      // 放宽状态检查：允许轨道在连接过程中（readyState 可能不是 'live'）
      // 只要轨道存在且未结束，就认为有效
      const hasValidCameraVideo = cameraVideoTracks.some(t => t.readyState !== 'ended')
      const hasValidCameraAudio = cameraAudioTracks.some(t => t.readyState !== 'ended')
      
      console.log('[StudentRoom] 📊 摄像头流处理:', {
        显示模式: currentDisplayMode,
        视频轨道数: cameraVideoTracks.length,
        音频轨道数: cameraAudioTracks.length,
        有效视频: hasValidCameraVideo,
        有效音频: hasValidCameraAudio,
        已知摄像头轨道ID: Array.from(knownCameraTrackIds),
        摄像头轨道ID: cameraVideoTracks.map(t => t.id),
        轨道状态: cameraVideoTracks.map(t => ({ id: t.id, enabled: t.enabled, readyState: t.readyState }))
      })
      
      // 重要：在屏幕共享模式下，需要更宽松地验证摄像头轨道
      // 因为屏幕共享轨道和摄像头轨道可能同时存在，且标签可能不明确
      // 如果轨道已经在 cameraVideoTracks 中（说明通过了轨道识别逻辑），就应该信任它
      // 只有在屏幕共享模式下，且轨道不在已知列表中，且标签明确是屏幕共享时，才过滤
      let finalCameraVideoTracks = cameraVideoTracks
      
      // 在屏幕共享模式下，进行额外的验证，确保不会将屏幕共享轨道误识别为摄像头轨道
      // 但也要确保不会过度过滤，导致摄像头轨道被错误地移除
      if (currentDisplayMode === 'screen' && screenVideoTracks.length > 0) {
        console.log('[StudentRoom] 🔍 屏幕共享模式下，验证摄像头轨道（确保不会误识别）:', {
          摄像头轨道数: finalCameraVideoTracks.length,
          屏幕共享轨道数: screenVideoTracks.length,
          已知摄像头轨道ID: Array.from(knownCameraTrackIds)
        })
        
        // 检查是否有轨道被错误地识别为摄像头轨道（实际上是屏幕共享轨道）
        // 只过滤标签明确是屏幕共享且不在已知列表中的轨道
        const misidentifiedTracks = finalCameraVideoTracks.filter(track => {
          const label = track.label?.toLowerCase() || ''
          const isScreen = label.includes('screen') || label.includes('display') || label.includes('desktop') || label.includes('window')
          const isKnownCamera = knownCameraTrackIds.has(track.id)
          // 如果标签明确是屏幕共享，且不在已知摄像头列表中，可能是误识别
          // 但如果在已知列表中，即使标签是屏幕共享，也保持为摄像头（可能是之前的摄像头轨道）
          return isScreen && !isKnownCamera
        })
        
        if (misidentifiedTracks.length > 0) {
          console.warn('[StudentRoom] ⚠️ 检测到可能误识别的摄像头轨道（实际是屏幕共享），已过滤:', {
            被过滤的轨道: misidentifiedTracks.map(t => ({ id: t.id, label: t.label })),
            剩余摄像头轨道: finalCameraVideoTracks.length - misidentifiedTracks.length
          })
          finalCameraVideoTracks = finalCameraVideoTracks.filter(t => !misidentifiedTracks.includes(t))
        } else {
          console.log('[StudentRoom] ✅ 摄像头轨道验证通过，没有误识别的轨道')
        }
      }
      
      // 如果过滤后没有摄像头轨道，但之前有，说明可能过滤过度了
      // 在屏幕共享模式下，摄像头轨道应该与屏幕共享轨道同时存在
      if (finalCameraVideoTracks.length === 0 && cameraVideoTracks.length > 0) {
        console.warn('[StudentRoom] ⚠️ 所有摄像头轨道都被过滤，可能过滤过度，恢复原始轨道')
        console.warn('[StudentRoom] ⚠️ 在屏幕共享模式下，摄像头轨道应该与屏幕共享轨道同时存在')
        finalCameraVideoTracks = cameraVideoTracks
      }
      
      // 在屏幕共享模式下，如果摄像头轨道为空，但之前有摄像头流，记录警告
      if (currentDisplayMode === 'screen' && finalCameraVideoTracks.length === 0 && store.teacherStream) {
        console.warn('[StudentRoom] ⚠️ 屏幕共享模式下，摄像头轨道为空，但 store 中仍有摄像头流')
        console.warn('[StudentRoom] ⚠️ 这可能导致摄像头流无法更新，左侧小窗口可能显示黑屏')
      }
      // 放宽检查：只要轨道未结束就认为有效
      const hasValidFinalVideo = finalCameraVideoTracks.some(t => t.readyState !== 'ended')
      
      if (hasValidFinalVideo || hasValidCameraAudio) {
        // 检查是否需要更新流（避免重复创建）
        const currentTeacherStream = store.teacherStream
        let needsUpdate = true
        
        if (currentTeacherStream) {
          // 检查当前流是否包含所有摄像头轨道
          const currentVideoTracks = currentTeacherStream.getVideoTracks()
          const currentAudioTracks = currentTeacherStream.getAudioTracks()
          const allVideoTracksPresent = finalCameraVideoTracks.length === 0 || 
            finalCameraVideoTracks.every(t => currentVideoTracks.some(ct => ct.id === t.id))
          const allAudioTracksPresent = cameraAudioTracks.length === 0 ||
            cameraAudioTracks.every(t => currentAudioTracks.some(ct => ct.id === t.id))
          
          // 检查轨道数量是否匹配
          const videoTracksMatch = currentVideoTracks.length === finalCameraVideoTracks.length
          const audioTracksMatch = currentAudioTracks.length === cameraAudioTracks.length
          
          if (allVideoTracksPresent && allAudioTracksPresent && videoTracksMatch && audioTracksMatch) {
            // 放宽检查：只要轨道未结束就认为正常（连接过程中 readyState 可能不是 'live'）
            const allTracksValid = 
              [...currentVideoTracks, ...currentAudioTracks].every(t => t.readyState !== 'ended')
            if (allTracksValid) {
              // 进一步检查：如果有 live 状态的轨道，说明连接已建立
              const hasLiveTracks = [...currentVideoTracks, ...currentAudioTracks].some(t => t.readyState === 'live')
              if (hasLiveTracks) {
                needsUpdate = false
                console.log('[StudentRoom] 摄像头流已是最新且状态正常，无需更新')
              } else {
                // 轨道存在但还未完全连接，仍然更新以确保显示
                console.log('[StudentRoom] 摄像头流轨道存在但还未完全连接，更新以确保显示')
              }
            } else {
              console.log('[StudentRoom] 摄像头流轨道存在但状态不正常，需要更新')
            }
          } else {
            console.log('[StudentRoom] 摄像头流轨道不匹配，需要更新:', {
              当前视频轨道: currentVideoTracks.length,
              新视频轨道: finalCameraVideoTracks.length,
              当前音频轨道: currentAudioTracks.length,
              新音频轨道: cameraAudioTracks.length
            })
          }
        }
        
        if (needsUpdate) {
          // 方案B：页面刷新后，即使轨道状态不是 'live'，也创建流
          const isPageRefresh = !store.teacherStream
          
          // 过滤掉已结束的轨道（但页面刷新后放宽检查）
          const validVideoTracks = isPageRefresh 
            ? finalCameraVideoTracks  // 页面刷新后，使用所有轨道
            : finalCameraVideoTracks.filter(t => t.readyState !== 'ended')
          const validAudioTracks = isPageRefresh
            ? cameraAudioTracks  // 页面刷新后，使用所有轨道
            : cameraAudioTracks.filter(t => t.readyState !== 'ended')
          
          if (validVideoTracks.length > 0 || validAudioTracks.length > 0) {
            // 创建包含视频和音频的摄像头流
            // 重要：确保音频轨道被正确添加，即使在屏幕共享模式下也要维护摄像头流（用于音频播放）
            const cameraStream = new MediaStream([...validVideoTracks, ...validAudioTracks])
            
            // 验证流创建
            console.log('[StudentRoom] 📦 创建摄像头流:', {
              videoTracks: validVideoTracks.length,
              audioTracks: validAudioTracks.length,
              原始视频轨道数: finalCameraVideoTracks.length,
              原始音频轨道数: cameraAudioTracks.length,
              isPageRefresh,
              流ID: cameraStream.id,
              实际视频轨道: cameraStream.getVideoTracks().length,
              实际音频轨道: cameraStream.getAudioTracks().length
            })
          
            store.setTeacherStream(cameraStream)
            
            // 更新已知摄像头轨道列表（只添加有效的轨道）
            validVideoTracks.forEach(track => {
              knownCameraTrackIds.add(track.id)
            })
            
            console.log('[StudentRoom] ✅ 已更新 teacherStream 到 store（教师摄像头）')
            console.log('[StudentRoom] 摄像头流详情:', {
              streamId: cameraStream.id,
              视频轨道: validVideoTracks.length,
              音频轨道: validAudioTracks.length,
              原始视频轨道: finalCameraVideoTracks.length,
              原始音频轨道: cameraAudioTracks.length,
              有效视频: hasValidFinalVideo,
              有效音频: hasValidCameraAudio,
              显示模式: currentDisplayMode,
            屏幕共享模式: currentDisplayMode === 'screen',
            注意: currentDisplayMode === 'screen' ? '屏幕共享模式下，摄像头流用于小窗口和音频播放' : '正常模式'
          })
          
            // 验证流是否真的被设置
            const streamIdToVerify = cameraStream.id
            setTimeout(() => {
              const verifyStream = store.teacherStream
              if (verifyStream && verifyStream.id === streamIdToVerify) {
                console.log('[StudentRoom] ✅ 验证成功 - teacherStream 已正确设置到 store')
                console.log('[StudentRoom] 验证流轨道:', {
                  视频轨道数: verifyStream.getVideoTracks().length,
                  音频轨道数: verifyStream.getAudioTracks().length,
                  轨道状态: verifyStream.getVideoTracks().map(t => ({
                    id: t.id,
                    enabled: t.enabled,
                    readyState: t.readyState
                  }))
                })
              } else {
                console.error('[StudentRoom] ❌ 验证失败 - teacherStream 未正确设置到 store')
                console.error('[StudentRoom] 期望流ID:', streamIdToVerify)
                console.error('[StudentRoom] 实际流ID:', verifyStream?.id || 'null')
              }
            }, 100)
            
            // 验证音频轨道
            if (validAudioTracks.length > 0) {
              console.log('[StudentRoom] 🔊 音频轨道详情:', validAudioTracks.map(t => ({
                id: t.id,
                label: t.label,
                enabled: t.enabled,
                readyState: t.readyState,
                muted: t.muted
              })))
            }
        }
      } else {
        console.warn('[StudentRoom] ⚠️ 摄像头轨道存在但状态无效:', {
          视频轨道: finalCameraVideoTracks.map(t => ({ id: t.id, enabled: t.enabled, readyState: t.readyState })),
          音频轨道: cameraAudioTracks.map(t => ({ id: t.id, enabled: t.enabled, readyState: t.readyState }))
        })
      }
    } else {
      // 如果没有摄像头轨道，但之前有摄像头流，检查是否需要清理
      if (store.teacherStream && currentDisplayMode === 'screen') {
        // 在屏幕共享模式下，如果没有摄像头轨道，但流仍然存在，可能是正常的（只有音频）
        // 但如果连音频都没有，可能需要清理
        const currentAudioTracks = store.teacherStream.getAudioTracks()
        if (currentAudioTracks.length === 0) {
          console.warn('[StudentRoom] ⚠️ 屏幕共享模式下，没有摄像头轨道和音频轨道，但 teacherStream 仍然存在')
          // 不清理，因为可能只是暂时没有轨道
        }
      }
    }
    
    // 如果流中没有视频轨道，但有音频轨道，可能是纯音频流，设置为摄像头流
    // 但只有在没有屏幕共享轨道时才设置，避免覆盖屏幕共享流
    // 注意：这个逻辑已经被上面的摄像头流处理逻辑覆盖，因为上面已经处理了 cameraAudioTracks
    // 这里保留作为备用，但通常不会执行到这里
    if (cameraVideoTracks.length === 0 && screenVideoTracks.length === 0 && cameraAudioTracks.length > 0) {
      const hasValidAudio = cameraAudioTracks.some(t => t.enabled && t.readyState === 'live')
      
      if (hasValidAudio) {
        // 检查当前流是否已经有这些音频轨道
        const currentTeacherStream = store.teacherStream
        if (!currentTeacherStream || !currentTeacherStream.getAudioTracks().some(t => cameraAudioTracks.some(cat => cat.id === t.id))) {
        const audioOnlyStream = new MediaStream([...cameraAudioTracks])
        store.setTeacherStream(audioOnlyStream)
        console.log('[StudentRoom] ✅ 已设置 teacherStream 到 store（纯音频流）')
        }
      }
    }
        
        // 验证设置结果并检查连接状态
        setTimeout(async () => {
          // 验证摄像头流
          if (cameraVideoTracks.length > 0 || cameraAudioTracks.length > 0) {
            const currentTeacherStream = store.teacherStream
            if (currentTeacherStream) {
              const hasCameraTracks = cameraVideoTracks.some(t => 
                currentTeacherStream.getVideoTracks().some(vt => vt.id === t.id)
              ) || cameraAudioTracks.some(t => 
                currentTeacherStream.getAudioTracks().some(at => at.id === t.id)
              )
              if (hasCameraTracks) {
            console.log('[StudentRoom] ✅ 验证成功 - store.teacherStream 已正确设置')
                console.log('[StudentRoom] 摄像头流状态:', {
                  streamId: currentTeacherStream.id,
                  videoTracks: currentTeacherStream.getVideoTracks().length,
                  audioTracks: currentTeacherStream.getAudioTracks().length
                })
              }
            }
          }
          
          // 验证屏幕共享流
          if (screenVideoTracks.length > 0) {
            const currentScreenStream = store.screenStream
            if (currentScreenStream) {
              const hasScreenTracks = screenVideoTracks.some(t => 
                currentScreenStream.getVideoTracks().some(vt => vt.id === t.id)
              )
              if (hasScreenTracks) {
                console.log('[StudentRoom] ✅ 验证成功 - store.screenStream 已正确设置')
                console.log('[StudentRoom] 屏幕共享流状态:', {
                  streamId: currentScreenStream.id,
                  videoTracks: currentScreenStream.getVideoTracks().length
                })
              }
            }
          }
            
            // 检查 WebRTC 连接状态
            if (rtcManager) {
              const pc = rtcManager.getPeerConnection()
              if (pc) {
                console.log('[StudentRoom] 📊 WebRTC 连接状态检查:', {
                  iceConnectionState: pc.iceConnectionState,
                  connectionState: pc.connectionState,
                  signalingState: pc.signalingState,
                  receivers: pc.getReceivers().length
                })
                
                // 检查连接状态（connectionState 比 iceConnectionState 更重要）
                const connectionState = pc.connectionState
                const iceConnectionState = pc.iceConnectionState
                
                console.log('[StudentRoom] 📊 完整连接状态:', {
                  connectionState,
                  iceConnectionState,
                  signalingState: pc.signalingState
                })
                
                // 只有 connectionState 为 connected 时，媒体流才能真正传输
                if (connectionState === 'connected') {
                  console.log('[StudentRoom] ✅ WebRTC 连接已完全建立（connectionState = connected），检查数据接收...')
                  
                  // 检查接收器统计信息
                  try {
                    const stats = await pc.getStats()
                    let hasVideoData = false
                    
                    stats.forEach(report => {
                      if (report.type === 'inbound-rtp') {
                        const mediaType = (report as any).mediaType
                        const bytesReceived = (report as any).bytesReceived || 0
                        const packetsReceived = (report as any).packetsReceived || 0
                        const framesReceived = (report as any).framesReceived || 0
                        
                        if (mediaType === 'video') {
                          console.log('[StudentRoom] 📊 视频接收统计:', {
                            bytesReceived,
                            packetsReceived,
                            framesReceived,
                            hasData: bytesReceived > 0 || packetsReceived > 0 || framesReceived > 0
                          })
                          
                          if (bytesReceived > 0 || packetsReceived > 0 || framesReceived > 0) {
                            hasVideoData = true
                          } else {
                            console.error('[StudentRoom] ❌ 视频没有接收到任何数据！')
                            console.error('[StudentRoom] 可能的原因：')
                            console.error('[StudentRoom] 1. 教师端没有发送视频流')
                            console.error('[StudentRoom] 2. 网络问题导致数据包丢失')
                            console.error('[StudentRoom] 3. 媒体流未传输（虽然连接已建立）')
                          }
                        } else if (mediaType === 'audio') {
                          console.log('[StudentRoom] 📊 音频接收统计:', {
                            bytesReceived,
                            packetsReceived,
                            hasData: bytesReceived > 0 || packetsReceived > 0
                          })
                        }
                      }
                    })
                    
                    if (!hasVideoData) {
                      console.error('[StudentRoom] ❌ 没有接收到任何视频数据！')
                      console.error('[StudentRoom] 请检查：')
                      console.error('[StudentRoom] 1. 教师端是否开启了摄像头')
                      console.error('[StudentRoom] 2. 教师端是否发送了视频流')
                      console.error('[StudentRoom] 3. 网络连接是否正常')
                    } else {
                      console.log('[StudentRoom] ✅ 已接收到视频数据')
                    }
                  } catch (error) {
                    console.error('[StudentRoom] ❌ 获取统计信息失败:', error)
                  }
                } else if (connectionState === 'connecting') {
                  console.warn('[StudentRoom] ⚠️ 连接状态仍为 connecting，等待 DTLS 握手完成...')
                  console.warn('[StudentRoom] 💡 提示：在无网络环境中，DTLS 握手可能需要更长时间')
                  console.warn('[StudentRoom] 💡 提示：如果长时间停留在 connecting，可能是 DTLS 握手失败')
                  console.warn('[StudentRoom] 💡 提示：可以尝试设置 VITE_USE_STUN=false 禁用 STUN')
                } else {
                  console.warn('[StudentRoom] ⚠️ WebRTC 连接未完全建立:', {
                    connectionState,
                    iceConnectionState
                  })
                  console.warn('[StudentRoom] 等待连接建立...')
                }
              }
          }
        }, 1000) // 延迟到 1 秒后检查，确保连接已建立
    console.log('[StudentRoom] =========================================')
  }
  
  // 设置回调
  if (onTrackCallback) {
    rtcManager.setOnTrack(onTrackCallback)
  }
  
  // 重要：页面刷新后，无论显示模式是什么，如果有轨道，立即触发轨道识别和流创建
  // 这样可以确保摄像头流和屏幕共享流都能在页面刷新后正确恢复
  setTimeout(() => {
    if (rtcManager) {
      const pc = rtcManager.getPeerConnection()
      if (pc) {
        const receivers = pc.getReceivers()
        const videoReceivers = receivers.filter(r => r.track?.kind === 'video' && r.track.readyState !== 'ended')
        const audioReceivers = receivers.filter(r => r.track?.kind === 'audio' && r.track.readyState !== 'ended')
        
        if (videoReceivers.length > 0 || audioReceivers.length > 0) {
          console.log('[StudentRoom] 🔄 页面刷新后检测到已有轨道，立即触发轨道识别和流创建')
          
          // 重要：如果有多个视频轨道，可能一个是摄像头，一个是屏幕共享
          // 即使显示模式不是 'screen'，也应该检查是否有屏幕共享轨道
          // 页面刷新后，可能显示模式还没有恢复，但屏幕共享轨道已经存在
          if (videoReceivers.length > 1) {
            console.log('[StudentRoom] ⚠️ 检测到多个视频轨道，可能包含屏幕共享轨道')
            console.log('[StudentRoom] ⚠️ 将临时设置屏幕共享状态，以便正确识别屏幕共享轨道')
            // 临时设置屏幕共享状态，以便轨道识别逻辑能正确识别屏幕共享轨道
            if (currentStreamType !== 'screen') {
              currentStreamType = 'screen'
              screenShareStartTime = Date.now() - 5000
              console.log('[StudentRoom] 📌 临时恢复屏幕共享状态，用于轨道识别（检测到多个视频轨道）')
            }
            // 如果显示模式不是 'screen'，也临时切换，以便轨道识别逻辑能正确工作
            // 使用类型断言，因为 TypeScript 可能没有正确推断 displayMode 的类型
            if ((store.displayMode as string) !== 'screen') {
              console.log('[StudentRoom] ⚠️ 临时切换显示模式为 screen，以便识别屏幕共享轨道')
              store.setDisplayMode('screen')
            }
          } else if (videoReceivers.length === 1 && (store.displayMode as string) !== 'screen') {
            // 即使只有一个视频轨道，如果显示模式不是 'screen'，也可能是屏幕共享轨道
            // 检查轨道标签，如果是屏幕共享标签，也设置屏幕共享状态
            const track = videoReceivers[0].track
            if (track) {
              const label = track.label?.toLowerCase() || ''
              const isScreen = label.includes('screen') || label.includes('display') || label.includes('desktop') || label.includes('window')
              if (isScreen) {
                console.log('[StudentRoom] ⚠️ 检测到单个视频轨道，但标签是屏幕共享，设置屏幕共享状态')
                if (currentStreamType !== 'screen') {
                  currentStreamType = 'screen'
                  screenShareStartTime = Date.now() - 5000
                  console.log('[StudentRoom] 📌 临时恢复屏幕共享状态，用于轨道识别（检测到屏幕共享标签）')
                }
                // 使用类型断言，因为 TypeScript 可能没有正确推断 displayMode 的类型
                if ((store.displayMode as string) !== 'screen') {
                  console.log('[StudentRoom] ⚠️ 临时切换显示模式为 screen（检测到屏幕共享标签）')
                  store.setDisplayMode('screen')
                }
              }
            }
          }
          
          console.log('[StudentRoom] 轨道统计:', {
            视频接收器: videoReceivers.length,
            音频接收器: audioReceivers.length,
            显示模式: store.displayMode,
            屏幕共享状态: currentStreamType === 'screen' ? '已恢复' : '未恢复',
            当前摄像头流: store.teacherStream ? `stream-${store.teacherStream.id}` : 'null',
            当前屏幕共享流: store.screenStream ? `stream-${store.screenStream.id}` : 'null',
            注意: videoReceivers.length > 1 ? '多个视频轨道，可能包含屏幕共享' : '单个视频轨道'
          })
          
          // 手动触发 onTrack 回调，以便立即识别和创建所有流（摄像头和屏幕共享）
          if (onTrackCallback) {
            console.log('[StudentRoom] ✅ 手动触发 onTrack 回调，恢复所有流')
            onTrackCallback()
          } else {
            console.warn('[StudentRoom] ⚠️ onTrackCallback 未设置，无法触发轨道识别')
          }
        } else {
          console.log('[StudentRoom] 📊 页面刷新后，暂无轨道，等待 Offer 到达')
        }
      } else {
        console.log('[StudentRoom] 📊 页面刷新后，PeerConnection 尚未建立，等待连接建立')
      }
    }
  }, 2000) // 延迟2秒，确保连接已建立，Offer 已处理，轨道已到达
  
  // 设置 ICE candidate 回调
  rtcManager.setOnIceCandidate((candidate) => {
    if (signalService) {
      // 发送给教师端（使用 'broadcast' 或教师 ID）
      console.log('[StudentRoom] 📤 生成 ICE candidate，准备发送给教师端:', {
        candidate: candidate.candidate ? candidate.candidate.substring(0, 50) + '...' : 'null',
        sdpMLineIndex: candidate.sdpMLineIndex,
        sdpMid: candidate.sdpMid,
        kind: candidate.sdpMid === '0' ? 'video' : candidate.sdpMid === '1' ? 'audio' : 'unknown'
      })
      signalService.sendIceCandidate('broadcast', candidate)
      console.log('[StudentRoom] ✅ 已发送 ICE candidate 给教师端')
    } else {
      console.warn('[StudentRoom] ⚠️ signalService 不可用，无法发送 ICE candidate')
    }
  })
  
  // 初始化 WebSocket
  signalService = new SignalService()
  
  // 更新提供给子组件的 signalService
  signalServiceRef.value = signalService
  
  // 更新网络监听器的 signalService
  if (networkMonitor) {
    networkMonitor.updateSignalService(signalService)
  }
  
  // 确保在 WebSocket 连接建立后再设置监听器和加入房间
  const setupAfterConnection = () => {
    return new Promise<void>((resolve) => {
      if (signalService?.isConnected) {
        console.log('[StudentRoom] WebSocket 已连接，设置监听器')
        resolve()
      } else {
        console.log('[StudentRoom] 等待 WebSocket 连接...')
        if (signalService) {
          // 如果已经连接，直接 resolve
          if (signalService.isConnected) {
            console.log('[StudentRoom] Socket 已连接')
            resolve()
            return
          }
          // 监听连接事件
          const onConnect = () => {
            console.log('[StudentRoom] WebSocket 连接成功，设置监听器')
            if (signalService) {
              signalService.off('connect', onConnect) // 移除监听器，避免重复
            }
            resolve()
          }
          if (signalService) {
            signalService.on('connect', onConnect)
          }
        } else {
          console.warn('[StudentRoom] SignalService 不可用')
        }
        // 如果 3 秒后还没连接，也继续（可能是离线模式）
        setTimeout(() => {
          console.warn('[StudentRoom] WebSocket 连接超时，继续执行（可能是离线模式）')
          resolve()
        }, 3000)
      }
    })
  }
  
  // 使用 await 等待 WebSocket 连接建立
  await setupAfterConnection()
  
  // 再次确认 socket 连接状态
  console.log('[StudentRoom] Socket 连接状态:', {
    isConnected: signalService?.isConnected,
    hasSignalService: !!signalService
  })
  
  // 添加连接状态监听
  if (signalService) {
    signalService.on('connect', () => {
      console.log('[StudentRoom] ✅ Socket 已连接')
    })
    signalService.on('disconnect', () => {
      console.log('[StudentRoom] ❌ Socket 已断开连接')
    })
    signalService.on('error', (error: any) => {
      console.error('[StudentRoom] ❌ Socket 错误:', error)
    })
  }
  
  // 监听信令事件（必须在加入房间之前设置，确保能收到所有事件）
  setupSignalListeners()
  
  // 确保 socket 已连接后再加入房间
  if (!signalService?.isConnected) {
    console.warn('[StudentRoom] ⚠️ Socket 未连接，等待连接后再加入房间...')
    if (signalService) {
      await new Promise<void>((resolve) => {
        if (signalService && signalService.isConnected) {
          resolve()
        } else if (signalService) {
          const onConnect = () => {
            console.log('[StudentRoom] Socket 连接成功，现在加入房间')
            if (signalService) {
              signalService.off('connect', onConnect)
            }
            resolve()
          }
          if (signalService) {
            signalService.on('connect', onConnect)
            setTimeout(() => {
              if (signalService) {
                signalService.off('connect', onConnect)
              }
              console.warn('[StudentRoom] 等待连接超时，继续执行')
              resolve()
            }, 5000)
          }
        }
      })
    }
  }
  
  // 加入房间
  if (signalService) {
    // 优先从 micro-app 主应用获取 roomId，否则使用默认值
    const roomId = microAppData?.wsConfig?.roomId
    const userId = currentUserId.value
    
    // 从微前端主应用获取 userName，如果没有则使用默认值
    const userName = microAppData?.userName || microAppData?.wsConfig?.userName || '学生'
    
    // 确保 classroomId 是数字类型（后端要求）
    const classroomId = typeof roomId === 'string' ? parseInt(roomId) || 1 : roomId
    const userIdNum = typeof userId === 'string' ? parseInt(userId) || 1 : userId
    
    console.log('[StudentRoom] 准备加入房间:', {
      roomId,
      classroomId,
      userId,
      userIdNum,
      userName,
      socketConnected: signalService?.isConnected,
      fromMicroApp: !!microAppData
    })
    
    signalService.joinRoom(classroomId, userIdNum, {
      name: userName,
      role: 'student'
    })
    
    console.log('[StudentRoom] ✅ 已发送加入房间请求')
    
    // 学生端只要能进入直播间并加入房间，就表示教师端的直播状态已开启
    // 自动开启直播状态
    if (!store.isLive) {
      store.startLive()
      console.log('[StudentRoom] ✅ 已自动开启直播状态（加入房间成功）')
    }
    
    // 验证 roomId 和 userId 是否已设置
    setTimeout(() => {
      if (signalService) {
        console.log('[StudentRoom] 验证加入房间状态:', {
          roomId: (signalService as any)['roomId'],
          userId: (signalService as any)['userId'],
          socketConnected: signalService?.isConnected,
          isLive: store.isLive
        })
      }
    }, 500)
  }
  
  // 监听用户加入事件（后端事件：onUserJoinClassroom）
  if (signalService) {
    signalService.on('onUserJoinClassroom', async (data) => {
      console.log('[StudentRoom] 用户加入房间:', data)
      // 使用后端返回的总人数
      if (data.totalNum !== undefined) {
        store.updateOnlineCount(data.totalNum)
        console.log('[StudentRoom] 在线人数更新为（后端）:', data.totalNum)
      }
      
      // 学生端只监听教师端的推流事件，不需要主动请求
    })
    
    // 监听用户离开事件（后端事件：onUserLeaveClassroom）
    signalService.on('onUserLeaveClassroom', (data) => {
      console.log('[StudentRoom] 用户离开房间:', data)
      // 使用后端返回的总人数
      if (data.totalNum !== undefined) {
        store.updateOnlineCount(data.totalNum)
        console.log('[StudentRoom] 在线人数更新为（后端）:', data.totalNum)
      }
    })
    
    // 监听下课事件（后端事件：onFinishClass）
    signalService.on('onFinishClass', (data) => {
      console.log('[StudentRoom] ✅ 收到下课命令:', data)
      // 停止直播
      if (store.isLive) {
        store.stopLive()
        console.log('[StudentRoom] ✅ 直播已停止（下课）')
      }
    })
    
    // 监听发起投票事件（后端事件：onStartVote）- 学生端
    signalService.on('onStartVote', (data) => {
      console.log('[StudentRoom] 📊 收到发起投票:', data)
      try {
        const voteData = data.jsonStr ? JSON.parse(data.jsonStr) : {}
        console.log('[StudentRoom] 投票数据:', voteData)
        
        // 显示投票弹窗并保存到 store
        if (voteData.title && voteData.options && Array.isArray(voteData.options)) {
          const voteId = voteData.voteId?.toString() || Date.now().toString()
          
          // 检查投票是否已存在，避免重复添加
          const existingVote = store.votes.find(v => v.id === voteId)
          if (!existingVote) {
            // 将投票保存到 store
            const vote: Vote = {
              id: voteId,
              title: voteData.title,
              content: voteData.content || '',
              duration: voteData.duration || 60,
              options: voteData.options,
              isActive: true,
              createdAt: voteData.createdAt || Date.now()
            }
            store.createVote(vote)
            console.log('[StudentRoom] ✅ 已保存投票到 store:', voteId)
          } else {
            console.log('[StudentRoom] ℹ️ 投票已存在，更新为活跃状态:', voteId)
            // 如果投票已存在，确保它是活跃状态
            existingVote.isActive = true
            store.currentVote = existingVote
          }
          
          // 设置当前投票数据用于弹窗显示
          currentVoteData.value = {
            voteId: voteId,
            title: voteData.title,
            content: voteData.content || '',
            duration: voteData.duration,
            options: voteData.options,
            createdAt: voteData.createdAt
          }
          selectedVoteOption.value = null
          showVoteDialog.value = true
          console.log('[StudentRoom] ✅ 已显示投票弹窗')
        } else {
          console.warn('[StudentRoom] ⚠️ 投票数据格式不正确:', voteData)
        }
      } catch (e) {
        console.error('[StudentRoom] 解析投票数据失败:', e)
      }
    })
    
    // 监听随堂练习事件（后端事件：onTaskStart）- 学生端
    signalService.on('onTaskStart', (data) => {
      console.log('[StudentRoom] 📝 收到随堂练习:', data)
      try {
        const taskData = data.jsonStr ? JSON.parse(data.jsonStr) : {}
        // 这里可以触发练习弹窗或更新 store
        // store.startTask(data.itemId, taskData)
        console.log('[StudentRoom] 练习数据:', taskData)
        
        // 将数据发送给主应用
        sendDataToMainApp({
          type: 'onTaskStart',
          data: {
            id: data.id,
            itemId: data.itemId,
            taskData: taskData,
            jsonStr: data.jsonStr
          }
        })
        console.log('[StudentRoom] ✅ 已向主应用发送随堂练习数据')
      } catch (e) {
        console.error('[StudentRoom] 解析练习数据失败:', e)
      }
    })
    
    // 监听举手事件（后端事件：onHandUp）- 教师端会收到，学生端也可以监听自己的举手状态
    signalService.on('onHandUp', (data) => {
      console.log('[StudentRoom] ✋ 收到举手信息:', data)
      try {
        const handData = data.jsonStr ? JSON.parse(data.jsonStr) : {}
        // 这里可以更新举手列表
        console.log('[StudentRoom] 举手数据:', handData)
      } catch (e) {
        console.error('[StudentRoom] 解析举手数据失败:', e)
      }
    })
    
    // 监听发言/发言设置事件（后端事件：onClassroomMsg）
    signalService.on('onClassroomMsg', (data) => {
      console.log('[StudentRoom] 💬 收到发言消息:', data)
      try {
        const msgData = data.jsonStr ? JSON.parse(data.jsonStr) : {}
        // 处理投票结束事件
        if (msgData.action === 'finish' && msgData.voteId) {
          const voteId = msgData.voteId.toString()
          console.log('[StudentRoom] 📊 收到投票结束通知:', voteId)
          store.finishVote(voteId)
          // 如果当前显示的投票已结束，关闭弹窗并清除数据
          if (currentVoteData.value?.voteId === voteId) {
            showVoteDialog.value = false
            currentVoteData.value = null
            selectedVoteOption.value = null
            console.log('[StudentRoom] ✅ 投票已结束，已关闭投票弹窗并清除数据')
          }
          // 清除 store 中的 currentVote（学生端，投票结束后不再显示）
          if (store.currentVote && store.currentVote.id === voteId) {
            store.currentVote = null
          }
        } else {
          // 这里可以处理其他发言相关的逻辑
          console.log('[StudentRoom] 发言数据:', msgData)
        }
      } catch (e) {
        console.error('[StudentRoom] 解析发言数据失败:', e)
      }
    })
    
    // 监听聊天模式变化事件（教师端发送的 chatModeChange）
    signalService.on('chatModeChanged', (data) => {
      console.log('[StudentRoom] 🔄 收到聊天模式变化:', data)
      if (data.mode && ['all', 'teacher', 'muted'].includes(data.mode)) {
        store.chatMode = data.mode
        console.log('[StudentRoom] ✅ 聊天模式已更新为:', data.mode)
      } else {
        console.warn('[StudentRoom] ⚠️ 聊天模式数据格式不正确:', data)
      }
    })
  }
  
  // 监听 teacherStream 变化，确保组件能响应
  watch(() => store.teacherStream, (newStream, oldStream) => {
    console.log('[StudentRoom] store.teacherStream 变化:', {
      old: oldStream?.id,
      new: newStream?.id,
      hasVideo: newStream ? newStream.getVideoTracks().length > 0 : false,
      hasAudio: newStream ? newStream.getAudioTracks().length > 0 : false
    })
  }, { immediate: true, deep: true })

// 监听 isLive 变化，用于调试
  watch(() => store.isLive, (newValue, oldValue) => {
    console.log('[StudentRoom] ⚡ isLive 状态变化:', {
      old: oldValue,
      new: newValue,
      timestamp: new Date().toLocaleTimeString()
    })
    console.log('[StudentRoom] ⚡ computed isLive 值:', isLive.value)
    console.log('[StudentRoom] ⚡ store.isLive 值:', store.isLive)
    
    // 强制触发 UI 更新
    if (newValue !== oldValue) {
      console.log('[StudentRoom] ✅ isLive 已从', oldValue, '变为', newValue, '，UI 应该更新')
    }
  }, { immediate: true, deep: true })
  
  // 也监听 computed isLive 的变化
  watch(isLive, (newValue, oldValue) => {
    console.log('[StudentRoom] ⚡ computed isLive 变化:', {
      old: oldValue,
      new: newValue,
      timestamp: new Date().toLocaleTimeString()
    })
  }, { immediate: true })

  // 监听父应用发送的 URL 推流请求
  if (isMicroApp()) {
    onMicroAppDataChange((data: any) => {
      console.log('[StudentRoom] 收到父应用数据变化:', data)
      
      // 检查是否是 URL 推流请求
      if (data.type === 'pushUrl' || data.type === 'pushDocumentUrl') {
        const url = data.url || data.documentUrl
        const name = data.name || data.documentName || '父应用推送的资源'
        const documentType = data.documentType || detectDocumentType(url)
        
        if (url) {
          console.log('[StudentRoom] 收到父应用 URL 推流请求:', { url, name, documentType })
          
          // 创建文档对象
          const document: Document = {
            id: `url-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: name,
            type: documentType,
            url: url
          }
          
          // 添加到文档列表并切换显示
          store.addDocument(document)
          store.switchDocument(document.id)
          store.setDisplayMode('document')
          
          console.log('[StudentRoom] ✅ URL 推流成功，已添加到文档列表并显示')
        } else {
          console.warn('[StudentRoom] ⚠️ URL 推流请求中缺少 url 字段')
        }
      }
    })
    console.log('[StudentRoom] 已注册父应用数据变化监听器')
  }
})

// 根据 URL 检测文档类型
function detectDocumentType(url: string): 'ppt' | 'pdf' | 'image' | 'video' | 'audio' {
  const lowerUrl = url.toLowerCase()
  
  if (lowerUrl.includes('.pdf')) return 'pdf'
  if (lowerUrl.includes('.ppt') || lowerUrl.includes('.pptx')) return 'ppt'
  if (lowerUrl.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/)) return 'image'
  if (lowerUrl.match(/\.(mp4|webm|ogg|mov|avi|flv|wmv)$/)) return 'video'
  if (lowerUrl.match(/\.(mp3|wav|ogg|aac|m4a)$/)) return 'audio'
  
  // 默认返回图片类型（用于在线图片 URL）
  if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) {
    return 'image'
  }
  
  return 'pdf' // 默认返回 PDF
}

onUnmounted(() => {
  if (networkMonitor) {
    networkMonitor.destroy()
    networkMonitor = null
  }
  if (rtcManager) {
    rtcManager.close()
  }
  if (signalService) {
    signalService.disconnect()
  }
  // 注意：在线人数会通过 room:user-left 事件自动更新，这里不需要手动更新
})

function setupSignalListeners() {
  if (!signalService || !rtcManager) {
    console.warn('[StudentRoom] setupSignalListeners: signalService 或 rtcManager 不可用', {
      hasSignalService: !!signalService,
      hasRtcManager: !!rtcManager
    })
    return
  }

  console.log('[StudentRoom] 设置信令监听器...')
  console.log('[StudentRoom] signalService 状态:', {
    isConnected: signalService.isConnected,
    hasSocket: !!signalService.socketInstance,
    classroomId: signalService.currentClassroomId
  })

  // 监听直播开始事件 - 必须在最前面设置，确保能收到事件
  console.log('[StudentRoom] 🔴 准备注册 liveStarted 事件监听器...')
  console.log('[StudentRoom] signalService 状态:', {
    hasSignalService: !!signalService,
    isConnected: signalService?.isConnected,
    hasListeners: signalService ? (signalService as any).eventListeners?.has('liveStarted') : false
  })
  
  signalService.on('liveStarted', (data) => {
    console.log('[StudentRoom] ✅✅✅✅✅ 收到直播开始事件:', data)
    console.log('[StudentRoom] ========== 直播开始事件详情 ==========')
    console.log('[StudentRoom] 事件数据:', JSON.stringify(data, null, 2))
    console.log('[StudentRoom] 当前 isLive 状态:', store.isLive)
    console.log('[StudentRoom] 事件数据详情:', {
      hasStartTime: !!data.startTime,
      startTime: data.startTime ? new Date(data.startTime).toLocaleString() : 'undefined',
      dataKeys: Object.keys(data),
      fullData: data
    })
    
    // 使用服务器发送的开始时间更新状态，确保所有客户端显示相同的直播时长
    try {
      const serverStartTime = data.startTime || Date.now()
      store.startLive(serverStartTime)
      console.log('[StudentRoom] ✅ store.startLive() 调用成功，开播时间:', new Date(serverStartTime).toLocaleString())
      
      // 立即检查状态
      console.log('[StudentRoom] 立即检查 isLive 状态:', store.isLive)
      
      // 根据开播时间做判断：如果开播时间已经过了很久，可能需要特殊处理
      const now = Date.now()
      const elapsed = now - serverStartTime
      const oneHour = 60 * 60 * 1000
      if (elapsed > oneHour) {
        console.warn('[StudentRoom] ⚠️ 开播时间已超过1小时，可能需要特殊处理')
      }
      
      // 等待一下，确保状态已更新
      setTimeout(() => {
        console.log('[StudentRoom] ✅ 直播已开始，开始时间:', new Date(serverStartTime).toLocaleString())
        console.log('[StudentRoom] 更新后 isLive 状态:', store.isLive)
        console.log('[StudentRoom] store.isLive 类型:', typeof store.isLive)
        console.log('[StudentRoom] store.isLive 值:', store.isLive)
      }, 100)
    } catch (error) {
      console.error('[StudentRoom] ❌ 调用 store.startLive() 失败:', error)
    }
  })
  
  console.log('[StudentRoom] ✅ liveStarted 事件监听器已设置（监听后端 lesson 事件）')
  
  // 监听直播停止事件
  signalService.on('liveStopped', () => {
    console.log('[StudentRoom] ✅ 收到直播停止事件')
    if (store.isLive) {
      store.stopLive()
      console.log('[StudentRoom] ✅ 直播已停止')
    } else {
      console.log('[StudentRoom] ⚠️ 直播未在进行中，忽略停止事件')
    }
  })

  // 监听聊天消息
  signalService.on('chatMessage', (message) => {
    console.log('[StudentRoom] 💬 收到 chatMessage 事件:', message)
    console.log('[StudentRoom] 📊 消息详情:', {
      id: message.id,
      userId: message.userId,
      userName: message.userName,
      content: message.content,
      isTeacher: message.isTeacher,
      timestamp: message.timestamp,
      storeMessagesCount: store.chatMessages.length
    })
    store.addChatMessage(message)
    console.log('[StudentRoom] ✅ 消息已添加到 store，当前消息数:', store.chatMessages.length)
  })

  // 监听取消举手事件（学生端也需要监听，以便更新本地状态）
  signalService.on('raiseHandCancel', (data) => {
    console.log('[StudentRoom] ✋ 收到取消举手事件:', data)
    if (data.userId) {
      store.removeRaiseHandRequest(data.userId)
    }
  })

  // 监听允许上麦事件
  signalService.on('raiseHandAllowed', (data) => {
    console.log('[StudentRoom] ✋ 收到允许上麦事件:', data)
    if (data.userId === currentUserId.value) {
      // 如果是当前学生，移除举手请求
      store.allowStudent(data.userId)
      console.log('[StudentRoom] ✅ 当前学生已被允许上麦')
    }
  })

  // 监听互动题
  signalService.on('quizCreated', (quiz) => {
    store.createQuiz(quiz)
  })

  // 监听白板绘制
  signalService.on('whiteboardDraw', (data: { action: string; data: any }) => {
    console.log('[StudentRoom] 📝 收到白板绘制事件:', data)
    console.log('[StudentRoom] 事件详情:', {
      action: data.action,
      hasData: !!data.data,
      dataType: typeof data.data,
      dataKeys: data.data ? Object.keys(data.data) : [],
      whiteboardRef: !!whiteboardRef.value,
      displayMode: store.displayMode,
      whiteboardEnabled: store.whiteboardEnabled
    })
    
    // 如果收到白板绘制事件，说明白板已启用，自动切换到白板模式
    if (store.displayMode !== 'whiteboard') {
      console.log('[StudentRoom] 🔄 收到白板绘制事件，自动切换到白板模式（当前模式:', store.displayMode, '）')
      // 自动启用白板并切换模式
      store.whiteboardEnabled = true
      store.setDisplayMode('whiteboard')
      console.log('[StudentRoom] ✅ 已切换到白板模式')
      
      // 延迟应用绘制，等待白板组件挂载，使用重试机制
      let retryCount = 0
      const maxRetries = 10
      const retryInterval = setInterval(() => {
        retryCount++
        if (whiteboardRef.value && data.action && data.data) {
          console.log('[StudentRoom] ✅ 白板组件已就绪，应用绘制 (重试 ' + retryCount + '):', data.action)
          try {
            whiteboardRef.value.applyRemoteDraw(data.action, data.data)
            clearInterval(retryInterval)
          } catch (error) {
            console.error('[StudentRoom] ❌ 应用绘制失败:', error)
            if (retryCount >= maxRetries) {
              clearInterval(retryInterval)
            }
          }
        } else if (retryCount >= maxRetries) {
          console.error('[StudentRoom] ❌ 重试次数超限，白板组件仍未就绪')
          clearInterval(retryInterval)
        }
      }, 100)
      return
    }
    
    if (!whiteboardRef.value) {
      console.warn('[StudentRoom] ⚠️ whiteboardRef 为空，等待组件挂载...')
      // 延迟重试，最多重试5次
      let retryCount = 0
      const maxRetries = 5
      const retryInterval = setInterval(() => {
        retryCount++
        if (whiteboardRef.value && data.action && data.data) {
          console.log('[StudentRoom] 延迟应用绘制 (重试 ' + retryCount + '):', data.action)
          whiteboardRef.value.applyRemoteDraw(data.action, data.data)
          clearInterval(retryInterval)
        } else if (retryCount >= maxRetries) {
          console.error('[StudentRoom] ❌ 重试次数超限，无法应用绘制')
          clearInterval(retryInterval)
        }
      }, 100)
      return
    }
    
    // 确保数据格式正确
    const action = data.action
    const drawData = data.data
    
    if (action && drawData) {
      try {
        console.log('[StudentRoom] 准备应用远程绘制:', {
          action,
          dataType: typeof drawData,
          dataKeys: Object.keys(drawData),
          hasType: !!drawData.type,
          hasPath: !!drawData.path,
          hasId: !!drawData.id
        })
        whiteboardRef.value.applyRemoteDraw(action, drawData)
        console.log('[StudentRoom] ✅ 已应用远程绘制:', action)
      } catch (error) {
        console.error('[StudentRoom] ❌ 应用远程绘制失败:', error)
        console.error('[StudentRoom] 错误堆栈:', (error as Error).stack)
        console.error('[StudentRoom] 失败的数据:', { action, drawData })
      }
    } else {
      console.warn('[StudentRoom] ⚠️ 绘制数据不完整:', {
        hasAction: !!action,
        hasData: !!drawData,
        action: action,
        data: drawData,
        fullData: data
      })
    }
  })
  
  // 监听白板清除
  signalService.on('whiteboardClear', () => {
    console.log('[StudentRoom] 📝 收到白板清除事件')
    if (whiteboardRef.value) {
      whiteboardRef.value.clear()
      console.log('[StudentRoom] ✅ 已清空白板')
    }
  })
  
  // 监听白板状态变化
  signalService.on('whiteboardEnabled', (data) => {
    console.log('[StudentRoom] 📝 收到白板状态变化事件:', data.enabled)
    store.whiteboardEnabled = data.enabled
    if (data.enabled) {
      store.setDisplayMode('whiteboard')
      console.log('[StudentRoom] ✅ 已切换到白板模式')
      // 确保白板组件已初始化
      setTimeout(() => {
        if (whiteboardRef.value) {
          console.log('[StudentRoom] ✅ 白板组件已就绪')
        } else {
          console.warn('[StudentRoom] ⚠️ 白板组件未就绪')
        }
      }, 200)
    } else {
      store.setDisplayMode('document')
      console.log('[StudentRoom] ✅ 已切换回文档模式')
    }
  })
  
  // 监听画布状态同步（类似投屏的完整画面传输）
  signalService.on('whiteboardSyncState', (data: { canvasState: any }) => {
    console.log('[StudentRoom] 📝 收到画布状态同步事件:', {
      hasCanvasState: !!data.canvasState,
      objectsCount: data.canvasState?.objects?.length || 0,
      whiteboardRef: !!whiteboardRef.value,
      displayMode: store.displayMode,
      whiteboardEnabled: store.whiteboardEnabled
    })
    
    // 如果收到画布状态同步，说明白板已启用，自动切换到白板模式
    if (store.displayMode !== 'whiteboard') {
      console.log('[StudentRoom] 🔄 收到画布状态同步，自动切换到白板模式')
      store.whiteboardEnabled = true
      store.setDisplayMode('whiteboard')
    }
    
    // 延迟应用画布状态，等待白板组件挂载
    let retryCount = 0
    const maxRetries = 10
    const retryInterval = setInterval(() => {
      retryCount++
      if (whiteboardRef.value && data.canvasState) {
        console.log('[StudentRoom] ✅ 白板组件已就绪，应用画布状态 (重试 ' + retryCount + ')')
        try {
          whiteboardRef.value.setCanvasState(data.canvasState)
          clearInterval(retryInterval)
        } catch (error) {
          console.error('[StudentRoom] ❌ 应用画布状态失败:', error)
          if (retryCount >= maxRetries) {
            clearInterval(retryInterval)
          }
        }
      } else if (retryCount >= maxRetries) {
        console.error('[StudentRoom] ❌ 重试次数超限，白板组件仍未就绪')
        clearInterval(retryInterval)
      }
    }, 100)
  })
  
  console.log('[StudentRoom] ✅ 信令监听器设置完成')

  // 监听屏幕共享（使用后端 onScreenSharing 事件）
  signalService.on('onScreenSharing', async (data) => {
    console.log('[StudentRoom] ========== 📺 收到屏幕共享事件 ==========')
    console.log('[StudentRoom] 📺 收到屏幕共享事件:', data)
    try {
      // 从 jsonStr 中解析数据
      const screenData = data.jsonStr ? JSON.parse(data.jsonStr) : {}
      const action = screenData.action || 'start'
      
      console.log('[StudentRoom] 屏幕共享操作:', action, '数据:', screenData)
      console.log('[StudentRoom] 当前状态:', {
        displayMode: store.displayMode,
        hasScreenStream: !!store.screenStream,
        screenShareStartTime: screenShareStartTime > 0 ? new Date(screenShareStartTime).toISOString() : 0,
        currentStreamType
      })
      
      if (action === 'start') {
        console.log('[StudentRoom] 📺 开始屏幕共享')
        console.log('[StudentRoom] ✅ 进入屏幕共享开始逻辑')
        
        // 记录屏幕共享开始的时间戳（必须在设置 currentStreamType 之前）
        screenShareStartTime = Date.now()
        // 设置当前流类型为 'screen'，以便后续的 onMediaOffer 和 ontrack 能够正确识别
        currentStreamType = 'screen'
        console.log('[StudentRoom] 📌 已设置 currentStreamType 为 screen，屏幕共享开始时间戳:', screenShareStartTime)
        
        // 重要：在开始新的屏幕共享时，清除旧的屏幕共享流引用（但不停止轨道，让 ontrack 处理）
        // 这样可以确保 ontrack 回调能正确识别新旧轨道
        // 注意：不在这里停止轨道，因为停止轨道会导致 PeerConnection 状态混乱
        // 让 ontrack 回调来处理轨道的清理和重新创建
        if (store.screenStream) {
          console.log('[StudentRoom] 🔄 清除旧的屏幕共享流引用（保留轨道，让 ontrack 处理）')
          console.log('[StudentRoom] 旧流轨道ID:', store.screenStream.getTracks().map(t => t.id))
          // 不停止轨道，只清除引用，让 ontrack 回调来处理轨道的清理和重新创建
          store.setScreenStream(null)
        }
        
        // 重要：清除 PeerConnection 中旧的屏幕共享接收器（如果有）
        // 这样可以确保只接收新的屏幕共享轨道
        if (rtcManager) {
          const pc = rtcManager.getPeerConnection()
          if (pc) {
            const receivers = pc.getReceivers()
            const oldScreenReceivers = receivers.filter(receiver => {
              const track = receiver.track
              if (!track || track.kind !== 'video') return false
              const label = track.label?.toLowerCase() || ''
              const isScreen = label.includes('screen') || label.includes('display') || label.includes('desktop') || label.includes('window')
              return isScreen
            })
            
            if (oldScreenReceivers.length > 0) {
              console.log('[StudentRoom] 找到旧的屏幕共享接收器数量:', oldScreenReceivers.length)
              console.log('[StudentRoom] 旧的屏幕共享接收器详情:', oldScreenReceivers.map(r => ({
                trackId: r.track?.id,
                trackLabel: r.track?.label,
                trackReadyState: r.track?.readyState,
                trackEnabled: r.track?.enabled,
                trackMuted: r.track?.muted
              })))
              
              // 重要：停止所有旧的屏幕共享轨道，确保不会使用旧的已停止的轨道
              oldScreenReceivers.forEach(receiver => {
                if (receiver.track) {
                  console.log('[StudentRoom] 停止旧的屏幕共享接收器轨道:', receiver.track.id, {
                    label: receiver.track.label,
                    readyState: receiver.track.readyState,
                    enabled: receiver.track.enabled,
                    muted: receiver.track.muted
                  })
                  receiver.track.stop()
                }
              })
              
              // 等待一下，确保轨道被停止
              await new Promise(resolve => setTimeout(resolve, 100))
            }
          }
        }
        
        // 切换显示模式为 screen
        console.log('[StudentRoom] 切换显示模式为 screen')
        store.setDisplayMode('screen')
        console.log('[StudentRoom] 当前显示模式:', store.displayMode)
        console.log('[StudentRoom] 当前 screenStream:', store.screenStream ? `stream-${store.screenStream.id}` : 'null')
        console.log('[StudentRoom] 📌 已设置 currentStreamType 为 screen，等待 onMediaOffer 到达')
        
        // 重要：清除已知的摄像头轨道列表，因为新的屏幕共享轨道可能和摄像头轨道混淆
        // 但保留已有的摄像头轨道ID，用于区分
        console.log('[StudentRoom] 📊 已知摄像头轨道数量:', knownCameraTrackIds.size)
        
        // 立即检查并设置屏幕共享流（如果已经存在）
        // 重要：第三次推流时，ontrack 事件可能不会触发，所以必须在这里手动检查接收器
        console.log('[StudentRoom] 🔍 开始手动检查接收器（屏幕共享开始事件）')
        if (rtcManager) {
          const pc = rtcManager.getPeerConnection()
          if (pc) {
            const receivers = pc.getReceivers()
            const videoReceivers = receivers.filter(r => r.track?.kind === 'video')
            console.log('[StudentRoom] ✅ 手动检查接收器:', {
              总接收器数: receivers.length,
              视频接收器数: videoReceivers.length,
              PeerConnection状态: pc.connectionState,
              signalingState: pc.signalingState
            })
            
            // 收集所有明确的屏幕共享轨道
            const screenTracks: MediaStreamTrack[] = []
            // 收集所有明确的摄像头轨道
            const cameraTracks: MediaStreamTrack[] = []
            // 收集标签不明确的轨道
            const ambiguousTracks: MediaStreamTrack[] = []
            
            videoReceivers.forEach((receiver, index) => {
              if (receiver.track) {
                const track = receiver.track
                const label = track.label?.toLowerCase() || ''
                const isScreen = label.includes('screen') || label.includes('display') || label.includes('desktop') || label.includes('window')
                const isCamera = label.includes('camera') || label.includes('webcam') || label.includes('video') || label.includes('user')
                
                // 重要：过滤掉已停止的轨道（readyState 不是 'live' 或 muted: true）
                // 但如果是屏幕共享刚刚开始，允许使用暂时 muted 的轨道
                const isScreenShareJustStarted = screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000
                const isTrackStopped = track.readyState !== 'live' || (track.muted && !isScreenShareJustStarted)
                
                console.log(`[StudentRoom] 接收器 ${index}:`, {
                  label: track.label,
                  isScreen,
                  isCamera,
                  enabled: track.enabled,
                  readyState: track.readyState,
                  muted: track.muted,
                  trackId: track.id,
                  在已知摄像头列表中: knownCameraTrackIds.has(track.id),
                  轨道已停止: isTrackStopped,
                  屏幕共享刚刚开始: isScreenShareJustStarted
                })
                
                // 如果轨道已停止，跳过（除非是屏幕共享刚刚开始）
                if (isTrackStopped && !isScreenShareJustStarted) {
                  console.log(`[StudentRoom] ⚠️ 跳过已停止的轨道:`, track.id, {
                    label: track.label,
                    readyState: track.readyState,
                    muted: track.muted
                  })
                  return
                }
                
                if (isScreen) {
                  screenTracks.push(track)
                  console.log('[StudentRoom] ✅ 找到明确的屏幕共享轨道:', track.label)
                } else if (isCamera || knownCameraTrackIds.has(track.id)) {
                  cameraTracks.push(track)
                  console.log('[StudentRoom] ✅ 找到明确的摄像头轨道:', track.label)
                } else {
                  ambiguousTracks.push(track)
                  console.log('[StudentRoom] ⚠️ 找到标签不明确的轨道:', track.label)
                }
              }
            })
            
            // 重要：在开始新的屏幕共享时，优先使用现有轨道创建流
            // 即使轨道暂时 muted，也应该创建流（因为数据可能正在传输中）
            // 这样可以确保学生端能立即显示，而不是一直等待
            
            console.log('[StudentRoom] 🔍 手动检查接收器结果:', {
              明确的屏幕共享轨道: screenTracks.length,
              明确的摄像头轨道: cameraTracks.length,
              标签不明确的轨道: ambiguousTracks.length,
              屏幕共享刚刚开始: screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000
            })
            
            // 如果屏幕共享刚刚开始，且没有明确的屏幕共享轨道，尝试从其他轨道中识别
            const isScreenShareJustStarted = screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000
            if (screenTracks.length === 0 && isScreenShareJustStarted) {
              console.log('[StudentRoom] ⚠️ 屏幕共享刚刚开始，但没有明确的屏幕共享轨道，尝试从其他轨道中识别')
              
              // 如果所有轨道都被识别为摄像头轨道，尝试找出可能是屏幕共享的轨道
              if (cameraTracks.length > 0 && ambiguousTracks.length === 0) {
                // 检查是否有不在 knownCameraTrackIds 中的轨道
                const possibleScreenTracks = cameraTracks.filter(t => !knownCameraTrackIds.has(t.id))
                if (possibleScreenTracks.length > 0) {
                  console.log('[StudentRoom] ⚠️ 找到可能被误识别的屏幕共享轨道:', possibleScreenTracks.map(t => t.label))
                  // 将这些轨道移到 screenTracks
                  possibleScreenTracks.forEach(track => {
                    const index = cameraTracks.indexOf(track)
                    if (index > -1) {
                      cameraTracks.splice(index, 1)
                    }
                    screenTracks.push(track)
                  })
                }
              }
              
              // 如果仍然没有屏幕共享轨道，尝试使用标签不明确的轨道
              if (screenTracks.length === 0 && ambiguousTracks.length > 0) {
                console.log('[StudentRoom] ⚠️ 屏幕共享刚刚开始，使用标签不明确的轨道作为屏幕共享轨道')
                ambiguousTracks.forEach(track => {
                  screenTracks.push(track)
                })
                ambiguousTracks.length = 0 // 清空
              }
            }
            
            if (screenTracks.length > 0) {
              // 有明确的屏幕共享轨道，优先使用它们
              // 重要：过滤掉已停止的轨道（muted: true 且 readyState 不是 live）
              // 但如果是屏幕共享刚刚开始（2秒内），允许使用暂时 muted 的轨道
              const isScreenShareJustStarted = screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000
              
              // 放宽检查：优先使用未结束、未静音的轨道（与摄像头流一致）
              let validScreenTracks = screenTracks.filter(t => 
                t.readyState !== 'ended' && 
                !t.muted
              )
              
              // 如果没有未静音的轨道，但屏幕共享刚刚开始，尝试使用未结束的轨道（即使 muted）
              if (validScreenTracks.length === 0 && isScreenShareJustStarted) {
                console.log('[StudentRoom] ⚠️ 没有未静音的轨道，但屏幕共享刚刚开始，尝试使用未结束的轨道（即使 muted）')
                validScreenTracks = screenTracks.filter(t => t.readyState !== 'ended')
              }
              
              // 如果仍然没有有效轨道，但屏幕共享刚刚开始，使用所有轨道（等待数据开始传输）
              const allScreenTracks = validScreenTracks.length > 0 ? validScreenTracks : 
                (isScreenShareJustStarted ? screenTracks : [])
              
              console.log('[StudentRoom] 🔍 准备创建屏幕共享流:', {
                有效轨道数: validScreenTracks.length,
                总轨道数: screenTracks.length,
                将使用的轨道数: allScreenTracks.length,
                屏幕共享刚刚开始: isScreenShareJustStarted,
                轨道详情: allScreenTracks.map(t => ({
                  id: t.id,
                  label: t.label,
                  readyState: t.readyState,
                  enabled: t.enabled,
                  muted: t.muted
                })),
                所有轨道详情: screenTracks.map(t => ({
                  id: t.id,
                  label: t.label,
                  readyState: t.readyState,
                  enabled: t.enabled,
                  muted: t.muted
                }))
              })
              
              if (allScreenTracks.length > 0) {
                // 重要：页面刷新后，即使轨道暂时被静音，也应该创建流
                // 因为轨道可能在连接建立过程中暂时被标记为 muted
                const isPageRefresh = !store.screenStream && allScreenTracks.length > 0
                const allTracksMuted = allScreenTracks.every(t => t.muted)
                
                // 只有在不是页面刷新且不是刚刚开始时，才拒绝所有轨道都被静音的情况
                if (allTracksMuted && !isScreenShareJustStarted && !isPageRefresh) {
                  console.error('[StudentRoom] ❌ 所有轨道都被静音，可能是旧的已停止的轨道，不创建流')
                  console.error('[StudentRoom] 轨道详情:', allScreenTracks.map(t => ({
                    id: t.id,
                    label: t.label,
                    readyState: t.readyState,
                    enabled: t.enabled,
                    muted: t.muted
                  })))
                } else {
                  // 页面刷新后或屏幕共享刚刚开始时，即使轨道被静音也创建流
                  if (isPageRefresh || isScreenShareJustStarted) {
                    console.log('[StudentRoom] ⚠️ 页面刷新后或屏幕共享刚刚开始，即使轨道被静音也创建流')
                  }
                  const screenStream = new MediaStream([...allScreenTracks])
                  store.setScreenStream(screenStream)
                  console.log('[StudentRoom] ✅ 已从接收器创建并设置 screenStream（屏幕共享开始事件）')
              console.log('[StudentRoom] 屏幕共享流详情:', {
                streamId: screenStream.id,
                    视频轨道数: allScreenTracks.length,
                    轨道标签: allScreenTracks.map(t => t.label).join(', '),
                    轨道状态: allScreenTracks.map(t => ({
                      id: t.id,
                      label: t.label,
                      readyState: t.readyState,
                      enabled: t.enabled,
                      muted: t.muted
                    })),
                    注意: allTracksMuted ? '所有轨道都被静音，等待数据开始传输' : '轨道状态正常'
                  })
                }
              } else {
                console.warn('[StudentRoom] ⚠️ 没有可用的屏幕共享轨道，等待新轨道...')
                console.warn('[StudentRoom] 所有轨道状态:', screenTracks.map(t => ({
                  id: t.id,
                  label: t.label,
                  readyState: t.readyState,
                  enabled: t.enabled,
                  muted: t.muted
                })))
              }
            } else if (ambiguousTracks.length > 0 && cameraTracks.length > 0) {
              // 如果有标签不明确的轨道，且已经有摄像头轨道，那么这些不明确的轨道应该是屏幕共享
              console.log('[StudentRoom] ⚠️ 有标签不明确的轨道，且已有摄像头轨道，将这些轨道识别为屏幕共享')
              // 即使暂时 muted 也使用（数据可能正在传输中）
              const validAmbiguousTracks = ambiguousTracks.filter(t => t.enabled && t.readyState === 'live')
              if (validAmbiguousTracks.length > 0) {
                const screenStream = new MediaStream([...validAmbiguousTracks])
                store.setScreenStream(screenStream)
                console.log('[StudentRoom] ✅ 已将标签不明确的轨道设置为屏幕共享流（屏幕共享开始事件，已有摄像头轨道）')
                console.log('[StudentRoom] 屏幕共享流详情:', {
                  streamId: screenStream.id,
                  视频轨道数: validAmbiguousTracks.length,
                  轨道标签: validAmbiguousTracks.map(t => t.label).join(', '),
                  轨道状态: validAmbiguousTracks.map(t => ({
                    id: t.id,
                    label: t.label,
                    readyState: t.readyState,
                    enabled: t.enabled,
                    muted: t.muted
                  }))
                })
              }
            } else if (ambiguousTracks.length > 0 && cameraTracks.length === 0) {
              // 如果没有摄像头轨道，且只有标签不明确的轨道，可能是屏幕共享
              console.log('[StudentRoom] ⚠️ 有标签不明确的轨道，且无摄像头轨道，尝试将这些轨道视为屏幕共享')
              // 即使暂时 muted 也使用（数据可能正在传输中）
              const validAmbiguousTracks = ambiguousTracks.filter(t => t.enabled && t.readyState === 'live')
              if (validAmbiguousTracks.length > 0) {
                const screenStream = new MediaStream([...validAmbiguousTracks])
                store.setScreenStream(screenStream)
                console.log('[StudentRoom] ✅ 已将标签不明确的轨道设置为屏幕共享流（屏幕共享开始事件，无摄像头轨道）')
                console.log('[StudentRoom] 屏幕共享流详情:', {
                  streamId: screenStream.id,
                  视频轨道数: validAmbiguousTracks.length,
                  轨道标签: validAmbiguousTracks.map(t => t.label).join(', '),
                  轨道状态: validAmbiguousTracks.map(t => ({
                    id: t.id,
                    label: t.label,
                    readyState: t.readyState,
                    enabled: t.enabled,
                    muted: t.muted
                  }))
                })
              }
            } else {
              console.log('[StudentRoom] ⏳ 未找到屏幕共享轨道，等待新的轨道通过 ontrack 事件接收...')
              console.log('[StudentRoom] 当前接收器状态:', {
                总接收器数: receivers.length,
                视频接收器数: videoReceivers.length,
                屏幕共享轨道: screenTracks.length,
                摄像头轨道: cameraTracks.length,
                标签不明确轨道: ambiguousTracks.length
              })
            }
            
            // 延迟重试，等待屏幕共享轨道到达
            setTimeout(() => {
              if (store.displayMode === 'screen' && !store.screenStream) {
                console.log('[StudentRoom] ⏳ 延迟重试：检查屏幕共享流...')
                const retryReceivers = pc.getReceivers()
                const retryVideoReceivers = retryReceivers.filter(r => r.track?.kind === 'video')
                
                // 重新分类轨道
                const retryScreenTracks: MediaStreamTrack[] = []
                const retryCameraTracks: MediaStreamTrack[] = []
                const retryAmbiguousTracks: MediaStreamTrack[] = []
                
                retryVideoReceivers.forEach(receiver => {
                  if (receiver.track) {
                    const track = receiver.track
                    const label = track.label?.toLowerCase() || ''
                    const isScreen = label.includes('screen') || label.includes('display') || label.includes('desktop') || label.includes('window')
                    const isCamera = label.includes('camera') || label.includes('webcam') || label.includes('video') || label.includes('user')
                    
                    if (isScreen) {
                      retryScreenTracks.push(track)
                    } else if (isCamera || knownCameraTrackIds.has(track.id)) {
                      retryCameraTracks.push(track)
                    } else {
                      retryAmbiguousTracks.push(track)
                    }
                  }
                })
                
                if (retryScreenTracks.length > 0) {
                  const screenStream = new MediaStream([...retryScreenTracks])
                  store.setScreenStream(screenStream)
                  console.log('[StudentRoom] ✅ 延迟重试：已设置屏幕共享流')
                } else if (retryAmbiguousTracks.length > 0 && retryCameraTracks.length > 0) {
                  // 如果有标签不明确的轨道，且已经有摄像头轨道，那么这些不明确的轨道应该是屏幕共享
                  const validAmbiguousTracks = retryAmbiguousTracks.filter(t => t.enabled && t.readyState === 'live')
                  if (validAmbiguousTracks.length > 0) {
                    const screenStream = new MediaStream([...validAmbiguousTracks])
                    store.setScreenStream(screenStream)
                    console.log('[StudentRoom] ✅ 延迟重试：已将标签不明确的轨道设置为屏幕共享流（已有摄像头轨道）')
                  }
                }
              }
            }, 1000)
          }
        }
      } else if (action === 'stop') {
        console.log('[StudentRoom] 📺 停止屏幕共享')
        // 清除屏幕共享开始时间戳
        screenShareStartTime = 0
        // 重置流类型
        currentStreamType = null
        console.log('[StudentRoom] 📌 已重置 currentStreamType 为 null')
        
        // 重要：清理 knownCameraTrackIds 中可能无效的轨道 ID
        // 只保留当前 teacherStream 中实际存在的轨道 ID
        if (store.teacherStream) {
          const validCameraTrackIds = new Set<string>()
          store.teacherStream.getVideoTracks().forEach(track => {
            if (track.readyState === 'live' && track.enabled) {
              validCameraTrackIds.add(track.id)
            }
          })
          // 更新 knownCameraTrackIds，只保留有效的轨道 ID
          knownCameraTrackIds.clear()
          validCameraTrackIds.forEach(id => knownCameraTrackIds.add(id))
          console.log('[StudentRoom] 📊 已清理 knownCameraTrackIds，保留有效摄像头轨道数量:', knownCameraTrackIds.size)
        } else {
          // 如果没有摄像头流，清空 knownCameraTrackIds
          knownCameraTrackIds.clear()
          console.log('[StudentRoom] 📊 已清空 knownCameraTrackIds（无摄像头流）')
        }
        
    console.log('[StudentRoom] 切换显示模式为 document')
    store.setDisplayMode('document')
    // 清除屏幕流
    store.setScreenStream(null)
    console.log('[StudentRoom] 已清除 screenStream')
      } else {
        console.warn('[StudentRoom] ⚠️ 未知的屏幕共享操作:', action)
      }
    } catch (error) {
      console.error('[StudentRoom] ❌ 解析屏幕共享数据失败:', error, data)
    }
  })

  // 监听文档切换
  signalService.on('documentSwitched', (data) => {
    console.log('[StudentRoom] 📥 收到文档切换事件')
    console.log('[StudentRoom] 原始数据对象:', data)
    console.log('[StudentRoom] 数据类型检查:', {
      hasDocument: !!data.document,
      hasDocumentId: !!data.documentId,
      documentType: typeof data.document,
      documentIsNull: data.document === null,
      documentIsUndefined: data.document === undefined,
      documentKeys: data.document ? Object.keys(data.document) : [],
      allDataKeys: Object.keys(data)
    })
    
    // 尝试序列化查看完整数据（限制长度避免控制台卡顿）
    try {
      const dataStr = JSON.stringify(data)
      console.log('[StudentRoom] 序列化数据长度:', dataStr.length, '字符')
      console.log('[StudentRoom] 数据预览:', dataStr.substring(0, 500))
      if (data.document && data.document.url) {
        console.log('[StudentRoom] URL 类型:', data.document.url.startsWith('data:') ? 'Data URL' : '其他')
        console.log('[StudentRoom] URL 长度:', data.document.url.length)
      }
    } catch (e) {
      console.error('[StudentRoom] 序列化数据失败:', e)
    }
    
    if (data.document && data.document !== null) {
      // 如果有完整的文档信息，同步到 store
      console.log('[StudentRoom] ✅ 收到完整文档对象，准备同步:', {
        id: data.document.id,
        name: data.document.name,
        type: data.document.type,
        urlLength: data.document.url ? data.document.url.length : 0,
        urlPreview: data.document.url ? data.document.url.substring(0, 50) + '...' : 'N/A'
      })
      store.syncDocument(data.document)
      // 重要：切换到文档显示模式
      if (store.displayMode !== 'document') {
        console.log('[StudentRoom] 🔄 切换到文档显示模式')
        store.setDisplayMode('document')
      }
      console.log('[StudentRoom] ✅ 已同步文档到 store')
      console.log('[StudentRoom] 当前状态:', {
        currentDocument: store.currentDocument ? {
          id: store.currentDocument.id,
          name: store.currentDocument.name,
          type: store.currentDocument.type
        } : null,
        displayMode: store.displayMode
      })
    } else if (data.documentId) {
      // 如果只有 documentId，尝试从本地文档列表中找到
      console.warn('[StudentRoom] ⚠️ 警告：只收到 documentId，没有完整文档信息。documentId:', data.documentId)
      console.log('[StudentRoom] 当前本地文档列表长度:', store.documents.length)
      const found = store.documents.find(d => d.id === data.documentId)
      if (found) {
        console.log('[StudentRoom] ✅ 在本地找到文档，切换:', found.name)
        store.switchDocument(data.documentId)
        // 重要：切换到文档显示模式
        if (store.displayMode !== 'document') {
          console.log('[StudentRoom] 🔄 切换到文档显示模式')
          store.setDisplayMode('document')
        }
      } else {
        console.error('[StudentRoom] ❌ 错误：本地文档列表中找不到该文档，无法切换。需要完整的文档信息。')
        console.error('[StudentRoom] 本地文档列表:', store.documents.map(d => ({ id: d.id, name: d.name })))
      }
    } else {
      console.error('[StudentRoom] ❌ 错误：文档切换事件中没有 documentId 也没有 document')
      console.error('[StudentRoom] 收到的完整数据:', data)
    }
  })

  // 监听 Offer（来自教师）- 后端事件
  console.log('[StudentRoom] 📡 准备注册 onMediaOffer 事件监听器...')
  console.log('[StudentRoom] SignalService 状态:', {
    hasSignalService: !!signalService,
    isConnected: signalService?.isConnected,
    hasOnMethod: typeof signalService?.on === 'function'
  })
  
  signalService.on('onMediaOffer', async (data: any) => {
    console.log('[StudentRoom] ✅✅✅ 收到后端 Offer 事件:', data)
    console.log('[StudentRoom] 📊 收到 onMediaOffer 的时间戳:', new Date().toISOString())
    console.log('[StudentRoom] Offer 数据详情:', {
      hasJsonStr: !!data.jsonStr,
      hasFrom: !!data.from,
      hasOffer: !!data.offer,
      dataKeys: Object.keys(data),
      dataType: typeof data
    })
    try {
      // signal.ts 已经解析了 jsonStr 并合并到 data 中，所以 data 应该直接包含 from 和 offer
      // 但如果还有 jsonStr，也可以从 jsonStr 解析（兼容处理）
      let offerData: any = {}
      if (data.from && data.offer) {
        // 数据已经解析，直接使用
        offerData = data
        console.log('[StudentRoom] 使用已解析的数据:', { from: offerData.from, hasOffer: !!offerData.offer })
      } else if (data.jsonStr) {
        // 从 jsonStr 中解析数据
        try {
          offerData = JSON.parse(data.jsonStr)
          console.log('[StudentRoom] 从 jsonStr 解析数据:', { from: offerData.from, hasOffer: !!offerData.offer })
        } catch (e) {
          console.error('[StudentRoom] ❌ 解析 jsonStr 失败:', e)
          return
        }
      } else {
        console.warn('[StudentRoom] ⚠️ Offer 数据格式不正确，缺少 from 或 offer:', data)
        return
      }
      
      const { from, offer, streamType } = offerData
      
      // 方案B：从 SDP 中解析 stream-type 标识，建立轨道类型映射
      if (offer.sdp) {
        trackStreamTypeMap.clear() // 清除旧的映射
        const streamTypeMap = parseStreamTypeFromSDP(offer.sdp)
        trackStreamTypeMap.clear()
        streamTypeMap.forEach((type, trackId) => {
          trackStreamTypeMap.set(trackId, type)
        })
        console.log('[StudentRoom] 📌 从 SDP 解析的轨道类型映射:', Array.from(trackStreamTypeMap.entries()))
      }
      
      // 记录当前流类型，用于在 ontrack 回调中识别轨道类型
      // 这是识别轨道类型的关键信息，必须在处理 Offer 之前设置
      // 重要：屏幕共享Offer可能同时包含摄像头轨道和屏幕共享轨道
      // 方案B：轨道识别将优先使用 SDP 中的 stream-type 标识
      if (streamType === 'camera' || streamType === 'screen') {
        currentStreamType = streamType
        console.log('[StudentRoom] 📌 记录当前流类型:', streamType, '（从 Offer 中获取）')
        // 如果是屏幕共享流，确保显示模式也是 screen
        if (streamType === 'screen') {
          if (store.displayMode !== 'screen') {
            console.log('[StudentRoom] 🔄 检测到屏幕共享流，自动切换显示模式为 screen')
            store.setDisplayMode('screen')
          }
          // 记录屏幕共享开始时间（如果还没有记录）
          if (screenShareStartTime === 0) {
            screenShareStartTime = Date.now()
            console.log('[StudentRoom] 📌 记录屏幕共享开始时间戳（从 Offer 中获取）:', screenShareStartTime)
          }
          console.log('[StudentRoom] ⚠️ 注意：屏幕共享Offer可能同时包含摄像头和屏幕共享轨道')
          console.log('[StudentRoom] ⚠️ 方案B：轨道识别将优先使用 SDP 中的 stream-type 标识')
        }
      } else {
        // 如果没有 streamType，优先根据屏幕共享状态判断（更可靠）
        // 如果屏幕共享已经开始（screenShareStartTime > 0），或者显示模式是 screen，则认为是屏幕共享
        if (screenShareStartTime > 0) {
          currentStreamType = 'screen'
          console.log('[StudentRoom] ⚠️ Offer 中没有 streamType，但屏幕共享已开始，使用 screen（从屏幕共享状态推断）')
        } else if (store.displayMode === 'screen') {
          currentStreamType = 'screen'
          console.log('[StudentRoom] ⚠️ Offer 中没有 streamType，但显示模式是 screen，使用 screen（从显示模式推断）')
          // 记录屏幕共享开始时间
          if (screenShareStartTime === 0) {
            screenShareStartTime = Date.now()
            console.log('[StudentRoom] 📌 记录屏幕共享开始时间戳（从显示模式推断）:', screenShareStartTime)
          }
        } else {
          currentStreamType = 'camera'
          console.log('[StudentRoom] ⚠️ Offer 中没有 streamType，默认使用 camera（兼容旧版本）')
        }
      }
      
      console.log('[StudentRoom] 📊 当前状态:', {
        currentStreamType,
        displayMode: store.displayMode,
        screenShareStartTime,
        hasScreenStream: !!store.screenStream,
        hasTeacherStream: !!store.teacherStream,
        offerStreamType: streamType || '未指定',
        注意: streamType === 'screen' ? '屏幕共享Offer可能同时包含摄像头和屏幕共享轨道，轨道识别将优先使用标签和已知列表' : '正常处理'
      })
      
      // 如果确定是屏幕共享流，立即触发轨道检查（如果已经有轨道）
      // 注意：屏幕共享Offer可能同时包含摄像头轨道和屏幕共享轨道
      // 轨道识别会优先使用标签和已知列表，确保摄像头轨道不会被误识别
      if (currentStreamType === 'screen' && rtcManager) {
        const pc = rtcManager.getPeerConnection()
        if (pc) {
          const receivers = pc.getReceivers()
          // 放宽检查：只要轨道未结束就检查（与摄像头流一致）
          const videoReceivers = receivers.filter(r => r.track?.kind === 'video' && r.track.readyState !== 'ended')
          if (videoReceivers.length > 0) {
            console.log('[StudentRoom] 🔍 检测到屏幕共享 Offer，立即检查现有视频轨道:', videoReceivers.length)
            console.log('[StudentRoom] ⚠️ 注意：将根据轨道标签和已知列表来识别，确保摄像头轨道不被误识别')
            // 触发一次轨道检查（通过手动调用 setOnTrack 逻辑）
            // 注意：这里不能直接调用 setOnTrack，因为它是一个回调
            // 但我们可以通过检查接收器来识别屏幕共享轨道
            setTimeout(() => {
              const checkReceivers = pc.getReceivers()
              // 放宽检查：只要轨道未结束就检查
              const videoTracks = checkReceivers
                .filter(r => r.track?.kind === 'video' && r.track.readyState !== 'ended')
                .map(r => r.track!)
              
              // 分别识别摄像头轨道和屏幕共享轨道
              const screenTracks: MediaStreamTrack[] = []
              const cameraTracks: MediaStreamTrack[] = []
              
              videoTracks.forEach(track => {
                const label = track.label?.toLowerCase() || ''
                const isScreen = label.includes('screen') || label.includes('display') || label.includes('desktop') || label.includes('window')
                const isCamera = label.includes('camera') || label.includes('webcam') || label.includes('video') || label.includes('user')
                const isKnownCamera = knownCameraTrackIds.has(track.id)
                
                if (isScreen) {
                  screenTracks.push(track)
                } else if (isCamera || isKnownCamera) {
                  cameraTracks.push(track)
                  if (!isKnownCamera) knownCameraTrackIds.add(track.id)
                } else {
                  // 标签不明确：如果不在已知列表中，且屏幕共享刚刚开始，可能是屏幕共享
                  const isScreenShareJustStarted = screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000
                  if (isScreenShareJustStarted && !isKnownCamera) {
                    screenTracks.push(track)
                  } else {
                    cameraTracks.push(track)
                    knownCameraTrackIds.add(track.id)
                  }
                }
              })
              
              console.log('[StudentRoom] 🔍 轨道识别结果:', {
                屏幕共享轨道: screenTracks.length,
                摄像头轨道: cameraTracks.length,
                屏幕共享轨道ID: screenTracks.map(t => t.id),
                摄像头轨道ID: cameraTracks.map(t => t.id)
              })
              
              // 方案B：页面刷新后，即使轨道状态不是 'live'，也创建流
              // 过滤掉已结束的轨道
              const validScreenTracks = screenTracks.filter(t => t.readyState !== 'ended')
              const validCameraTracks = cameraTracks.filter(t => t.readyState !== 'ended')
              
              // 如果还没有屏幕共享流，且有屏幕共享轨道，创建流
              if (!store.screenStream && validScreenTracks.length > 0) {
                const screenStream = new MediaStream([...validScreenTracks])
                store.setScreenStream(screenStream)
                console.log('[StudentRoom] ✅ 从现有轨道创建屏幕共享流（Offer 处理后）', {
                  轨道数: validScreenTracks.length,
                  轨道详情: validScreenTracks.map(t => ({
                    id: t.id,
                    readyState: t.readyState,
                    enabled: t.enabled,
                    muted: t.muted
                  }))
                })
              }
              
              // 如果还没有摄像头流，且有摄像头轨道，创建流
              if (!store.teacherStream && validCameraTracks.length > 0) {
                const cameraStream = new MediaStream([...validCameraTracks])
                store.setTeacherStream(cameraStream)
                console.log('[StudentRoom] ✅ 从现有轨道创建摄像头流（Offer 处理后）', {
                  轨道数: validCameraTracks.length,
                  轨道详情: validCameraTracks.map(t => ({
                    id: t.id,
                    readyState: t.readyState,
                    enabled: t.enabled,
                    muted: t.muted
                  }))
                })
              }
            }, 100)
          }
        }
      }
      
      console.log('[StudentRoom] 解析后的 Offer 数据:', {
        from,
        hasOffer: !!offer,
        offerType: offer?.type,
        streamType: streamType || 'camera (默认)',
        currentUserId: currentUserId.value
      })
      
      // 接收来自教师或广播的 Offer（from 可能是教师 userId 或 'broadcast'，to 可能是 'broadcast' 或学生 userId）
      if (!offer) {
        console.error('[StudentRoom] ❌ Offer 为空，无法处理')
        return
      }
      
      if (!rtcManager) {
        console.error('[StudentRoom] ❌ rtcManager 不可用')
        return
      }
      
      if (!signalService) {
        console.error('[StudentRoom] ❌ signalService 不可用')
        return
      }
      
      if (from === currentUserId.value) {
        console.warn('[StudentRoom] ⚠️ Offer 来自自己，忽略:', from)
        return
      }
      
      console.log('[StudentRoom] ✅ 开始处理教师 Offer:', {
        from,
        offerType: offer.type,
        hasSdp: !!offer.sdp,
        sdpLength: offer.sdp?.length || 0
      })
      
      try {
        // 检查 Offer SDP 内容
        if (offer.sdp) {
          const hasVideo = offer.sdp.includes('m=video')
          const hasAudio = offer.sdp.includes('m=audio')
          console.log('[StudentRoom] 📊 Offer SDP 内容检查:', {
            hasVideo,
            hasAudio,
            sdpLength: offer.sdp.length
          })
          
          if (!hasVideo) {
            console.error('[StudentRoom] ❌ Offer SDP 中没有视频媒体行！教师端可能没有添加视频轨道')
          }
        }
        
        // 方案B：在设置远程描述之前，从 Offer SDP 中解析 stream-type
        // 这样可以在 ontrack 回调中使用这些信息
        if (offer.sdp) {
          const parsedMap = parseStreamTypeFromSDP(offer.sdp)
          // 暂时保存，后续在 ontrack 时通过 transceiver 索引映射到 trackId
          console.log('[StudentRoom] 📌 从 Offer SDP 解析的 stream-type 映射:', Array.from(parsedMap.entries()))
        }
        
        // 学生端只需要接收流，直接创建 Answer
        // createAnswer 内部会设置远程描述
        // 重要：检查 PeerConnection 状态，确保可以创建 Answer
        const pcBeforeAnswer = rtcManager.getPeerConnection()
        if (pcBeforeAnswer) {
          console.log('[StudentRoom] 📊 创建 Answer 前 PeerConnection 状态:', {
            signalingState: pcBeforeAnswer.signalingState,
            connectionState: pcBeforeAnswer.connectionState,
            iceConnectionState: pcBeforeAnswer.iceConnectionState,
            iceGatheringState: pcBeforeAnswer.iceGatheringState
          })
          
          // 检查状态：只有在 have-remote-offer 状态时才能创建 Answer
          if (pcBeforeAnswer.signalingState === 'stable') {
            // 如果状态是 stable，可能是刷新后重新接收Offer
            // 检查连接状态，如果连接未建立，说明可能是旧的连接状态，需要重新创建PeerConnection
            console.warn('[StudentRoom] ⚠️ PeerConnection 状态为 stable，可能是刷新后重新接收Offer')
            
            if (pcBeforeAnswer.connectionState === 'new' || pcBeforeAnswer.connectionState === 'closed') {
              console.log('[StudentRoom] 🔄 检测到连接未建立，重新创建 PeerConnection 以处理新的 Offer')
              
              // 关闭旧连接
              if (rtcManager) {
                rtcManager.close()
              }
              
              // 创建新的 RTCManager
              rtcManager = new RTCManager()
              
              // 重新设置回调（使用保存的回调函数）
              if (onTrackCallback) {
                rtcManager.setOnTrack(onTrackCallback)
              }
              
              if (signalService) {
                rtcManager.setOnIceCandidate((candidate) => {
                  signalService!.sendIceCandidate('broadcast', candidate)
                })
              }
              
              // 更新网络监听器
              if (networkMonitor) {
                networkMonitor.updateRTCManager(rtcManager)
              }
              
              // 更新 pcBeforeAnswer 引用
              const newPc = rtcManager.getPeerConnection()
              if (newPc) {
                console.log('[StudentRoom] ✅ 已重新创建 PeerConnection，新状态:', {
                  signalingState: newPc.signalingState,
                  connectionState: newPc.connectionState
                })
              }
            } else {
              console.warn('[StudentRoom] ⚠️ 连接状态正常，但 signalingState 是 stable，尝试继续创建 Answer（可能会失败）')
            }
          } else if (pcBeforeAnswer.signalingState !== 'have-remote-offer') {
            console.warn(`[StudentRoom] ⚠️ PeerConnection 状态为 ${pcBeforeAnswer.signalingState}，期望 have-remote-offer`)
            console.warn('[StudentRoom] ⚠️ 尝试继续创建 Answer（可能会失败）')
          }
        } else {
          console.error('[StudentRoom] ❌ PeerConnection 不可用，无法创建 Answer')
          return
        }
        
        console.log('[StudentRoom] 🔄 开始创建 Answer，当前流类型:', currentStreamType)
        
        // 再次获取 PeerConnection（可能已经重新创建）
        const pcForAnswer = rtcManager.getPeerConnection()
        if (!pcForAnswer) {
          console.error('[StudentRoom] ❌ PeerConnection 不可用，无法创建 Answer')
          return
        }
        
        let answer
        try {
          // 方案B：在设置远程描述之前，先解析 SDP 中的 stream-type
          // 这样可以在 ontrack 回调中使用这些信息
          if (offer.sdp) {
            const parsedMap = parseStreamTypeFromSDP(offer.sdp)
            console.log('[StudentRoom] 📌 从 Offer SDP 解析的 stream-type 映射:', Array.from(parsedMap.entries()))
            
            // 保存解析结果，后续在 ontrack 时通过 transceiver 索引映射
            // 注意：这里先保存媒体行索引到类型的映射，稍后在 ontrack 时映射到 trackId
            parsedMap.forEach((streamType, mediaIndexStr) => {
              // 暂时保存，等待 transceiver 准备好后再映射到 trackId
              console.log('[StudentRoom] 📌 保存 stream-type 映射（等待 transceiver）:', {
                mediaIndex: mediaIndexStr,
                streamType
              })
            })
          }
          
          // createAnswer 内部会设置远程描述
          answer = await rtcManager.createAnswer(offer)
          
          // 方案B：设置远程描述后，通过 transceiver 索引映射 stream-type 到 trackId
          // 注意：需要在 setRemoteDescription 之后，transceiver 才会关联到轨道
          if (offer.sdp) {
            const parsedMap = parseStreamTypeFromSDP(offer.sdp)
            const transceivers = pcForAnswer.getTransceivers()
            
            console.log('[StudentRoom] 📌 开始映射轨道类型:', {
              parsedMapSize: parsedMap.size,
              transceiversCount: transceivers.length
            })
            
            parsedMap.forEach((streamType, mediaIndexStr) => {
              const mediaIndex = parseInt(mediaIndexStr)
              if (!isNaN(mediaIndex) && mediaIndex < transceivers.length) {
                const transceiver = transceivers[mediaIndex]
                // 注意：轨道可能在设置远程描述后立即可用，也可能稍后才可用
                // 如果轨道已存在，立即映射；否则等待 ontrack 事件
                if (transceiver.receiver.track) {
                  trackStreamTypeMap.set(transceiver.receiver.track.id, streamType)
                  console.log('[StudentRoom] 📌 立即映射轨道类型:', {
                    trackId: transceiver.receiver.track.id,
                    trackLabel: transceiver.receiver.track.label,
                    streamType,
                    mediaIndex
                  })
                } else {
                  // 如果轨道还未到达，等待 ontrack 事件
                  // 在 ontrack 回调中会再次尝试映射
                  console.log('[StudentRoom] ⚠️ 轨道还未到达，等待 ontrack 事件:', {
                    mediaIndex,
                    streamType
                  })
                }
              } else {
                console.warn('[StudentRoom] ⚠️ 媒体行索引超出 transceiver 数量:', {
                  mediaIndex,
                  transceiversCount: transceivers.length
                })
              }
            })
            
            console.log('[StudentRoom] 📌 完成轨道类型映射:', Array.from(trackStreamTypeMap.entries()))
          }
        } catch (error: any) {
          console.error('[StudentRoom] ❌ 创建 Answer 失败:', error)
          console.error('[StudentRoom] 错误详情:', {
            errorName: error?.name,
            errorMessage: error?.message,
            errorStack: error?.stack,
            signalingState: pcBeforeAnswer?.signalingState,
            connectionState: pcBeforeAnswer?.connectionState
          })
          throw error // 重新抛出，让外层 catch 处理
        }
        console.log('[StudentRoom] ✅ Answer 创建成功:', {
          type: answer.type,
          hasSdp: !!answer.sdp,
          sdpLength: answer.sdp?.length || 0,
          streamType: currentStreamType
        })
        
        // 检查 Answer SDP 内容
        if (answer.sdp) {
          const hasVideo = answer.sdp.includes('m=video')
          const hasAudio = answer.sdp.includes('m=audio')
          console.log('[StudentRoom] 📊 Answer SDP 内容检查:', {
            hasVideo,
            hasAudio,
            sdpLength: answer.sdp.length
          })
        }
        
        // 检查接收器状态（在创建 Answer 后）
        const answerPc = rtcManager.getPeerConnection()
        if (answerPc) {
          const receivers = answerPc.getReceivers()
          console.log('[StudentRoom] 📊 创建 Answer 后接收器状态:', {
            接收器数量: receivers.length,
            signalingState: answerPc.signalingState,
            iceConnectionState: answerPc.iceConnectionState
          })
          
          receivers.forEach((receiver, index) => {
            if (receiver.track) {
              console.log(`[StudentRoom] 接收器 ${index}:`, {
                kind: receiver.track.kind,
                id: receiver.track.id,
                enabled: receiver.track.enabled,
                readyState: receiver.track.readyState
              })
            }
          })
        }
        
        // 发送 Answer 给教师（使用 from 字段，如果 from 是 'broadcast' 则使用 'broadcast'）
        // 后端会通过 onMediaAnswer 事件返回数据
        const teacherId = from === 'broadcast' ? 'broadcast' : from
        console.log('[StudentRoom] 📤 准备发送 Answer 给教师端:', {
          teacherId,
          answerType: answer.type,
          hasSdp: !!answer.sdp,
          sdpLength: answer.sdp?.length || 0
        })
        signalService.sendAnswer(teacherId, answer)
        console.log('[StudentRoom] ✅ 已发送 mediaAnswer 请求给教师端:', teacherId, '等待后端返回 onMediaAnswer')
        
        // 记录连接状态（用于调试）
        const connectionPc = rtcManager.getPeerConnection()
        if (connectionPc) {
          console.log('[StudentRoom] 📊 PeerConnection 状态（发送 Answer 后）:', {
            connectionState: connectionPc.connectionState,
            iceConnectionState: connectionPc.iceConnectionState,
            signalingState: connectionPc.signalingState,
            receivers: connectionPc.getReceivers().length
          })
          
          // 重要：在 Answer 创建后强制触发一次轨道检查
          // 这样可以确保页面刷新后，即使 ontrack 事件没有触发，也能从已有轨道中恢复流
          // 无论 currentStreamType 是什么，都要检查并创建所有可用的流（摄像头和屏幕共享）
          console.log('[StudentRoom] 🔄 Offer 处理完成，强制触发轨道检查（恢复所有流）...')
          setTimeout(() => {
            // 手动触发 ontrack 回调的逻辑（通过检查接收器）
            const receivers = connectionPc.getReceivers()
            console.log('[StudentRoom] 🔍 强制轨道检查：接收器数量:', receivers.length, {
              currentStreamType,
              displayMode: store.displayMode,
              screenShareStartTime: screenShareStartTime > 0 ? new Date(screenShareStartTime).toISOString() : 0
            })
            
            // 检查是否有新的轨道（摄像头和屏幕共享）
            const videoReceivers = receivers.filter(r => r.track?.kind === 'video' && r.track.readyState !== 'ended')
            const screenTracks: MediaStreamTrack[] = []
            const cameraTracks: MediaStreamTrack[] = []
              
              videoReceivers.forEach(receiver => {
                if (receiver.track) {
                  const track = receiver.track
                  const label = track.label?.toLowerCase() || ''
                  const isScreen = label.includes('screen') || label.includes('display') || label.includes('desktop') || label.includes('window')
                  const isCamera = label.includes('camera') || label.includes('webcam') || label.includes('video') || label.includes('user')
                  
                  // 方案B：页面刷新后，放宽轨道状态检查
                  // 只要轨道未结束（readyState !== 'ended'），就认为有效
                  const isScreenShareJustStarted = screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000
                  const isPageRefresh = !store.screenStream && !store.teacherStream
                  const isTrackStopped = track.readyState === 'ended' || (track.readyState !== 'live' && track.muted && !isScreenShareJustStarted && !isPageRefresh)
                  
                  if (isTrackStopped) {
                    console.log('[StudentRoom] ⚠️ 强制检查：跳过已停止的轨道:', {
                      trackId: track.id,
                      readyState: track.readyState,
                      muted: track.muted,
                      isScreenShareJustStarted,
                      isPageRefresh
                    })
                    return
                  }
                  
                  if (isScreen) {
                    screenTracks.push(track)
                  } else if (isCamera || knownCameraTrackIds.has(track.id)) {
                    cameraTracks.push(track)
                  } else {
                    // 标签不明确，如果屏幕共享刚刚开始，且不在已知摄像头列表中，识别为屏幕共享
                    if (isScreenShareJustStarted && !knownCameraTrackIds.has(track.id)) {
                      screenTracks.push(track)
                    } else {
                      cameraTracks.push(track)
                    }
                  }
                }
              })
              
              console.log('[StudentRoom] 🔍 强制轨道检查结果:', {
                屏幕共享轨道: screenTracks.length,
                摄像头轨道: cameraTracks.length,
                屏幕共享轨道详情: screenTracks.map(t => ({
                  id: t.id,
                  label: t.label,
                  readyState: t.readyState,
                  enabled: t.enabled,
                  muted: t.muted
                }))
              })
              
              // 如果有屏幕共享轨道，且当前没有流，或者流中的轨道都是旧的，创建新流
              if (screenTracks.length > 0) {
                // 放宽检查：只要轨道未结束就使用（与摄像头流一致）
                const validScreenTracks = screenTracks.filter(t => t.readyState !== 'ended')
                const isScreenShareJustStarted = screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000
                const isPageRefresh = !store.screenStream && validScreenTracks.length > 0
                const allTracksMuted = validScreenTracks.length > 0 && validScreenTracks.every(t => t.muted)
                
                // 页面刷新后，即使轨道暂时被静音，也应该创建流
                // 只有在不是页面刷新且不是刚刚开始时，才拒绝所有轨道都被静音的情况
                if (allTracksMuted && !isScreenShareJustStarted && !isPageRefresh) {
                  console.error('[StudentRoom] ❌ 强制检查：所有轨道都被静音，可能是旧的已停止的轨道')
                } else if (validScreenTracks.length > 0 || (isScreenShareJustStarted && screenTracks.length > 0) || isPageRefresh) {
                  // 页面刷新后，即使轨道被静音也创建流
                  if (isPageRefresh) {
                    console.log('[StudentRoom] ⚠️ 页面刷新后，即使轨道被静音也创建流')
                  }
                  const tracksToUse = validScreenTracks.length > 0 ? validScreenTracks : screenTracks
                  
                  // 检查是否需要更新流
                  const needsUpdate = !store.screenStream || 
                    (store.screenStream && !store.screenStream.getVideoTracks().some(t => tracksToUse.some(st => st.id === t.id)))
                  
                  if (needsUpdate) {
                    const screenStream = new MediaStream([...tracksToUse])
                    store.setScreenStream(screenStream)
                    console.log('[StudentRoom] ✅ 强制检查：已创建/更新屏幕共享流（Offer 处理后）')
                    console.log('[StudentRoom] 屏幕共享流详情:', {
                      streamId: screenStream.id,
                      视频轨道数: tracksToUse.length,
                      轨道标签: tracksToUse.map(t => t.label).join(', '),
                      轨道状态: tracksToUse.map(t => ({
                        id: t.id,
                        label: t.label,
                        readyState: t.readyState,
                        enabled: t.enabled,
                        muted: t.muted
                      }))
                    })
                  } else {
                    console.log('[StudentRoom] ⏳ 强制检查：屏幕共享流已是最新，无需更新')
                  }
                }
              }
              
              // 重要：无论 currentStreamType 是什么，都要检查并创建摄像头流
              if (cameraTracks.length > 0) {
                const validCameraTracks = cameraTracks.filter(t => t.readyState !== 'ended')
                if (validCameraTracks.length > 0) {
                  // 检查是否需要更新流
                  const needsUpdate = !store.teacherStream || 
                    (store.teacherStream && !store.teacherStream.getVideoTracks().some(t => validCameraTracks.some(ct => ct.id === t.id)))
                  
                  if (needsUpdate) {
                    // 获取音频轨道
                    const audioReceivers = receivers.filter(r => r.track?.kind === 'audio' && r.track.readyState !== 'ended')
                    const audioTracks = audioReceivers
                      .map(r => r.track!)
                      .filter(t => {
                        const label = t.label?.toLowerCase() || ''
                        const isScreenAudio = label.includes('screen') || label.includes('display') || label.includes('desktop') || label.includes('system')
                        return !isScreenAudio // 只包含摄像头音频
                      })
                    
                    const cameraStream = new MediaStream([...validCameraTracks, ...audioTracks])
                    store.setTeacherStream(cameraStream)
                    console.log('[StudentRoom] ✅ 强制检查：已创建/更新摄像头流（Offer 处理后）')
                    console.log('[StudentRoom] 摄像头流详情:', {
                      streamId: cameraStream.id,
                      视频轨道数: validCameraTracks.length,
                      音频轨道数: audioTracks.length,
                      轨道标签: validCameraTracks.map(t => t.label).join(', ')
                    })
                  } else {
                    console.log('[StudentRoom] ⏳ 强制检查：摄像头流已是最新，无需更新')
                  }
                }
              }
              
              // 如果都没有流，但手动触发 onTrackCallback 以确保轨道识别逻辑执行
              if (screenTracks.length === 0 && cameraTracks.length === 0 && onTrackCallback) {
                console.log('[StudentRoom] 🔄 强制检查：未找到明确轨道，手动触发 onTrackCallback 进行完整轨道识别')
                onTrackCallback()
              }
            }, 500) // 延迟 500ms，等待轨道建立
          
          // 监听连接状态变化
          connectionPc.oniceconnectionstatechange = () => {
            const state = connectionPc.iceConnectionState
            console.log('[StudentRoom] 📊 ICE 连接状态变化:', state)
            
            if (state === 'connected' || state === 'completed') {
              console.log('[StudentRoom] ✅ WebRTC 连接已建立')
              // 检查接收器
              const receivers = connectionPc.getReceivers()
              console.log('[StudentRoom] 📊 接收器数量:', receivers.length)
              receivers.forEach(async (receiver, index) => {
                if (receiver.track) {
                  const settings = receiver.track.getSettings ? receiver.track.getSettings() : {}
                  console.log(`[StudentRoom] 接收器 ${index} 详细信息:`, {
                    kind: receiver.track.kind,
                    id: receiver.track.id,
                    enabled: receiver.track.enabled,
                    readyState: receiver.track.readyState,
                    muted: receiver.track.muted,
                    settings: settings,
                    frameRate: settings.frameRate || '未知'
                  })
                  
                  // 获取接收器统计信息
                  try {
                    const stats = await connectionPc.getStats()
                    stats.forEach(report => {
                      if (report.type === 'inbound-rtp' && receiver.track) {
                        const mediaType = (report as any).mediaType
                        if (mediaType === receiver.track.kind) {
                          // 通过 trackId 匹配
                          if ((report as any).trackId === receiver.track.id) {
                            console.log(`[StudentRoom] 📊 接收器 ${index} ${receiver.track.kind} 统计:`, {
                              bytesReceived: (report as any).bytesReceived || 0,
                              packetsReceived: (report as any).packetsReceived || 0,
                              framesReceived: (report as any).framesReceived || 0,
                              framesDecoded: (report as any).framesDecoded || 0,
                              framesDropped: (report as any).framesDropped || 0
                            })
                            
                            // 检查是否有数据接收
                            if (((report as any).bytesReceived || 0) === 0 && ((report as any).packetsReceived || 0) === 0) {
                              console.warn(`[StudentRoom] ⚠️ 接收器 ${index} 没有接收到任何数据`)
                            }
                          }
                        }
                      }
                    })
                  } catch (error) {
                    console.error(`[StudentRoom] ❌ 获取接收器 ${index} 统计信息失败:`, error)
                  }
                }
              })
            } else if (state === 'failed' || state === 'disconnected') {
              console.error('[StudentRoom] ❌ WebRTC 连接失败或断开:', state)
            }
          }
          
          connectionPc.onconnectionstatechange = () => {
            const state = connectionPc.connectionState
            console.log('[StudentRoom] ========== 连接状态变化 ==========')
            console.log('[StudentRoom] 📊 connectionState:', state)
            console.log('[StudentRoom] 📊 iceConnectionState:', connectionPc.iceConnectionState)
            console.log('[StudentRoom] 📊 signalingState:', connectionPc.signalingState)
            
            if (state === 'new') {
              console.log('[StudentRoom] 🔵 连接状态: new（新建）')
            } else if (state === 'connecting') {
              console.log('[StudentRoom] 🔄 连接状态: connecting（正在连接）')
              console.log('[StudentRoom] 💡 提示：连接正在建立中，等待 DTLS 握手完成...')
              console.log('[StudentRoom] 💡 在无网络环境中，DTLS 握手可能需要更长时间')
            } else if (state === 'connected') {
              console.log('[StudentRoom] ✅ 连接状态: connected（已连接）')
              console.log('[StudentRoom] ✅ DTLS 握手完成，媒体流可以开始传输')
            } else if (state === 'disconnected') {
              console.warn('[StudentRoom] ⚠️ 连接状态: disconnected（已断开）')
            } else if (state === 'failed') {
              console.error('[StudentRoom] ❌ 连接状态: failed（连接失败）')
            } else if (state === 'closed') {
              console.log('[StudentRoom] 🔴 连接状态: closed（已关闭）')
            }
            console.log('[StudentRoom] =========================================')
            
            // 如果连接已建立，定期检查数据接收
            if (state === 'connected') {
              console.log('[StudentRoom] ✅ 连接已建立（connectionState = connected），开始定期检查数据接收...')
              
              // 每 2 秒检查一次数据接收，持续 10 秒
              let checkCount = 0
              const maxChecks = 5
              const checkInterval = setInterval(async () => {
                checkCount++
                if (checkCount > maxChecks) {
                  clearInterval(checkInterval)
                  console.log('[StudentRoom] 停止定期检查数据接收')
                  return
                }
                
                try {
                  const stats = await connectionPc.getStats()
                  let hasVideoData = false
                  
                  stats.forEach(report => {
                    if (report.type === 'inbound-rtp') {
                      const mediaType = (report as any).mediaType
                      const bytesReceived = (report as any).bytesReceived || 0
                      const packetsReceived = (report as any).packetsReceived || 0
                      const framesReceived = (report as any).framesReceived || 0
                      
                      if (mediaType === 'video') {
                        console.log(`[StudentRoom] 📊 [检查 ${checkCount}/${maxChecks}] 视频接收统计:`, {
                          bytesReceived,
                          packetsReceived,
                          framesReceived,
                          hasData: bytesReceived > 0 || packetsReceived > 0 || framesReceived > 0
                        })
                        
                        if (bytesReceived > 0 || packetsReceived > 0 || framesReceived > 0) {
                          hasVideoData = true
                        }
                      }
                    }
                  })
                  
                  if (!hasVideoData) {
                    console.error(`[StudentRoom] ❌ [检查 ${checkCount}/${maxChecks}] 仍然没有接收到视频数据！`)
                    if (checkCount === maxChecks) {
                      console.error('[StudentRoom] ❌ 多次检查后仍然没有数据，可能的问题：')
                      console.error('[StudentRoom] 1. 教师端没有发送视频流')
                      console.error('[StudentRoom] 2. 网络问题导致数据包丢失')
                      console.error('[StudentRoom] 3. WebRTC 连接虽然建立但媒体流未传输')
                      console.error('[StudentRoom] 4. 编解码器不匹配')
                    }
                  } else {
                    console.log(`[StudentRoom] ✅ [检查 ${checkCount}/${maxChecks}] 已接收到视频数据`)
                    clearInterval(checkInterval) // 如果检测到数据，停止检查
                  }
                } catch (error) {
                  console.error(`[StudentRoom] ❌ 检查数据接收失败:`, error)
                }
              }, 2000) // 每 2 秒检查一次
            }
          }
        }
        
        console.log('[StudentRoom] ✅ 已处理 Offer，等待接收视频流...')
      } catch (error) {
        console.error('[StudentRoom] ❌ 处理 Offer 失败:', error)
      }
    } catch (error) {
      console.error('[StudentRoom] ❌ 解析或处理后端 Offer 失败:', error)
    }
  })

  // 注意：学生端不需要处理 onMediaAnswer
  // 学生端是接收方，只需要：
  // 1. 收到 Offer → 创建 Answer → 发送给教师端
  // 2. 通过 ontrack 事件接收视频流
  // 教师端收到 Answer 后会设置远程描述，学生端不需要再处理 Answer
  signalService.on('onMediaAnswer', async (data: any) => {
    console.log('[StudentRoom] ⚠️ 收到 onMediaAnswer 事件，但学生端不需要处理（学生端是接收方）:', data)
    // 学生端不需要处理 Answer，因为已经在 createAnswer 时设置了本地和远程描述
  })

  // 监听 ICE candidate（来自教师）- 后端事件
  console.log('[StudentRoom] 📡 准备注册 onMediaIceCandidate 事件监听器...')
  signalService.on('onMediaIceCandidate', async (data: any) => {
    console.log('[StudentRoom] ✅✅✅ 收到后端 ICE candidate 事件:', data)
    try {
      // 兼容两种数据格式
      let candidateData: any = {}
      if (data.from && data.candidate) {
        // 数据已经解析，直接使用
        candidateData = data
        console.log('[StudentRoom] 使用已解析的数据:', { from: candidateData.from, hasCandidate: !!candidateData.candidate })
      } else if (data.jsonStr) {
        // 从 jsonStr 中解析数据
        try {
          candidateData = JSON.parse(data.jsonStr)
          console.log('[StudentRoom] 从 jsonStr 解析数据:', { from: candidateData.from, hasCandidate: !!candidateData.candidate })
        } catch (e) {
          console.error('[StudentRoom] ❌ 解析 jsonStr 失败:', e)
          return
        }
      } else {
        console.warn('[StudentRoom] ⚠️ ICE candidate 数据格式不正确:', data)
        return
      }
      
      const { from, candidate, candidates, streamType } = candidateData
      
      // 如果 ICE candidate 中包含 streamType，更新当前流类型
      if (streamType === 'camera' || streamType === 'screen') {
        currentStreamType = streamType
        console.log('[StudentRoom] 📌 ICE candidate 流类型:', streamType)
      }
      
      // 支持批量 candidates 和单个 candidate
      const candidatesToProcess = candidates && Array.isArray(candidates) ? candidates : (candidate ? [candidate] : [])
      
      if (candidatesToProcess.length === 0) {
        console.warn('[StudentRoom] ⚠️ ICE candidate 为空:', { from, hasCandidate: !!candidate, hasCandidates: !!candidates })
        return
      }
      
      if (!rtcManager) {
        console.warn('[StudentRoom] ⚠️ rtcManager 不可用')
        return
      }
      
      // 检查 PeerConnection 状态
      const pc = rtcManager.getPeerConnection()
      if (!pc) {
        console.warn('[StudentRoom] ⚠️ PeerConnection 不可用')
        return
      }
      
      // 检查 signalingState，只有在稳定状态时才添加 candidate
      const signalingState = pc.signalingState
      if (signalingState === 'closed') {
        console.warn('[StudentRoom] ⚠️ PeerConnection 已关闭，无法添加 ICE candidate')
        return
      }
      
      console.log(`[StudentRoom] 准备添加 ${candidatesToProcess.length} 个 ICE candidate 来自:`, from, 'signalingState:', signalingState)
      
      // 批量处理 candidates
      for (const cand of candidatesToProcess) {
        // 如果 candidate 是 null（表示 ICE gathering 完成），也允许添加
        if (cand.candidate === null || cand.candidate === '') {
          console.log('[StudentRoom] 收到 ICE gathering 完成信号（null candidate）')
          try {
            await rtcManager.addIceCandidate(cand)
            console.log('[StudentRoom] ✅ 已添加 ICE gathering 完成信号')
          } catch (error: any) {
            // null candidate 可能在某些状态下无法添加，这是正常的
            if (error.name !== 'InvalidStateError') {
              console.warn('[StudentRoom] ⚠️ 添加 null candidate 失败（可能是正常情况）:', error.message)
            }
          }
          continue
        }
        
        console.log('[StudentRoom] candidate 详情:', {
          candidate: cand.candidate ? cand.candidate.substring(0, 100) + '...' : 'null',
          sdpMLineIndex: cand.sdpMLineIndex,
          sdpMid: cand.sdpMid
        })
        
        try {
          await rtcManager.addIceCandidate(cand)
          console.log('[StudentRoom] ✅ 已添加后端 ICE candidate 来自:', from)
        } catch (error: any) {
          // 如果是 InvalidStateError，可能是 candidate 已经过期或连接状态不对
          if (error.name === 'InvalidStateError') {
            console.warn('[StudentRoom] ⚠️ 无法添加 ICE candidate（InvalidStateError）:', {
              signalingState,
              connectionState: pc.connectionState,
              iceConnectionState: pc.iceConnectionState,
              error: error.message
            })
            // 不抛出错误，继续处理其他 candidate
          } else if (error.name === 'OperationError' && error.message.includes('Error processing ICE candidate')) {
            console.warn('[StudentRoom] ⚠️ ICE candidate 处理错误（可能是格式问题或已过期）:', error.message)
            console.warn('[StudentRoom] candidate 内容:', cand)
            // 不抛出错误，继续处理其他 candidate
          } else {
            console.error('[StudentRoom] ❌ 添加 ICE candidate 失败:', error)
            // 不抛出错误，继续处理其他 candidate
          }
        }
      }
    } catch (error) {
      console.error('[StudentRoom] ❌ 解析或添加后端 ICE candidate 失败:', error)
    }
  })
}
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

        .video-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: $text-secondary;

          .el-icon {
            font-size: 48px;
            margin-bottom: 12px;
          }

          p {
            font-size: 14px;
          }
        }

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

      .main-display {
        flex: 1;
        position: relative;
        border-radius: 8px;
        overflow: hidden;
        .display-container {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          width: 100%;
          height: 100%;
          background: #000;
          
          // 确保视频元素正确显示
          :deep(.live-video-container) {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 1;
          }
          
          // 确保 video 元素正确显示
          :deep(.live-video-container video) {
            width: 100%;
            height: 100%;
            display: block;
            object-fit: contain;
            background: #000;
          }

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
            z-index: 2;
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

        .document-video-container {
          width: 100%;
          height: 100%;
        }
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


