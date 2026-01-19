/**
 * Socket/RTC 事件处理
 */
import { Ref } from 'vue'
import { useLiveStore } from '@/store/liveStore'
import { RTCManager } from '@/utils/rtc'
import { SignalService } from '@/utils/signal'
import { sendDataToMainApp, isMicroApp, onMicroAppDataChange, offMicroAppDataChange } from '@/utils/microApp'
import type { Document, Vote } from '@/store/liveStore'

export function useRoomSocket(
  rtcManager: Ref<RTCManager | null>,
  signalService: Ref<SignalService | null>,
  currentUserId: Ref<string | undefined>,
  showVoteDialog: Ref<boolean>,
  currentVoteData: Ref<any>,
  selectedVoteOption: Ref<number | null>,
  whiteboardRef: Ref<any>,
  parseStreamTypeFromSDP: (sdp: string) => Map<string, 'camera' | 'screen'>,
  trackStreamTypeMap: Map<string, 'camera' | 'screen'>,
  knownCameraTrackIds: Set<string>,
  screenShareStartTime: () => number,
  setScreenShareStartTime: (time: number) => void,
  currentStreamType: () => 'camera' | 'screen' | null,
  setCurrentStreamType: (type: 'camera' | 'screen' | null) => void,
  getOnTrackCallback: () => (() => void) | null
) {
  const store = useLiveStore()
  let boundService: SignalService | null = null
  let microAppListener: ((data: any) => void) | null = null

  // --- handlers（用固定引用，便于 off） ---
  const onLiveStarted = (data: any) => {
    console.log('[useRoomSocket] ✅ 收到直播开始事件:', data)
    try {
      const serverStartTime = data.startTime || Date.now()
      store.startLive(serverStartTime)
      console.log('[useRoomSocket] ✅ store.startLive() 调用成功')
    } catch (error) {
      console.error('[useRoomSocket] ❌ 调用 store.startLive() 失败:', error)
    }
  }

  const onLiveStopped = () => {
    console.log('[useRoomSocket] ✅ 收到直播停止事件')
    if (store.isLive) {
      store.stopLive()
      console.log('[useRoomSocket] ✅ 直播已停止')
    }
  }

  const onWhiteboardDraw = (data: any) => {
    console.log('[useRoomSocket] 📝 收到白板绘制事件:', data)
    if (whiteboardRef.value && data.action && data.data) {
      whiteboardRef.value.applyRemoteDraw(data.action, data.data)
    }
  }

  const onWhiteboardClear = () => {
    console.log('[useRoomSocket] 🧹 收到白板清除事件')
    if (whiteboardRef.value) {
      whiteboardRef.value.clear()
    }
  }

  const onWhiteboardEnabled = (data: any) => {
    console.log('[useRoomSocket] 📝 收到白板状态变化:', data)
    const enabled = typeof data === 'object' && 'enabled' in data ? data.enabled : data
    store.whiteboardEnabled = enabled
    if (enabled) {
      store.setDisplayMode('whiteboard')
    }
  }

  const onWhiteboardSyncState = (data: any) => {
    console.log('[useRoomSocket] 📝 收到白板状态同步:', data)
    if (whiteboardRef.value && data.canvasState) {
      let retryCount = 0
      const maxRetries = 10
      const retryInterval = setInterval(() => {
        retryCount++
        if (whiteboardRef.value && data.canvasState) {
          try {
            whiteboardRef.value.setCanvasState(data.canvasState)
            clearInterval(retryInterval)
          } catch (error) {
            if (retryCount >= maxRetries) {
              clearInterval(retryInterval)
            }
          }
        } else if (retryCount >= maxRetries) {
          clearInterval(retryInterval)
        }
      }, 100)
    }
  }

  const onUserJoinClassroom = (data: any) => {
    if (data?.totalNum !== undefined) {
      store.updateOnlineCount(data.totalNum)
    }
  }

  const onUserLeaveClassroom = (data: any) => {
    if (data?.totalNum !== undefined) {
      store.updateOnlineCount(data.totalNum)
    }
  }

  const onFinishClass = () => {
    if (store.isLive) {
      store.stopLive()
    }
  }

  const onStartVote = (data: any) => {
    try {
      const voteData = data?.jsonStr ? JSON.parse(data.jsonStr) : {}
      if (!voteData?.title || !Array.isArray(voteData.options)) return

      const voteId = (voteData.voteId?.toString() || Date.now().toString()) as string
      const existingVote = store.votes.find(v => v.id === voteId)

      if (!existingVote) {
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
      } else {
        existingVote.isActive = true
        store.currentVote = existingVote
      }

      currentVoteData.value = {
        voteId,
        title: voteData.title,
        content: voteData.content || '',
        duration: voteData.duration,
        options: voteData.options,
        createdAt: voteData.createdAt
      }
      selectedVoteOption.value = null
      showVoteDialog.value = true
    } catch (e) {
      console.error('[useRoomSocket] 解析投票数据失败:', e)
    }
  }

  const onClassroomMsg = (data: any) => {
    try {
      const msgData = data?.jsonStr ? JSON.parse(data.jsonStr) : {}
      if (msgData.action === 'finish' && msgData.voteId) {
        const voteId = msgData.voteId.toString()
        store.finishVote(voteId)
        if (currentVoteData.value?.voteId === voteId) {
          showVoteDialog.value = false
          currentVoteData.value = null
          selectedVoteOption.value = null
        }
        if (store.currentVote && store.currentVote.id === voteId) {
          store.currentVote = null
        }
      }
    } catch (e) {
      console.error('[useRoomSocket] 解析课堂消息失败:', e)
    }
  }

  const onTaskStart = (data: any) => {
    try {
      const taskData = data?.jsonStr ? JSON.parse(data.jsonStr) : {}
      sendDataToMainApp({
        type: 'onTaskStart',
        data: {
          id: data?.id,
          itemId: data?.itemId,
          taskData,
          jsonStr: data?.jsonStr
        }
      })
    } catch (e) {
      console.error('[useRoomSocket] 解析练习数据失败:', e)
    }
  }

  const onHandUp = (data: any) => {
    try {
      data?.jsonStr && JSON.parse(data.jsonStr)
    } catch (e) {
      console.error('[useRoomSocket] 解析举手数据失败:', e)
    }
  }

  const onChatModeChanged = (data: any) => {
    if (data?.mode && ['all', 'teacher', 'muted'].includes(data.mode)) {
      store.chatMode = data.mode
    }
  }

  const onScreenSharing = async (data: any) => {
    console.log('[useRoomSocket] 📺 收到屏幕共享事件:', data)
    try {
      const screenData = data.jsonStr ? JSON.parse(data.jsonStr) : {}
      const action = screenData.action || 'start'

      if (action === 'start') {
        setScreenShareStartTime(Date.now())
        setCurrentStreamType('screen')
        if (store.screenStream) {
          store.screenStream.getTracks().forEach(track => track.stop())
          store.setScreenStream(null)
        }
        store.setDisplayMode('screen')
      } else if (action === 'stop') {
        setScreenShareStartTime(0)
        setCurrentStreamType(null)
        store.setDisplayMode('document')
        store.setScreenStream(null)
      }
    } catch (error) {
      console.error('[useRoomSocket] ❌ 解析屏幕共享数据失败:', error)
    }
  }

  const onDocumentSwitched = (data: any) => {
    console.log('[useRoomSocket] 📥 收到文档切换事件')
    try {
      if (data.document) {
        store.addDocument(data.document)
        store.switchDocument(data.documentId)
      } else if (data.documentId) {
        const document = store.documents.find(d => d.id === data.documentId)
        if (document) {
          store.switchDocument(data.documentId)
        } else {
          console.error('[useRoomSocket] ❌ 本地文档列表中找不到该文档')
        }
      }
    } catch (e) {
      console.error('[useRoomSocket] 序列化数据失败:', e)
    }
  }

  const onMediaOffer = async (data: any) => {
    console.log('[useRoomSocket] ✅ 收到后端 Offer 事件:', data)
    try {
      let offerData: any = {}
      if (data.from && data.offer) {
        offerData = data
      } else if (data.jsonStr) {
        offerData = JSON.parse(data.jsonStr)
      } else {
        console.warn('[useRoomSocket] ⚠️ Offer 数据格式不正确')
        return
      }

      const { from, offer, streamType } = offerData

      if (offer.sdp) {
        trackStreamTypeMap.clear()
        const streamTypeMap = parseStreamTypeFromSDP(offer.sdp)
        streamTypeMap.forEach((type, trackId) => {
          trackStreamTypeMap.set(trackId, type)
        })
      }

      if (streamType === 'camera' || streamType === 'screen') {
        setCurrentStreamType(streamType)
        if (streamType === 'screen') {
          if (store.screenStream) {
            store.screenStream.getTracks().forEach(track => track.stop())
            store.setScreenStream(null)
          }
          if (store.displayMode !== 'screen') {
            store.setDisplayMode('screen')
          }
          if (screenShareStartTime() === 0) {
            setScreenShareStartTime(Date.now())
          }
        }
      } else {
        if (screenShareStartTime() > 0) {
          setCurrentStreamType('screen')
        } else if (store.displayMode === 'screen') {
          setCurrentStreamType('screen')
          if (screenShareStartTime() === 0) {
            setScreenShareStartTime(Date.now())
          }
        } else {
          setCurrentStreamType('camera')
        }
      }

      if (!offer || !rtcManager.value || !signalService.value) {
        return
      }

      if (from === currentUserId.value) {
        return
      }

      const pcBeforeAnswer = rtcManager.value.getPeerConnection()
      if (pcBeforeAnswer?.signalingState === 'stable') {
        if (pcBeforeAnswer.connectionState === 'new' || pcBeforeAnswer.connectionState === 'closed') {
          if (rtcManager.value) {
            rtcManager.value.close()
          }
          rtcManager.value = new RTCManager()
          const callback = getOnTrackCallback()
          if (callback) {
            rtcManager.value.setOnTrack(callback)
          }
          if (signalService.value) {
            rtcManager.value.setOnIceCandidate((candidate) => {
              signalService.value!.sendIceCandidate('broadcast', candidate)
            })
          }
        }
      }

      const pcForAnswer = rtcManager.value.getPeerConnection()
      if (!pcForAnswer) return

      let answer
      try {
        answer = await rtcManager.value.createAnswer(offer)

        if (answer.sdp && offer.sdp) {
          const parsedMap = parseStreamTypeFromSDP(offer.sdp)
          const transceivers = pcForAnswer.getTransceivers()
          parsedMap.forEach((streamType, mediaIndexStr) => {
            const mediaIndex = parseInt(mediaIndexStr)
            if (!isNaN(mediaIndex) && mediaIndex < transceivers.length) {
              const transceiver = transceivers[mediaIndex]
              if (transceiver.receiver.track) {
                trackStreamTypeMap.set(transceiver.receiver.track.id, streamType)
              }
            }
          })
        }

        const teacherId = from === 'broadcast' ? 'broadcast' : from
        signalService.value.sendAnswer(teacherId, answer)

        setTimeout(() => {
          const connectionPc = rtcManager.value?.getPeerConnection()
          if (connectionPc) {
            const receivers = connectionPc.getReceivers()
            const videoReceivers = receivers.filter(r => r.track?.kind === 'video' && r.track.readyState !== 'ended')
            const callback = getOnTrackCallback()
            if (videoReceivers.length > 0 && callback) {
              callback()
            }
          }
        }, 500)
      } catch (error: any) {
        console.error('[useRoomSocket] ❌ 创建 Answer 失败:', error)
      }
    } catch (error) {
      console.error('[useRoomSocket] ❌ 处理 Offer 失败:', error)
    }
  }

  const onMediaAnswer = async (_data: any) => {
    console.log('[useRoomSocket] ⚠️ 收到 onMediaAnswer 事件，但学生端不需要处理')
  }

  const onMediaIceCandidate = async (data: any) => {
    console.log('[useRoomSocket] ✅ 收到后端 ICE candidate 事件:', data)
    try {
      let candidateData: any = {}
      if (data.from && data.candidate) {
        candidateData = data
      } else if (data.jsonStr) {
        candidateData = JSON.parse(data.jsonStr)
      } else {
        console.warn('[useRoomSocket] ⚠️ ICE candidate 数据格式不正确')
        return
      }

      const { candidate, candidates, streamType } = candidateData
      if (streamType) {
        setCurrentStreamType(streamType)
      }

      const candidatesToProcess = candidates && Array.isArray(candidates) ? candidates : (candidate ? [candidate] : [])
      if (candidatesToProcess.length === 0) return
      if (!rtcManager.value) return

      const pc = rtcManager.value.getPeerConnection()
      if (!pc) return

      for (const cand of candidatesToProcess) {
        try {
          await rtcManager.value.addIceCandidate(cand)
        } catch (error: any) {
          if (error.name !== 'InvalidStateError') {
            console.warn('[useRoomSocket] ⚠️ 添加 ICE candidate 失败:', error)
          }
        }
      }
    } catch (error) {
      console.error('[useRoomSocket] ❌ 处理 ICE candidate 失败:', error)
    }
  }

  function detectDocumentType(url: string): 'ppt' | 'pdf' | 'image' | 'video' | 'audio' {
    const lowerUrl = url.toLowerCase()

    if (lowerUrl.includes('.pdf')) return 'pdf'
    if (lowerUrl.includes('.ppt') || lowerUrl.includes('.pptx')) return 'ppt'
    if (lowerUrl.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/)) return 'image'
    if (lowerUrl.match(/\.(mp4|webm|ogg|mov|avi|flv|wmv)$/)) return 'video'
    if (lowerUrl.match(/\.(mp3|wav|ogg|aac|m4a)$/)) return 'audio'
    if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')) return 'image'

    return 'pdf'
  }

  /**
   * 设置所有信令监听器
   */
  function setupSignalListeners() {
    if (!signalService.value || !rtcManager.value) {
      console.warn('[useRoomSocket] setupSignalListeners: signalService 或 rtcManager 不可用')
      return
    }

    // 如果 SignalService 实例变化（重连/重建），先解绑旧实例
    if (boundService && boundService !== signalService.value) {
      cleanupSignalListeners()
    }

    if (boundService === signalService.value) {
      // 已绑定过，避免重复注册导致回调触发多次
      return
    }

    boundService = signalService.value

    console.log('[useRoomSocket] 设置信令监听器...')

    boundService.on('liveStarted', onLiveStarted)
    boundService.on('liveStopped', onLiveStopped)

    boundService.on('whiteboardDraw', onWhiteboardDraw)
    boundService.on('whiteboardClear', onWhiteboardClear)
    boundService.on('whiteboardEnabled', onWhiteboardEnabled)
    boundService.on('whiteboardSyncState', onWhiteboardSyncState)

    boundService.on('onUserJoinClassroom', onUserJoinClassroom as any)
    boundService.on('onUserLeaveClassroom', onUserLeaveClassroom as any)
    boundService.on('onFinishClass', onFinishClass as any)
    boundService.on('onStartVote', onStartVote as any)
    boundService.on('onClassroomMsg', onClassroomMsg as any)
    boundService.on('onTaskStart', onTaskStart as any)
    boundService.on('onHandUp', onHandUp as any)
    boundService.on('chatModeChanged', onChatModeChanged as any)

    boundService.on('onScreenSharing', onScreenSharing as any)
    boundService.on('documentSwitched', onDocumentSwitched as any)

    boundService.on('onMediaOffer', onMediaOffer as any)
    boundService.on('onMediaAnswer', onMediaAnswer as any)
    boundService.on('onMediaIceCandidate', onMediaIceCandidate as any)

    if (isMicroApp() && !microAppListener) {
      microAppListener = (data: any) => {
        if (data?.type === 'pushUrl' || data?.type === 'pushDocumentUrl') {
          const url = data.url || data.documentUrl
          const name = data.name || data.documentName || '父应用推送的资源'
          const documentType = data.documentType || (url ? detectDocumentType(url) : 'pdf')
          if (!url) return

          const document: Document = {
            id: `url-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name,
            type: documentType,
            url
          }
          store.addDocument(document)
          store.switchDocument(document.id)
          store.setDisplayMode('document')
        }
      }
      onMicroAppDataChange(microAppListener)
    }

    console.log('[useRoomSocket] ✅ 信令监听器设置完成')
  }

  function cleanupSignalListeners() {
    if (boundService) {
      boundService.off('liveStarted', onLiveStarted as any)
      boundService.off('liveStopped', onLiveStopped as any)

      boundService.off('whiteboardDraw', onWhiteboardDraw as any)
      boundService.off('whiteboardClear', onWhiteboardClear as any)
      boundService.off('whiteboardEnabled', onWhiteboardEnabled as any)
      boundService.off('whiteboardSyncState', onWhiteboardSyncState as any)

      boundService.off('onUserJoinClassroom', onUserJoinClassroom as any)
      boundService.off('onUserLeaveClassroom', onUserLeaveClassroom as any)
      boundService.off('onFinishClass', onFinishClass as any)
      boundService.off('onStartVote', onStartVote as any)
      boundService.off('onClassroomMsg', onClassroomMsg as any)
      boundService.off('onTaskStart', onTaskStart as any)
      boundService.off('onHandUp', onHandUp as any)
      boundService.off('chatModeChanged', onChatModeChanged as any)

      boundService.off('onScreenSharing', onScreenSharing as any)
      boundService.off('documentSwitched', onDocumentSwitched as any)

      boundService.off('onMediaOffer', onMediaOffer as any)
      boundService.off('onMediaAnswer', onMediaAnswer as any)
      boundService.off('onMediaIceCandidate', onMediaIceCandidate as any)

      boundService = null
    }

    if (microAppListener) {
      offMicroAppDataChange(microAppListener)
      microAppListener = null
    }
  }

  return {
    setupSignalListeners,
    cleanupSignalListeners
  }
}
