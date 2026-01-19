/**
 * 房间生命周期管理 - 进房/离房/销毁
 */
import { ref, Ref } from 'vue'
import { useLiveStore } from '@/store/liveStore'
import { RTCManager } from '@/utils/rtc'
import { SignalService } from '@/utils/signal'
import { NetworkMonitor } from '@/utils/networkMonitor'
import { getMicroAppData } from '@/utils/microApp'

export function useRoomLifecycle() {
  const store = useLiveStore()
  
  const rtcManager: Ref<RTCManager | null> = ref(null)
  const signalService: Ref<SignalService | null> = ref(null)
  const networkMonitor: Ref<NetworkMonitor | null> = ref(null)
  const signalServiceRef: Ref<SignalService | null> = ref(null)

  /**
   * 初始化 RTC 和网络监听器
   */
  function initRTCAndNetwork() {
    rtcManager.value = new RTCManager()
    networkMonitor.value = new NetworkMonitor(store, signalService.value, rtcManager.value)
  }

  /**
   * 初始化 WebSocket
   */
  function initWebSocket() {
    signalService.value = new SignalService()
    signalServiceRef.value = signalService.value
    if (networkMonitor.value) {
      networkMonitor.value.updateSignalService(signalService.value)
    }
  }

  /**
   * 等待连接后加入房间
   */
  async function joinRoomAfterConnection() {
    if (!signalService.value) {
      console.warn('[useRoomLifecycle] signalService 不可用')
      return
    }

    // 确保在 WebSocket 连接建立后再设置监听器和加入房间
    const setupAfterConnection = () => {
      return new Promise<void>((resolve) => {
        if (signalService.value?.isConnected) {
          resolve()
        } else {
          if (signalService.value) {
            if (signalService.value.isConnected) {
              resolve()
              return
            }
            const onConnect = () => {
              if (signalService.value) {
                signalService.value.off('connect', onConnect)
              }
              resolve()
            }
            if (signalService.value) {
              signalService.value.on('connect', onConnect)
            }
          }
        }
        setTimeout(() => {
          console.warn('[useRoomLifecycle] WebSocket 连接超时，继续执行（可能是离线模式）')
          resolve()
        }, 3000)
      })
    }

    await setupAfterConnection()

    // 加入房间
    if (signalService.value) {
      // 优先从 micro-app 主应用获取 roomId，否则使用默认值
      const microAppData = getMicroAppData()
      const roomId = microAppData?.wsConfig?.roomId
      const userId = microAppData?.wsConfig?.userId

      // 从微前端主应用获取 userName，如果没有则使用默认值
      const userName = microAppData?.userName || microAppData?.wsConfig?.userName || '学生'

      // 确保 classroomId 是数字类型（后端要求）
      const classroomId = typeof roomId === 'string' ? parseInt(roomId) || 1 : roomId
      const userIdNum = typeof userId === 'string' ? parseInt(userId) || 1 : userId

      signalService.value.joinRoom(classroomId, userIdNum, {
        name: userName,
        role: 'student'
      })

      // 学生端只要能进入直播间并加入房间，就表示教师端的直播状态已开启
      // 自动开启直播状态
      if (!store.isLive) {
        store.startLive()
      }
    }
  }

  /**
   * 清理资源（离房/销毁）
   */
  function cleanup() {
    if (networkMonitor.value) {
      networkMonitor.value.destroy()
      networkMonitor.value = null
    }
    if (rtcManager.value) {
      rtcManager.value.close()
      rtcManager.value = null
    }
    if (signalService.value) {
      signalService.value.disconnect()
      signalService.value = null
    }
    signalServiceRef.value = null
  }

  return {
    rtcManager,
    signalService,
    networkMonitor,
    signalServiceRef,
    initRTCAndNetwork,
    initWebSocket,
    joinRoomAfterConnection,
    cleanup
  }
}
