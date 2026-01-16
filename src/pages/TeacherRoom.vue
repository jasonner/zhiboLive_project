<template>
  <div class="teacher-room">
    <TopNavBar :is-teacher="true" />

    <div class="room-content">
      <!-- 左侧功能区 -->
      <div class="left-panel">
        <StudentList />
      </div>

      <!-- 中央主讲区 -->
      <div class="center-panel">
        <div class="main-display">
          <!-- 白板模式 -->
          <div v-if="displayMode === 'whiteboard'" class="display-container">
            <Whiteboard
              ref="whiteboardRef"
              :is-teacher="true"
            />
            <!-- 底部工具栏 -->
            <MediaWhiteboardToolbar
              @toggle-camera="handleToggleCamera"
              @toggle-microphone="handleToggleMicrophone"
              @toggle-screen-share="handleToggleScreenShare"
              @toggle-whiteboard="handleToggleWhiteboard"
              @clear-whiteboard="handleClearWhiteboard"
              @select-tool="handleSelectTool"
            />
          </div>

          <!-- 屏幕共享模式 -->
          <div v-else-if="displayMode === 'screen'" class="display-container">
            <LiveVideo
              :stream="screenStream"
              :is-small="false"
            />
            <!-- 底部工具栏 -->
            <MediaWhiteboardToolbar
              @toggle-camera="handleToggleCamera"
              @toggle-microphone="handleToggleMicrophone"
              @toggle-screen-share="handleToggleScreenShare"
              @toggle-whiteboard="handleToggleWhiteboard"
              @clear-whiteboard="handleClearWhiteboard"
              @select-tool="handleSelectTool"
            />
          </div>

          <!-- 文档/视频模式 -->
          <div v-else class="document-video-container">
            <DocumentViewer :document="currentDocument" />
            <div
              v-if="cameraEnabled && localStream"
              ref="teacherVideoRef"
              class="teacher-video-overlay"
              :style="{
                right: videoPosition.x + 'px',
                bottom: videoPosition.y + 'px'
              }"
              @mousedown="handleVideoMouseDown"
            >
              <LiveVideo
                :stream="localStream"
                :user-name="'老师'"
                :is-small="true"
                :camera-enabled="cameraEnabled"
                :microphone-enabled="microphoneEnabled"
              />
            </div>
            <!-- 底部工具栏 -->
            <MediaWhiteboardToolbar
              @toggle-camera="handleToggleCamera"
              @toggle-microphone="handleToggleMicrophone"
              @toggle-screen-share="handleToggleScreenShare"
              @toggle-whiteboard="handleToggleWhiteboard"
              @clear-whiteboard="handleClearWhiteboard"
              @select-tool="handleSelectTool"
            />
          </div>
          
          <!-- 弹幕组件 -->
          <Danmaku :messages="store.chatMessages" />
        </div>
      </div>

      <!-- 右侧互动区 -->
      <div class="right-panel">
        <el-tabs v-model="activeTab" class="interaction-tabs">
          <el-tab-pane label="聊天" name="chat">
            <ChatPanel :is-teacher="true" />
          </el-tab-pane>
          <el-tab-pane label="举手" name="raiseHand">
            <RaiseHand :is-teacher="true" />
          </el-tab-pane>
          <el-tab-pane label="课堂工具" name="classroomTools">
            <ClassroomToolsPanel :is-teacher="true" />
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, provide } from 'vue'
import { useLiveStore, type Document } from '@/store/liveStore'
import { RTCManager } from '@/utils/rtc'
import { SignalService } from '@/utils/signal'
import { getMicroAppData, onMicroAppDataChange, isMicroApp } from '@/utils/microApp'
import { NetworkMonitor } from '@/utils/networkMonitor'
import TopNavBar from '@/components/TopNavBar.vue'
import StudentList from '@/components/StudentList.vue'
import Whiteboard from '@/components/Whiteboard.vue'
import LiveVideo from '@/components/LiveVideo.vue'
import DocumentViewer from '@/components/DocumentViewer.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import RaiseHand from '@/components/RaiseHand.vue'
import ClassroomToolsPanel from '@/components/ClassroomToolsPanel.vue'
import MediaWhiteboardToolbar from '@/components/MediaWhiteboardToolbar.vue'
import Danmaku from '@/components/Danmaku.vue'

const store = useLiveStore()

const activeTab = ref('chat')
const whiteboardRef = ref<InstanceType<typeof Whiteboard> | null>(null)
const teacherVideoRef = ref<HTMLElement | null>(null)

// 教师摄像头位置（相对于屏幕右下角）
const videoPosition = ref({ x: 16, y: 16 })
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const dragOffset = ref({ x: 0, y: 0 })

const displayMode = computed(() => store.displayMode)
const currentDocument = computed(() => store.currentDocument)
const cameraEnabled = computed(() => store.cameraEnabled)
const microphoneEnabled = computed(() => store.cameraEnabled)

const localStream = ref<MediaStream | null>(null)
const screenStream = ref<MediaStream | null>(null)

// 为每个学生维护独立的 RTCManager 连接
const studentRtcManagers = new Map<string, RTCManager>()
let signalService: SignalService | null = null
let networkMonitor: NetworkMonitor | null = null

// 创建一个 ref 用于 provide，确保在 setup 阶段就能 provide
const signalServiceRef = ref<SignalService | null>(null)
provide('signalService', signalServiceRef)

// 提供开启摄像头的函数，供 TopNavBar 调用
const toggleCameraRef = ref<(() => Promise<void>) | null>(null)
provide('toggleCamera', toggleCameraRef)

// 窗口大小变化处理函数
const handleResize = () => {
  if (teacherVideoRef.value) {
    const videoRect = teacherVideoRef.value.getBoundingClientRect()
    const videoWidth = videoRect.width
    const videoHeight = videoRect.height
    
    // 确保位置在有效范围内
    const maxX = window.innerWidth - videoWidth
    const maxY = window.innerHeight - videoHeight
    
    videoPosition.value = {
      x: Math.max(0, Math.min(maxX, videoPosition.value.x)),
      y: Math.max(0, Math.min(maxY, videoPosition.value.y))
    }
  }
}

// 为学生创建独立的 RTCManager 连接
function createStudentRtcManager(studentId: string): RTCManager {
  console.log(`[TeacherRoom] 为学生 ${studentId} 创建独立的 RTCManager`)
  const manager = new RTCManager()
  
  // 如果有本地流，添加到连接中（传入外部流）
  if (localStream.value) {
    manager.addLocalTracks(localStream.value)
  }
  
  // 如果有屏幕共享流，也添加
  if (screenStream.value) {
    screenStream.value.getTracks().forEach(track => {
      manager.addScreenTrack(track, screenStream.value!)
    })
  }
  
  // 设置 ICE candidate 回调
  if (signalService) {
    manager.setOnIceCandidate((candidate) => {
      const streamType: 'camera' | 'screen' = store.screenSharing ? 'screen' : 'camera'
      signalService!.sendIceCandidate(studentId, candidate, streamType)
    })
  }
  
  studentRtcManagers.set(studentId, manager)
  console.log(`[TeacherRoom] ✅ 学生 ${studentId} 的 RTCManager 创建完成`)
  return manager
}

// 获取学生的 RTCManager，如果不存在则创建
function getOrCreateStudentRtcManager(studentId: string): RTCManager {
  let manager = studentRtcManagers.get(studentId)
  if (!manager) {
    manager = createStudentRtcManager(studentId)
  }
  return manager
}

// 删除学生的 RTCManager 连接
function removeStudentRtcManager(studentId: string) {
  const manager = studentRtcManagers.get(studentId)
  if (manager) {
    console.log(`[TeacherRoom] 清理学生 ${studentId} 的 RTCManager`)
    manager.close()
    studentRtcManagers.delete(studentId)
    console.log(`[TeacherRoom] ✅ 学生 ${studentId} 的 RTCManager 已清理`)
  }
}


onMounted(async () => {
  try {
    // 监听窗口大小变化，确保视频位置在有效范围内
    window.addEventListener('resize', handleResize)
    
    // 不再初始化全局 rtcManager，改为按需为学生创建
    
    // 初始化网络状态监听器（使用第一个学生的连接，或稍后更新）
    networkMonitor = new NetworkMonitor(store, signalService, null)
    
    // 初始化 WebSocket
    try {
      signalService = new SignalService()
      console.log('[TeacherRoom] SignalService 初始化完成')
    } catch (error) {
      console.warn('[TeacherRoom] WebSocket 初始化失败（后端服务器可能未运行）:', error)
    }
    
    // 不自动获取媒体流，等待用户点击按钮（用户交互后获取）
    // ICE candidate 回调将在创建学生连接时设置

    // 加入房间（等待 WebSocket 连接成功）
    if (signalService) {
      // 优先从 micro-app 主应用获取，否则使用默认值
      const microAppData = getMicroAppData()
      const roomId = microAppData?.wsConfig?.roomId 
      const userId = microAppData?.wsConfig?.userId
      console.log('[TeacherRoom] 房间信息:', { roomId, userId, fromMicroApp: !!microAppData })

      // 等待 WebSocket 连接成功
      const waitForConnection = () => {
        return new Promise<void>((resolve) => {
          if (signalService?.isConnected) {
            console.log('[TeacherRoom] WebSocket 已连接，加入房间')
            resolve()
          } else {
            console.log('[TeacherRoom] 等待 WebSocket 连接...')
            if (signalService) {
              const onConnect = () => {
                console.log('[TeacherRoom] WebSocket 连接成功')
                if (signalService) {
                  signalService.off('connect', onConnect)
                }
                resolve()
              }
              signalService.on('connect', onConnect)
            }
            // 如果 3 秒后还没连接，也继续（可能是离线模式）
            setTimeout(() => {
              console.warn('[TeacherRoom] WebSocket 连接超时，继续执行（可能是离线模式）')
              resolve()
            }, 3000)
          }
        })
      }
      
      await waitForConnection()
      
      // 更新 signalService ref，子组件可以通过 inject 获取
      signalServiceRef.value = signalService
      console.log('[TeacherRoom] signalService 已提供给子组件')
      
      // 更新 toggleCamera ref，子组件可以通过 inject 获取
      toggleCameraRef.value = handleToggleCamera
      console.log('[TeacherRoom] toggleCamera 函数已提供给子组件')
      
      // 更新网络监听器的 signalService
      if (networkMonitor) {
        networkMonitor.updateSignalService(signalService)
      }

      // 监听信令事件
      setupSignalListeners()
      
      // 监听用户加入事件（后端事件：onUserJoinClassroom）
      signalService.on('onUserJoinClassroom', async (data) => {
        console.log('[TeacherRoom] 用户加入房间:', data)
        // 使用后端返回的总人数
        if (data.totalNum !== undefined) {
          store.updateOnlineCount(data.totalNum)
          console.log('[TeacherRoom] 在线人数更新为（后端）:', data.totalNum)
        }
        
        // 尝试解析 jsonStr 获取用户信息
        try {
          const userInfo = data.jsonStr ? JSON.parse(data.jsonStr) : {}
          if (userInfo.role === 'student') {
            const studentId = data.userId.toString()
            
            // 检查学生列表中是否已经存在该 userId
            const existingStudent = store.students.find(s => s.userId.toString() === studentId)
            
            if (existingStudent) {
              // 如果学生已存在，可能是刷新后重新加入，需要清理旧连接并创建新连接
              console.log('[TeacherRoom] 学生已存在，可能是刷新后重新加入:', {
                userId: studentId,
                name: existingStudent.name
              })
              
              // 清理旧的连接（如果存在）
              const oldManager = studentRtcManagers.get(studentId)
              if (oldManager) {
                const pc = oldManager.getPeerConnection()
                // 检查连接状态，如果已断开或关闭，清理旧连接
                if (pc && (pc.connectionState === 'closed' || pc.connectionState === 'disconnected' || pc.connectionState === 'failed')) {
                  console.log(`[TeacherRoom] 检测到学生 ${studentId} 的旧连接已断开，清理旧连接`)
                  removeStudentRtcManager(studentId)
                } else if (pc && pc.signalingState === 'stable' && pc.connectionState === 'new') {
                  // 如果连接状态是 stable 但 connectionState 是 new，说明可能没有成功建立连接，也清理
                  console.log(`[TeacherRoom] 检测到学生 ${studentId} 的旧连接状态异常，清理旧连接`)
                  removeStudentRtcManager(studentId)
                }
              }
              
              // 标记为在线状态
              store.updateStudentStatus(studentId, true)
              console.log('[TeacherRoom] 已更新学生在线状态:', {
                userId: studentId,
                name: existingStudent.name
              })
              
              // 发送当前文档给学生
              if (store.currentDocument && signalService) {
                console.log('[TeacherRoom] 向已存在的学生发送当前文档:', store.currentDocument.name)
                signalService.switchDocument(store.currentDocument.id, store.currentDocument)
              }
              
              // 发送媒体流 Offer（为每个学生创建独立的连接）
              if (localStream.value && signalService) {
                try {
                  console.log('[TeacherRoom] 为已存在的学生创建 Offer（可能是刷新后重新加入）:', data.userId)
                  // 获取或创建该学生的 RTCManager（如果已清理旧连接，这里会创建新的）
                  const studentManager = getOrCreateStudentRtcManager(studentId)
                  
                  // 确保本地流已添加到连接（传入外部流）
                  if (localStream.value) {
                    studentManager.addLocalTracks(localStream.value)
                  }
                  
                  // 如果有屏幕共享流，也添加
                  if (screenStream.value) {
                    screenStream.value.getTracks().forEach(track => {
                      studentManager.addScreenTrack(track, screenStream.value!)
                    })
                  }
                  
                  const offer = await studentManager.createOffer()
                  // 摄像头流的 Offer，传入 'camera' 类型
                  signalService.sendOffer(studentId, offer, 'camera')
                  console.log('[TeacherRoom] 已向已存在的学生发送摄像头流的 Offer:', data.userId)
                } catch (error) {
                  console.error('[TeacherRoom] 创建 Offer 失败:', error)
                }
              }
            } else {
              // 如果学生不存在，检查是否存在于微前端主应用的学生列表中
              const microAppData = getMicroAppData()
              const mainAppStudents = microAppData?.data?.signs || []
              const isStudentInMainApp = mainAppStudents.some((s: any) => s.id?.toString() === studentId)
              
              // 只有当学生存在于主应用的学生列表中时，才添加到教师端的学生列表
              if (isStudentInMainApp) {
                // 添加学生到列表
                store.addStudent({
                  userId: studentId,
                  name: userInfo.name || `学生${data.userId}`,
                  role: 'student',
                  avatar: userInfo.avatar,
                  isOnline: true
                })
                console.log('[TeacherRoom] 已添加新学生到列表:', data.userId)
                
                // 发送当前文档给学生
                if (store.currentDocument && signalService) {
                  console.log('[TeacherRoom] 向新加入的学生发送当前文档:', store.currentDocument.name)
                  signalService.switchDocument(store.currentDocument.id, store.currentDocument)
                }
                
                // 发送媒体流 Offer（为每个学生创建独立的连接）
                if (localStream.value && signalService) {
                  try {
                    console.log('[TeacherRoom] 为学生创建 Offer:', data.userId)
                    // 获取或创建该学生的 RTCManager
                    const studentManager = getOrCreateStudentRtcManager(studentId)
                    
                    // 确保本地流已添加到连接（传入外部流）
                    if (localStream.value) {
                      studentManager.addLocalTracks(localStream.value)
                    }
                    
                    const offer = await studentManager.createOffer()
                    // 摄像头流的 Offer，传入 'camera' 类型
                    signalService.sendOffer(studentId, offer, 'camera')
                    console.log('[TeacherRoom] 已向学生发送摄像头流的 Offer:', data.userId)
                  } catch (error) {
                    console.error('[TeacherRoom] 创建 Offer 失败:', error)
                  }
                }
              } else {
                console.warn('[TeacherRoom] 学生不在主应用的学生列表中，跳过添加:', {
                  userId: studentId,
                  userName: userInfo.name,
                  mainAppStudentsCount: mainAppStudents.length
                })
              }
            }
          }
        } catch (e) {
          console.error('[TeacherRoom] 解析用户信息失败:', e)
        }
      })
      
      // 监听用户离开事件（后端事件：onUserLeaveClassroom）
      signalService.on('onUserLeaveClassroom', (data) => {
        console.log('[TeacherRoom] 用户离开房间:', data)
        // 使用后端返回的总人数
        if (data.totalNum !== undefined) {
          store.updateOnlineCount(data.totalNum)
          console.log('[TeacherRoom] 在线人数更新为（后端）:', data.totalNum)
        }
        
        const studentId = data.userId.toString()
        
        // 清理该学生的 RTCManager 连接
        removeStudentRtcManager(studentId)
        
        // 更新学生状态为离线（不删除，只标记为离线）
        store.updateStudentStatus(studentId, false)
        console.log('[TeacherRoom] 已更新学生状态为离线:', studentId)
      })
      
      // 监听学生投票信息（后端事件：onRejectVote）- 教师端
      signalService.on('onRejectVote', (data) => {
        console.log('[TeacherRoom] 📊 收到学生投票信息:', data)
        try {
          const voteData = data.jsonStr ? JSON.parse(data.jsonStr) : {}
          console.log('[TeacherRoom] 投票数据:', voteData)
          
          // 更新投票统计
          if (voteData.voteId && voteData.option !== undefined && voteData.option !== null) {
            const voteId = voteData.voteId.toString()
            const optionIndex = typeof voteData.option === 'number' ? voteData.option : parseInt(voteData.option)
            
            // 检查投票是否存在
            const vote = store.votes.find(v => v.id === voteId)
            if (vote) {
              // 获取学生ID
              const userId = voteData.userId?.toString()
              
              // 更新投票统计（传递 userId 以记录已投票的学生）
              store.submitVote(voteId, optionIndex, userId)
              console.log('[TeacherRoom] ✅ 已更新投票统计:', {
                voteId,
                optionIndex,
                userId: userId
              })
            } else {
              console.warn('[TeacherRoom] ⚠️ 未找到对应的投票:', voteId)
            }
          } else {
            console.warn('[TeacherRoom] ⚠️ 投票数据格式不正确，缺少必要字段:', voteData)
          }
        } catch (e) {
          console.error('[TeacherRoom] 解析投票数据失败:', e)
        }
      })
      
      // 监听学生举手信息（后端事件：onHandUp）- 教师端
      signalService.on('onHandUp', (data) => {
        console.log('[TeacherRoom] ✋ 收到学生举手信息:', data)
        try {
          const handData = data.jsonStr ? JSON.parse(data.jsonStr) : {}
          // 根据 action 判断是举手还是取消举手
          if (handData.action === 'raise') {
            // 添加举手请求
            const userId = handData.userId || 'unknown'
            // 如果 userName 是 "学生" 或者没有，从学生列表中查找真实姓名
            let userName = handData.userName
            if (!userName || userName === '学生') {
              const student = store.students.find(s => s.userId === userId.toString())
              if (student) {
                userName = student.name
              } else {
                userName = `学生${userId}`
              }
            }
            // 同样处理头像
            let avatar = handData.avatar || ''
            if (!avatar) {
              const student = store.students.find(s => s.userId === userId.toString())
              if (student && student.avatar) {
                avatar = student.avatar
              }
            }
            store.addRaiseHandRequest({
              id: Date.now().toString(),
              userId: userId.toString(),
              userName: userName,
              avatar: avatar,
              timestamp: handData.timestamp || Date.now()
            })
            console.log('[TeacherRoom] ✅ 已添加举手请求，学生姓名:', userName)
          } else if (handData.action === 'cancel') {
            // 移除举手请求
            const userId = handData.userId || 'unknown'
            store.removeRaiseHandRequest(userId.toString())
            console.log('[TeacherRoom] ✅ 已移除举手请求')
          }
        } catch (e) {
          console.error('[TeacherRoom] 解析举手数据失败:', e)
        }
      })
      
      
      // 如果有本地流，等待一下后为已存在的学生创建 Offer
      // 注意：此时可能还没有学生加入，所以这个逻辑会在学生加入时处理
    }

    // 注意：不在这里自动开始直播，等待用户点击"开始直播"按钮
    // store.startLive() 会在用户点击按钮时调用
    console.log('[TeacherRoom] 页面初始化完成，等待用户开始直播')

    // 监听父应用发送的 URL 推流请求
    if (isMicroApp()) {
      onMicroAppDataChange((data: any) => {
        console.log('[TeacherRoom] 收到父应用数据变化:', data)
        
        // 检查是否是 URL 推流请求
        if (data.type === 'pushUrl' || data.type === 'pushDocumentUrl') {
          const url = data.url || data.documentUrl
          const name = data.name || data.documentName || '父应用推送的资源'
          const documentType = data.documentType || detectDocumentType(url)
          
          if (url) {
            console.log('[TeacherRoom] 收到父应用 URL 推流请求:', { url, name, documentType })
            
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
            
            // 通过 signalService 推送给所有学生
            if (signalService) {
              console.log('[TeacherRoom] 向所有学生推送 URL 文档:', document.name)
              signalService.switchDocument(document.id, document)
            }
            
            console.log('[TeacherRoom] ✅ URL 推流成功，已添加到文档列表并推送给学生')
          } else {
            console.warn('[TeacherRoom] ⚠️ URL 推流请求中缺少 url 字段')
          }
        }
      })
      console.log('[TeacherRoom] 已注册父应用数据变化监听器')
    }
  } catch (error) {
    console.error('[TeacherRoom] 页面初始化失败:', error)
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
  // 移除拖拽事件监听
  document.removeEventListener('mousemove', handleVideoMouseMove)
  document.removeEventListener('mouseup', handleVideoMouseUp)
  window.removeEventListener('resize', handleResize)
  
  if (networkMonitor) {
    networkMonitor.destroy()
    networkMonitor = null
  }
  // 清理所有学生的 RTCManager 连接
  studentRtcManagers.forEach((manager, studentId) => {
    console.log(`[TeacherRoom] 清理学生 ${studentId} 的连接`)
    manager.close()
  })
  studentRtcManagers.clear()
  if (signalService) {
    signalService.disconnect()
    signalService.leaveRoom()
  }
  store.stopLive()
  store.clearStudents()
})

function setupSignalListeners() {
  if (!signalService) {
    console.warn('[TeacherRoom] setupSignalListeners: signalService 不可用', {
      hasSignalService: !!signalService
    })
    return
  }

  const service = signalService

  console.log('[TeacherRoom] 📡 开始设置信令监听器...')
  console.log('[TeacherRoom] signalService 状态:', {
    isConnected: service.isConnected,
    hasSocket: !!service.socketInstance,
    classroomId: service.currentClassroomId
  })

  // 监听聊天消息
  service.on('chatMessage', (message) => {
    console.log('[TeacherRoom] 💬 收到 chatMessage 事件:', message)
    console.log('[TeacherRoom] 📊 消息详情:', {
      id: message.id,
      userId: message.userId,
      userName: message.userName,
      content: message.content,
      isTeacher: message.isTeacher,
      timestamp: message.timestamp,
      storeMessagesCount: store.chatMessages.length
    })
    store.addChatMessage(message)
    console.log('[TeacherRoom] ✅ 消息已添加到 store，当前消息数:', store.chatMessages.length)
  })

  // 监听举手请求
  service.on('raiseHandRequest', (request) => {
    store.addRaiseHandRequest(request)
  })

  // 监听互动题
  service.on('quizCreated', (quiz) => {
    store.createQuiz(quiz)
  })

  // 监听 Answer（来自学生）- 后端事件
  console.log('[TeacherRoom] 📡 准备注册 onMediaAnswer 事件监听器...')
  service.on('onMediaAnswer', async (data: any) => {
    console.log('[TeacherRoom] ✅✅✅ 收到后端 Answer 事件:', data)
    console.log('[TeacherRoom] Answer 数据详情:', {
      hasJsonStr: !!data.jsonStr,
      hasFrom: !!data.from,
      hasAnswer: !!data.answer,
      dataKeys: Object.keys(data),
      dataType: typeof data
    })
    try {
      // signal.ts 已经解析了 jsonStr 并合并到 data 中，所以 data 应该直接包含 from 和 answer
      // 但如果还有 jsonStr，也可以从 jsonStr 解析（兼容处理）
      // 确保数据格式和 mediaAnswer 发送的格式一致：{ from, to, answer }
      let answerData: any = {}
      if (data.from && data.answer) {
        // 数据已经解析，直接使用
        answerData = data
        console.log('[TeacherRoom] 使用已解析的数据:', { from: answerData.from, hasAnswer: !!answerData.answer })
      } else if (data.jsonStr) {
        // 从 jsonStr 中解析数据（格式：{ from, to, answer }）
        try {
          answerData = JSON.parse(data.jsonStr)
          console.log('[TeacherRoom] 从 jsonStr 解析数据:', { from: answerData.from, hasAnswer: !!answerData.answer })
        } catch (e) {
          console.error('[TeacherRoom] ❌ 解析 jsonStr 失败:', e)
          return
        }
      } else {
        console.warn('[TeacherRoom] ⚠️ Answer 数据格式不正确，缺少 from 或 answer:', data)
        return
      }
      
      const { from, answer } = answerData
      
      console.log('[TeacherRoom] 解析后的 Answer 数据:', {
        from,
        hasAnswer: !!answer,
        answerType: answer?.type
      })
      
      if (!answer) {
        console.error('[TeacherRoom] ❌ Answer 为空，无法处理')
        return
      }
      
      if (!service) {
        console.error('[TeacherRoom] ❌ signalService 不可用')
        return
      }
      
      // 获取该学生对应的 RTCManager
      const studentId = from || 'broadcast'
      const manager = studentRtcManagers.get(studentId)
      
      if (!manager) {
        console.warn(`[TeacherRoom] ⚠️ 学生 ${studentId} 的 RTCManager 不存在，可能连接已关闭`)
        return
      }
      
      // 检查 PeerConnection 状态
      const pc = manager.getPeerConnection()
      if (!pc) {
        console.error('[TeacherRoom] ❌ PeerConnection 不可用')
        return
      }
      
      const currentState = pc.signalingState
      console.log('[TeacherRoom] ✅ 开始处理学生 Answer:', {
        from: studentId,
        answerType: answer.type,
        hasSdp: !!answer.sdp,
        sdpLength: answer.sdp?.length || 0,
        currentSignalingState: currentState
      })
      
      // 检查状态：只有在 have-local-offer 状态时才能设置 Answer
      if (currentState === 'stable') {
        console.warn('[TeacherRoom] ⚠️ PeerConnection 状态为 stable，无法设置 Answer。可能的原因：')
        console.warn('[TeacherRoom] 1. 已经设置过 Answer')
        console.warn('[TeacherRoom] 2. 还没有创建 Offer')
        console.warn('[TeacherRoom] 3. 连接已经建立')
        console.warn('[TeacherRoom] 跳过设置 Answer，避免状态错误')
        return
      }
      
      if (currentState !== 'have-local-offer') {
        console.warn(`[TeacherRoom] ⚠️ PeerConnection 状态为 ${currentState}，期望 have-local-offer`)
        console.warn('[TeacherRoom] 当前状态不允许设置 Answer，跳过')
        return
      }
      
      // 设置远程描述
      try {
        await manager.setRemoteDescription(answer)
        console.log('[TeacherRoom] ✅ 远程描述已设置，新状态:', pc.signalingState)
      } catch (error: any) {
        // 如果是状态错误，记录详细信息
        if (error?.message?.includes('wrong state') || error?.message?.includes('Called in wrong state')) {
          console.error('[TeacherRoom] ❌ 设置远程描述失败（状态错误）:', {
            error: error.message,
            currentState: pc.signalingState,
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState
          })
        } else {
          console.error('[TeacherRoom] ❌ 设置远程描述失败:', error)
        }
        throw error
      }
      
      // 教师端收到学生的 Answer 后，也需要发送 mediaAnswer 给后端
      // 后端会通过 onMediaAnswer 事件转发给学生端
      service.sendAnswer(studentId, answer)
      console.log('[TeacherRoom] ✅ 已发送 mediaAnswer 给学生端:', studentId, '等待后端返回 onMediaAnswer')
    } catch (error) {
      console.error('[TeacherRoom] ❌ 解析或设置后端 Answer 失败:', error)
    }
  })

  // 监听 ICE candidate（来自学生）- 后端事件
  console.log('[TeacherRoom] 📡 准备注册 onMediaIceCandidate 事件监听器...')
  service.on('onMediaIceCandidate', async (data: any) => {
    console.log('[TeacherRoom] 收到后端 ICE candidate 事件:', data)
    try {
      // 兼容两种数据格式
      let candidateData: any = {}
      if ((data as any).from && ((data as any).candidate || (data as any).candidates)) {
        // 数据已经解析，直接使用
        candidateData = data
        console.log('[TeacherRoom] 使用已解析的数据:', { from: candidateData.from, hasCandidate: !!candidateData.candidate, hasCandidates: !!candidateData.candidates })
      } else if (data.jsonStr) {
        // 从 jsonStr 中解析数据
        try {
          candidateData = JSON.parse(data.jsonStr)
          console.log('[TeacherRoom] 从 jsonStr 解析数据:', { from: candidateData.from, hasCandidate: !!candidateData.candidate, hasCandidates: !!candidateData.candidates })
        } catch (e) {
          console.error('[TeacherRoom] ❌ 解析 jsonStr 失败:', e)
          return
        }
      } else {
        console.warn('[TeacherRoom] ⚠️ ICE candidate 数据格式不正确:', data)
        return
      }
      
      const { from, candidate, candidates } = candidateData
      
      // 支持批量 candidates 和单个 candidate
      const candidatesToProcess = candidates && Array.isArray(candidates) ? candidates : (candidate ? [candidate] : [])
      
      if (candidatesToProcess.length === 0) {
        console.warn('[TeacherRoom] ⚠️ ICE candidate 数据不完整:', { from, hasCandidate: !!candidate, hasCandidates: !!candidates })
        return
      }
      
      // 获取该学生对应的 RTCManager
      const studentId = from || 'broadcast'
      const manager = studentRtcManagers.get(studentId)
      
      if (!manager) {
        console.warn(`[TeacherRoom] ⚠️ 学生 ${studentId} 的 RTCManager 不存在，可能连接已关闭`)
        return
      }
      
      console.log(`[TeacherRoom] 准备添加 ${candidatesToProcess.length} 个 ICE candidate 来自:`, from)
      
      // 批量处理 candidates
      for (const cand of candidatesToProcess) {
        try {
          await manager.addIceCandidate(cand)
          console.log('[TeacherRoom] ✅ ICE candidate 添加成功')
        } catch (error: any) {
          if (error.name === 'InvalidStateError') {
            console.warn('[TeacherRoom] ⚠️ 无法添加 ICE candidate（InvalidStateError）:', error.message)
          } else {
            console.warn('[TeacherRoom] ⚠️ 添加 ICE candidate 失败:', error)
          }
          // 继续处理其他 candidate
        }
      }
    } catch (error) {
      console.error('[TeacherRoom] ❌ 解析或添加后端 ICE candidate 失败:', error)
    }
  })
  
  console.log('[TeacherRoom] ✅ 信令监听器设置完成')
  console.log('[TeacherRoom] 已注册的事件监听器:', {
    onMediaAnswer: '已注册',
    onMediaIceCandidate: '已注册',
    chatMessage: '已注册',
    raiseHandRequest: '已注册',
    quizCreated: '已注册'
  })
}

async function handleToggleCamera() {
  // MediaWhiteboardToolbar 已经切换了 store.cameraEnabled 状态
  // 所以这里根据当前状态来处理
  
  if (store.cameraEnabled) {
    // 摄像头已启用：需要获取或启用流
    if (!localStream.value) {
      // 还没有流，需要获取
      try {
        console.log('[TeacherRoom] 用户点击开启摄像头，开始获取本地媒体流...')
        // 直接使用 navigator.mediaDevices.getUserMedia 获取媒体流
        // 避免使用 RTCManager，因为关闭 RTCManager 会停止轨道
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('浏览器不支持媒体设备访问')
        }
        
        localStream.value = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        })
        
        console.log('[TeacherRoom] 本地媒体流获取成功，流ID:', localStream.value.id)
        console.log('[TeacherRoom] 视频轨道数:', localStream.value.getVideoTracks().length)
        console.log('[TeacherRoom] 音频轨道数:', localStream.value.getAudioTracks().length)
        
        // 验证轨道状态
        localStream.value.getTracks().forEach(track => {
          console.log(`[TeacherRoom] 轨道状态: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState}`)
        })
        
        // 为所有已存在的学生创建连接并发送 Offer
        if (signalService && localStream.value) {
          const studentIds = Array.from(studentRtcManagers.keys())
          if (studentIds.length === 0) {
            console.log('[TeacherRoom] 当前没有学生，等待学生加入后再发送 Offer')
          } else {
            // 为每个学生创建连接并发送 Offer
            for (const studentId of studentIds) {
              try {
                const manager = getOrCreateStudentRtcManager(studentId)
                // 传入外部流到 addLocalTracks
                manager.addLocalTracks(localStream.value)
                
                setTimeout(async () => {
                  try {
                    const offer = await manager.createOffer()
                    signalService!.sendOffer(studentId, offer, 'camera')
                    console.log(`[TeacherRoom] 已向学生 ${studentId} 发送摄像头流的 Offer`)
                  } catch (error) {
                    console.error(`[TeacherRoom] 为学生 ${studentId} 创建 Offer 失败:`, error)
                  }
                }, 300)
              } catch (error) {
                console.error(`[TeacherRoom] 为学生 ${studentId} 添加轨道失败:`, error)
              }
            }
          }
        }
      } catch (error: any) {
        console.error('[TeacherRoom] 获取媒体流失败:', error)
        // 显示错误提示
        const { ElMessage } = await import('element-plus')
        ElMessage.error(error.message || '获取摄像头/麦克风失败，请检查浏览器权限')
        // 如果获取失败，恢复状态
        store.cameraEnabled = false
        return
      }
    } else {
      // 已经有流，只是启用摄像头轨道
      const videoTrack = localStream.value.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = true
        console.log('[TeacherRoom] 已启用摄像头轨道')
      }
      
      // 更新所有学生的连接
      studentRtcManagers.forEach((manager, studentId) => {
        manager.toggleCamera(true)
        console.log(`[TeacherRoom] 启用学生 ${studentId} 的摄像头`)
      })
    }
  } else {
    // 摄像头已禁用：禁用轨道但不停止流（保持连接）
    if (localStream.value) {
      const videoTrack = localStream.value.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = false
        console.log('[TeacherRoom] 已禁用摄像头轨道')
      }
      
      // 更新所有学生的连接
      studentRtcManagers.forEach((manager, studentId) => {
        manager.toggleCamera(false)
        console.log(`[TeacherRoom] 禁用学生 ${studentId} 的摄像头`)
      })
    }
  }
}

function handleToggleMicrophone() {
  // 更新所有学生的连接
  studentRtcManagers.forEach((manager, studentId) => {
    manager.toggleMicrophone(store.microphoneEnabled)
    console.log(`[TeacherRoom] 切换学生 ${studentId} 的麦克风状态:`, store.microphoneEnabled)
  })
}

async function handleToggleScreenShare() {
  if (store.screenSharing) {
    // 停止屏幕共享
    console.log('[TeacherRoom] 停止屏幕共享，清理屏幕共享轨道...')
    
    // 从所有学生的 PeerConnection 中移除屏幕共享发送器
    studentRtcManagers.forEach((manager, studentId) => {
      manager.removeScreenTracks()
      console.log(`[TeacherRoom] 已从学生 ${studentId} 的连接中移除屏幕共享轨道`)
    })
    
    // 停止屏幕流轨道
    if (screenStream.value) {
      screenStream.value.getTracks().forEach(track => track.stop())
      screenStream.value = null
    }
    
    store.screenSharing = false
    store.setDisplayMode('document')
    
    if (signalService) {
      signalService.stopScreenShare()
    }
    
    // 恢复摄像头流（如果有）
    if (localStream.value && signalService) {
      // 为所有学生恢复摄像头流
      studentRtcManagers.forEach((manager, studentId) => {
        manager.addLocalTracks(localStream.value!)
        
        setTimeout(async () => {
          try {
            const offer = await manager.createOffer()
            signalService!.sendOffer(studentId, offer, 'camera')
            console.log(`[TeacherRoom] 已向学生 ${studentId} 发送恢复摄像头流的 Offer`)
          } catch (error) {
            console.error(`[TeacherRoom] 为学生 ${studentId} 创建恢复摄像头流的 Offer 失败:`, error)
          }
        }, 300)
      })
    }
  } else {
    // 开始屏幕共享前检查直播状态
    if (!store.isLive) {
      const { ElMessage } = await import('element-plus')
      ElMessage.warning('请先开启直播')
      return
    }
    
    // 开始屏幕共享
    try {
      console.log('[TeacherRoom] 开始获取屏幕共享流...')
      // 直接使用 navigator.mediaDevices.getDisplayMedia 获取屏幕流
      // 避免使用 RTCManager，因为关闭 RTCManager 会停止轨道
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error('浏览器不支持屏幕共享功能')
      }
      
      screenStream.value = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      })
      
      console.log('[TeacherRoom] 屏幕共享流获取成功，流ID:', screenStream.value.id)
      console.log('[TeacherRoom] 屏幕流轨道数:', screenStream.value.getTracks().length)
      
      // 验证轨道状态
      screenStream.value.getTracks().forEach(track => {
        console.log(`[TeacherRoom] 屏幕轨道状态: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState}`)
      })
      
      store.screenSharing = true
      store.setDisplayMode('screen')
      
      // 通知学生端切换显示模式（使用后端 screenSharing 方法）
      if (signalService) {
        signalService.startScreenShare()
      }
      
      // 为所有学生添加屏幕流轨道并发送 Offer
      if (signalService && screenStream.value) {
        const studentIds = Array.from(studentRtcManagers.keys())
        if (studentIds.length === 0) {
          console.log('[TeacherRoom] 当前没有学生，等待学生加入后再发送屏幕共享 Offer')
        } else {
          for (const studentId of studentIds) {
            try {
              const manager = getOrCreateStudentRtcManager(studentId)
              
              // 确保摄像头轨道还在连接中（如果存在）
              if (localStream.value) {
                manager.addLocalTracks(localStream.value)
                console.log(`[TeacherRoom] 确保学生 ${studentId} 的摄像头轨道已添加`)
              }
              
              // 添加屏幕流轨道（这会移除旧的屏幕共享轨道，但保留摄像头轨道）
              screenStream.value.getTracks().forEach(track => {
                manager.addScreenTrack(track, screenStream.value!)
              })
              
              // 验证连接中的轨道
              const pc = manager.getPeerConnection()
              if (pc) {
                const senders = pc.getSenders()
                const videoSenders = senders.filter(s => s.track?.kind === 'video')
                console.log(`[TeacherRoom] 学生 ${studentId} 连接中的视频发送器:`, videoSenders.length)
                videoSenders.forEach((sender, index) => {
                  if (sender.track) {
                    console.log(`[TeacherRoom] 发送器 ${index}:`, {
                      id: sender.track.id,
                      label: sender.track.label,
                      kind: sender.track.kind
                    })
                  }
                })
              }
              
              setTimeout(async () => {
                try {
                  const offer = await manager.createOffer()
                  
                  // 验证 Offer 中是否包含摄像头和屏幕共享轨道
                  if (offer.sdp) {
                    const videoLines = offer.sdp.match(/m=video.*/g) || []
                    console.log(`[TeacherRoom] 学生 ${studentId} 的 Offer 中包含 ${videoLines.length} 个视频媒体行`)
                  }
                  
                  signalService!.sendOffer(studentId, offer, 'screen')
                  console.log(`[TeacherRoom] 已向学生 ${studentId} 发送屏幕共享流的 Offer（包含摄像头和屏幕共享轨道）`)
                } catch (error) {
                  console.error(`[TeacherRoom] 为学生 ${studentId} 创建屏幕共享 Offer 失败:`, error)
                }
              }, 300)
            } catch (error) {
              console.error(`[TeacherRoom] 为学生 ${studentId} 添加屏幕共享轨道失败:`, error)
            }
          }
        }
      }
      
      // 监听屏幕共享流结束事件
      screenStream.value.getVideoTracks()[0].onended = () => {
        console.log('[TeacherRoom] 屏幕共享流已结束')
        handleToggleScreenShare()
      }
    } catch (error) {
      console.error('[TeacherRoom] 屏幕共享失败:', error)
      // 确保失败时状态正确
      store.screenSharing = false
      if (screenStream.value) {
        screenStream.value.getTracks().forEach(track => track.stop())
        screenStream.value = null
      }
      const { ElMessage } = await import('element-plus')
      ElMessage.error('屏幕共享失败，请检查浏览器权限')
    }
  }
}

function handleToggleWhiteboard() {
  // 已在 store 中处理
  // 通知学生端白板状态变化
  if (!signalService) return
  
  signalService.whiteboardToggle(store.whiteboardEnabled)
  console.log('[TeacherRoom] 已通知学生端白板状态:', store.whiteboardEnabled)
  
  // 如果开启白板，立即同步整个画布状态到学生端（类似投屏功能）
  if (store.whiteboardEnabled && whiteboardRef.value) {
    setTimeout(() => {
      try {
        const canvasState = whiteboardRef.value?.getCanvasState()
        if (canvasState && signalService) {
          signalService.whiteboardSyncState(canvasState)
          console.log('[TeacherRoom] ✅ 已同步画布状态到学生端，对象数:', canvasState.objects?.length || 0)
        }
      } catch (error) {
        console.error('[TeacherRoom] ❌ 同步画布状态失败:', error)
      }
    }, 300) // 延迟一下，确保白板组件已完全初始化
  }
}

function handleClearWhiteboard() {
  if (whiteboardRef.value) {
    whiteboardRef.value.clear()
  }
  if (signalService) {
    signalService.whiteboardClear()
  }
}

function handleSelectTool(tool: string) {
  if (whiteboardRef.value) {
    whiteboardRef.value.setTool(tool)
  }
}

// 教师摄像头拖拽功能（全屏拖拽）
function handleVideoMouseDown(e: MouseEvent) {
  if (!teacherVideoRef.value) return
  
  e.preventDefault()
  isDragging.value = true
  
  // 计算鼠标相对于屏幕的位置（从右下角计算）
  dragStart.value = {
    x: window.innerWidth - e.clientX,
    y: window.innerHeight - e.clientY
  }
  
  // 记录当前视频元素的位置
  dragOffset.value = {
    x: videoPosition.value.x,
    y: videoPosition.value.y
  }
  
  document.addEventListener('mousemove', handleVideoMouseMove)
  document.addEventListener('mouseup', handleVideoMouseUp)
}

function handleVideoMouseMove(e: MouseEvent) {
  if (!isDragging.value || !teacherVideoRef.value) return
  
  // 计算鼠标相对于屏幕的位置（从右下角计算）
  const mouseX = window.innerWidth - e.clientX
  const mouseY = window.innerHeight - e.clientY
  
  // 计算新位置
  const newX = mouseX - (dragStart.value.x - dragOffset.value.x)
  const newY = mouseY - (dragStart.value.y - dragOffset.value.y)
  
  // 获取视频元素的尺寸
  const videoRect = teacherVideoRef.value.getBoundingClientRect()
  const videoWidth = videoRect.width
  const videoHeight = videoRect.height
  
  // 限制在全屏范围内
  const minX = 0
  const maxX = window.innerWidth - videoWidth
  const minY = 0
  const maxY = window.innerHeight - videoHeight
  
  videoPosition.value = {
    x: Math.max(minX, Math.min(maxX, newX)),
    y: Math.max(minY, Math.min(maxY, newY))
  }
}

function handleVideoMouseUp() {
  isDragging.value = false
  document.removeEventListener('mousemove', handleVideoMouseMove)
  document.removeEventListener('mouseup', handleVideoMouseUp)
}
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.teacher-room {
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
      width: 280px;
      display: flex;
      flex-direction: column;
      background: $bg-color;
      border-right: 1px solid $border-color;
      overflow: hidden;
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
        background: $bg-color;

        .display-container {
          width: 100%;
          height: 100%;
          position: relative;
        }

        .document-video-container {
          width: 100%;
          height: 100%;
          position: relative;

          .teacher-video-overlay {
            position: fixed;
            right: 16px;
            bottom: 16px;
            width: 240px;
            height: 180px;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            cursor: move;
            user-select: none;
            
            &:active {
              cursor: grabbing;
            }
          }
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


