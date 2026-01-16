/**
 * 网络状态监听工具
 * 监听浏览器在线/离线状态、WebSocket 连接状态和 RTC 连接状态
 */

import { useLiveStore } from '@/store/liveStore'
import type { SignalService } from './signal'
import type { RTCManager } from './rtc'
import { getNetworkStats } from './rtc'

export class NetworkMonitor {
  private store: ReturnType<typeof useLiveStore>
  private signalService: SignalService | null = null
  private rtcManager: RTCManager | null = null
  private networkCheckInterval: number | null = null
  private isOnline: boolean = navigator.onLine
  private lastCheckTime: number = Date.now()
  private checkTimeout: number = 3000 // 3秒超时

  constructor(
    store: ReturnType<typeof useLiveStore>,
    signalService?: SignalService | null,
    rtcManager?: RTCManager | null
  ) {
    this.store = store
    this.signalService = signalService || null
    this.rtcManager = rtcManager || null
    this.init()
  }

  private onlineHandler = () => {
    console.log('[NetworkMonitor] 浏览器网络已连接')
    this.isOnline = true
    this.checkNetworkStatus()
  }

  private offlineHandler = () => {
    console.log('[NetworkMonitor] 浏览器网络已断开')
    this.isOnline = false
    // 立即更新为离线状态
    this.store.updateNetworkStatus('poor', 0, 0)
  }

  private init() {
    // 监听浏览器在线/离线事件
    window.addEventListener('online', this.onlineHandler)
    window.addEventListener('offline', this.offlineHandler)
    
    // 监听 WebSocket 连接状态
    if (this.signalService) {
      this.setupSignalServiceListeners()
    }

    // 启动定期检查
    this.startPeriodicCheck()
    
    // 初始检查
    this.checkNetworkStatus()
  }

  private setupSignalServiceListeners() {
    if (!this.signalService) return

    // 监听 WebSocket 连接状态（使用 SignalService 的事件系统）
    this.signalService.on('connect', () => {
      console.log('[NetworkMonitor] WebSocket 已连接')
      this.store.setWsDisconnected(false) // 连接成功，清除断开状态
      this.checkNetworkStatus()
    })

    this.signalService.on('disconnect', () => {
      console.log('[NetworkMonitor] WebSocket 已断开')
      this.store.setWsDisconnected(true) // 设置断开状态
      // 如果浏览器在线但 WebSocket 断开，可能是网络问题
      if (this.isOnline) {
        this.store.updateNetworkStatus('poor', 0, 0)
      }
    })

    this.signalService.on('error', () => {
      console.log('[NetworkMonitor] WebSocket 连接错误')
      if (this.isOnline) {
        this.store.updateNetworkStatus('poor', 0, 0)
      }
    })
  }

  private async checkNetworkStatus() {
    // 如果浏览器离线，直接设置为 poor
    if (!this.isOnline) {
      this.store.updateNetworkStatus('poor', 0, 0)
      return
    }

    // 检查 WebSocket 连接状态
    if (this.signalService) {
      if (!this.signalService.isConnected) {
        console.log('[NetworkMonitor] WebSocket 未连接')
        this.store.updateNetworkStatus('poor', 0, 0)
        return
      }
    }

    // 检查 RTC 连接状态
    if (this.rtcManager) {
      const peerConnection = this.rtcManager.getPeerConnection()
      if (!peerConnection) {
        return
      }

      // 检查 ICE 连接状态
      const iceState = peerConnection.iceConnectionState
      if (iceState === 'disconnected' || iceState === 'failed' || iceState === 'closed') {
        console.log('[NetworkMonitor] RTC 连接状态异常:', iceState)
        this.store.updateNetworkStatus('poor', 0, 0)
        return
      }

      // 尝试获取网络统计信息（带超时）
      try {
        const statsPromise = getNetworkStats(peerConnection)
        const timeoutPromise = new Promise<{ delay: number; bitrate: number; status: 'good' | 'normal' | 'poor' }>((_, reject) => {
          setTimeout(() => reject(new Error('获取网络状态超时')), this.checkTimeout)
        })

        const stats = await Promise.race([statsPromise, timeoutPromise])
        this.store.updateNetworkStatus(stats.status, stats.delay, stats.bitrate)
        this.lastCheckTime = Date.now()
      } catch (error) {
        console.warn('[NetworkMonitor] 获取网络状态失败:', error)
        // 如果获取失败，可能是网络问题
        if (iceState === 'checking' || iceState === 'new') {
          // 连接还在建立中，不更新状态
          return
        }
        // 否则认为网络有问题
        this.store.updateNetworkStatus('poor', 0, 0)
      }
    } else {
      // 没有 RTC 连接，只检查浏览器和 WebSocket 状态
      if (this.isOnline && this.signalService?.isConnected) {
        // 网络正常，但没有 RTC 数据，保持当前状态或设置为 normal
        // 这里不更新，保持之前的状态
      }
    }
  }

  private startPeriodicCheck() {
    // 每 2 秒检查一次网络状态
    this.networkCheckInterval = window.setInterval(() => {
      this.checkNetworkStatus()
    }, 2000)
  }

  public updateRTCManager(rtcManager: RTCManager | null) {
    this.rtcManager = rtcManager
  }

  public updateSignalService(signalService: SignalService | null) {
    this.signalService = signalService
    if (signalService) {
      this.setupSignalServiceListeners()
    }
  }

  public destroy() {
    // 移除事件监听
    window.removeEventListener('online', this.onlineHandler)
    window.removeEventListener('offline', this.offlineHandler)
    
    // 清除定时器
    if (this.networkCheckInterval !== null) {
      clearInterval(this.networkCheckInterval)
      this.networkCheckInterval = null
    }
  }
}
