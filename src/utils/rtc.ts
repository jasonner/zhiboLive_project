/**
 * WebRTC 相关工具函数
 */

export interface RTCConfig {
  iceServers: RTCIceServer[]
}

/**
 * 检查浏览器兼容性
 */
function checkBrowserCompatibility(): { supported: boolean; reason?: string } {
  const ua = navigator.userAgent
  const isChrome = /Chrome/.test(ua) && /Google Inc/.test(navigator.vendor)
  const isFirefox = /Firefox/.test(ua)
  const isEdge = /Edg/.test(ua)
  const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua)
  
  console.log('[RTCManager] 浏览器信息:', {
    userAgent: ua,
    isChrome,
    isFirefox,
    isEdge,
    isSafari,
    protocol: window.location.protocol,
    hostname: window.location.hostname
  })

  if (!isChrome && !isFirefox && !isEdge && !isSafari) {
    return { supported: false, reason: '不支持的浏览器类型' }
  }

  // 检查是否在安全上下文中
  const isSecureContext = window.isSecureContext || 
    window.location.protocol === 'https:' || 
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'

  console.log('[RTCManager] 安全上下文:', isSecureContext)

  return { supported: true }
}

/**
 * 确保 navigator.mediaDevices 可用
 * 在 HTTP 环境下（非 localhost）可能需要 polyfill
 */
function ensureMediaDevices(): void {
  // 检查浏览器兼容性
  const compatibility = checkBrowserCompatibility()
  if (!compatibility.supported) {
    console.error('[RTCManager] 浏览器兼容性检查失败:', compatibility.reason)
  }

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    console.log('[RTCManager] navigator.mediaDevices 可用')
    return
  }

  console.log('[RTCManager] navigator.mediaDevices 不可用，尝试创建 polyfill')
  console.log('[RTCManager] 检查旧版 API...')

  // 尝试使用旧版 API 创建 polyfill
  const getUserMedia = 
    navigator.getUserMedia ||
    (navigator as any).webkitGetUserMedia ||
    (navigator as any).mozGetUserMedia ||
    (navigator as any).msGetUserMedia

  if (getUserMedia) {
    console.log('[RTCManager] 找到旧版 getUserMedia API，创建 polyfill')
    // 创建 mediaDevices polyfill
    ;(navigator as any).mediaDevices = {
      getUserMedia: function(constraints: MediaStreamConstraints) {
        console.log('[RTCManager] 使用 polyfill getUserMedia')
        return new Promise((resolve, reject) => {
          getUserMedia.call(navigator, constraints, resolve, reject)
        })
      },
      getDisplayMedia: function(constraints: MediaStreamConstraints) {
        // 旧版 API 不支持屏幕共享
        return Promise.reject(new Error('屏幕共享需要 HTTPS 环境'))
      }
    }
    console.log('[RTCManager] polyfill 创建成功')
  } else {
    console.error('[RTCManager] 未找到任何 getUserMedia API')
    console.error('[RTCManager] navigator.getUserMedia:', typeof navigator.getUserMedia)
    console.error('[RTCManager] navigator.webkitGetUserMedia:', typeof (navigator as any).webkitGetUserMedia)
    console.error('[RTCManager] navigator.mozGetUserMedia:', typeof (navigator as any).mozGetUserMedia)
    
    // 检查是否是协议问题
    if (window.location.protocol !== 'https:' && 
        window.location.hostname !== 'localhost' && 
        window.location.hostname !== '127.0.0.1') {
      console.warn('[RTCManager] 在 HTTP + IP 环境下，某些浏览器可能限制 getUserMedia')
      console.warn('[RTCManager] 建议：1) 使用 Chrome 浏览器 2) 配置 HTTPS 3) 使用 localhost')
    }
    
    // 如果都不存在，创建一个会抛出友好错误的 polyfill
    ;(navigator as any).mediaDevices = {
      getUserMedia: function() {
        return Promise.reject(new Error('浏览器不支持 getUserMedia API。请使用现代浏览器（Chrome、Firefox、Edge），或配置 HTTPS。'))
      },
      getDisplayMedia: function() {
        return Promise.reject(new Error('浏览器不支持屏幕共享。'))
      }
    }
  }
}

/**
 * 获取 RTC 配置
 * 在无网络环境中，可以不使用 STUN 服务器（局域网内可以直接连接）
 */
function getRTCConfig(): RTCConfig {
  // 检查是否在局域网环境（无外网）
  // 可以通过环境变量或配置来指定
  const useStun = import.meta.env.VITE_USE_STUN !== 'false'
  
  if (useStun) {
    // 有网络环境，使用 STUN 服务器
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
  } else {
    // 无网络环境（纯局域网），不使用 STUN 服务器
    // WebRTC 会使用 host candidate 直接连接
    console.log('[RTCManager] 无网络环境模式：不使用 STUN 服务器，使用局域网直连')
    return {
      iceServers: []
    }
  }
}

const defaultRTCConfig: RTCConfig = getRTCConfig()

export class RTCManager {
  private peerConnection: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private remoteStreams: Map<string, MediaStream> = new Map()
  // 用于合并同一发送者的多个轨道到同一个流
  private remoteStreamBySender: Map<string, MediaStream> = new Map()
  // 主远程流（用于合并所有轨道）
  private mainRemoteStream: MediaStream | null = null
  // 方案B：跟踪每个轨道的类型（camera 或 screen）
  private trackTypeMap: Map<string, 'camera' | 'screen'> = new Map()

  constructor(config?: RTCConfig) {
    // 确保 mediaDevices 可用
    ensureMediaDevices()
    
    // 如果没有提供配置，使用默认配置
    const rtcConfig = config || defaultRTCConfig
    
    console.log('[RTCManager] 创建 PeerConnection，ICE 服务器配置:', {
      iceServersCount: rtcConfig.iceServers.length,
      iceServers: rtcConfig.iceServers.map(s => s.urls).join(', ') || '无（局域网直连模式）'
    })
    
    this.peerConnection = new RTCPeerConnection(rtcConfig)
    this.setupPeerConnection()
    
    // 设置 ICE candidate 处理
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidateCallback) {
        const candidate = event.candidate.toJSON()
        console.log('[RTCManager] 生成 ICE candidate:', {
          candidate: candidate.candidate?.substring(0, 50) + '...',
          sdpMLineIndex: candidate.sdpMLineIndex,
          sdpMid: candidate.sdpMid
        })
        this.onIceCandidateCallback(candidate)
      } else if (!event.candidate) {
        console.log('[RTCManager] ICE candidate 收集完成')
      }
    }
    
    // 监听 ICE 收集状态
    this.peerConnection.onicegatheringstatechange = () => {
      const state = this.peerConnection?.iceGatheringState
      console.log('[RTCManager] ICE 收集状态变化:', state)
      
      if (state === 'complete') {
        console.log('[RTCManager] ✅ ICE candidate 收集完成')
      } else if (state === 'gathering') {
        console.log('[RTCManager] 🔄 正在收集 ICE candidate...')
      }
    }
  }

  private setupPeerConnection() {
    if (!this.peerConnection) return

    // 处理接收到的远程流 - 使用一个主流来合并所有轨道
    this.peerConnection.ontrack = (event) => {
      console.log('[RTCManager] ========== ontrack 事件触发 ==========')
      console.log('[RTCManager] ontrack 事件详情:', {
        streams: event.streams?.length || 0,
        track: event.track?.kind,
        trackId: event.track?.id,
        trackLabel: event.track?.label,
        trackEnabled: event.track?.enabled,
        trackReadyState: event.track?.readyState,
        receiver: event.receiver?.track?.kind
      })
      
      if (!event.track) {
        console.warn('[RTCManager] ontrack 事件没有 track')
        return
      }
      
      const track = event.track
      
      // 如果已经有主流，将轨道添加到主流
      if (this.mainRemoteStream) {
        // 检查轨道是否已经在流中
        if (!this.mainRemoteStream.getTracks().some(t => t.id === track.id)) {
          this.mainRemoteStream.addTrack(track)
          console.log('[RTCManager] ✅ 将轨道添加到主流:', {
            kind: track.kind,
            trackId: track.id,
            streamId: this.mainRemoteStream.id,
            当前轨道数: this.mainRemoteStream.getTracks().length,
            视频轨道数: this.mainRemoteStream.getVideoTracks().length,
            音频轨道数: this.mainRemoteStream.getAudioTracks().length
          })
        } else {
          console.log('[RTCManager] 轨道已存在于主流中:', track.kind, track.id)
        }
      } else {
        // 创建新主流
        if (event.streams && event.streams.length > 0) {
          // 如果有 streams，使用第一个 stream
          this.mainRemoteStream = event.streams[0]
          console.log('[RTCManager] ✅ 使用事件中的流作为主流:', {
            streamId: this.mainRemoteStream.id,
            轨道数: this.mainRemoteStream.getTracks().length
          })
        } else {
          // 从 track 创建新流
          this.mainRemoteStream = new MediaStream([track])
          console.log('[RTCManager] ✅ 从 track 创建新主流:', {
            kind: track.kind,
            trackId: track.id,
            streamId: this.mainRemoteStream.id
          })
        }
        
        // 保存到 Map
        const streamId = this.mainRemoteStream.id
        this.remoteStreams.set(streamId, this.mainRemoteStream)
        console.log('[RTCManager] 主流已保存到 remoteStreams，streamId:', streamId)
      }
      
      // 触发回调
      if (this.mainRemoteStream && this.onTrackCallback) {
        const videoTracks = this.mainRemoteStream.getVideoTracks()
        const audioTracks = this.mainRemoteStream.getAudioTracks()
        console.log('[RTCManager] ========== 调用 onTrackCallback ==========')
        console.log('[RTCManager] 流信息:', {
          streamId: this.mainRemoteStream.id,
          视频轨道数: videoTracks.length,
          音频轨道数: audioTracks.length,
          总轨道数: this.mainRemoteStream.getTracks().length,
          轨道详情: this.mainRemoteStream.getTracks().map(t => ({
            kind: t.kind,
            id: t.id,
            label: t.label,
            enabled: t.enabled,
            readyState: t.readyState
          }))
        })
        this.onTrackCallback(this.mainRemoteStream)
        console.log('[RTCManager] =========================================')
      } else if (!this.onTrackCallback) {
        console.warn('[RTCManager] ⚠️ onTrackCallback 未设置，无法触发回调')
      } else {
        console.warn('[RTCManager] ⚠️ mainRemoteStream 为空，无法触发回调')
      }
    }

    // 连接状态变化（更重要的状态，包括 DTLS 握手）
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState
      console.log('[RTCManager] ========== 连接状态变化 ==========')
      console.log('[RTCManager] connectionState:', state)
      console.log('[RTCManager] iceConnectionState:', this.peerConnection?.iceConnectionState)
      console.log('[RTCManager] signalingState:', this.peerConnection?.signalingState)
      
      if (state === 'new') {
        console.log('[RTCManager] 🔵 连接状态: new（新建）')
      } else if (state === 'connecting') {
        console.log('[RTCManager] 🔄 连接状态: connecting（正在连接）')
        console.log('[RTCManager] 💡 提示：连接正在建立中，等待 DTLS 握手完成...')
      } else if (state === 'connected') {
        console.log('[RTCManager] ✅ 连接状态: connected（已连接）')
        console.log('[RTCManager] ✅ DTLS 握手完成，媒体流可以开始传输')
      } else if (state === 'disconnected') {
        console.warn('[RTCManager] ⚠️ 连接状态: disconnected（已断开）')
      } else if (state === 'failed') {
        console.error('[RTCManager] ❌ 连接状态: failed（连接失败）')
        console.error('[RTCManager] 可能的原因：')
        console.error('[RTCManager] 1. DTLS 握手失败')
        console.error('[RTCManager] 2. 网络不通（无网络环境可能需要禁用 STUN）')
        console.error('[RTCManager] 3. 防火墙阻止')
        console.error('[RTCManager] 💡 提示：在无网络环境中，可以设置 VITE_USE_STUN=false 来禁用 STUN')
      } else if (state === 'closed') {
        console.log('[RTCManager] 🔴 连接状态: closed（已关闭）')
      }
      console.log('[RTCManager] =========================================')
    }

    // ICE 连接状态变化
    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState
      console.log('[RTCManager] ICE connection state:', state)
      
      // 详细记录连接状态变化
      if (state === 'new') {
        console.log('[RTCManager] 🔵 ICE 连接状态: new（新建）')
      } else if (state === 'checking') {
        console.log('[RTCManager] 🔄 ICE 连接状态: checking（正在检查连接）')
      } else if (state === 'connected') {
        console.log('[RTCManager] ✅ ICE 连接状态: connected（已连接）')
        console.log('[RTCManager] 💡 提示：ICE 连接已建立，但需要等待 connectionState 变为 connected 才能传输媒体')
      } else if (state === 'completed') {
        console.log('[RTCManager] ✅ ICE 连接状态: completed（已完成）')
      } else if (state === 'failed') {
        console.error('[RTCManager] ❌ ICE 连接状态: failed（连接失败）')
        console.error('[RTCManager] 可能的原因：')
        console.error('[RTCManager] 1. 网络不通（无网络环境可能需要禁用 STUN）')
        console.error('[RTCManager] 2. 防火墙阻止')
        console.error('[RTCManager] 3. NAT 穿透失败')
        console.error('[RTCManager] 💡 提示：在无网络环境中，可以设置 VITE_USE_STUN=false 来禁用 STUN')
      } else if (state === 'disconnected') {
        console.warn('[RTCManager] ⚠️ ICE 连接状态: disconnected（已断开）')
      } else if (state === 'closed') {
        console.log('[RTCManager] 🔴 ICE 连接状态: closed（已关闭）')
      }
      
      // 当 ICE 连接建立后，检查是否有远程流（但需要等待 connectionState 变为 connected）
      if (state === 'connected' || state === 'completed') {
        // 检查 connectionState，只有真正连接后才能传输媒体
        const connectionState = this.peerConnection?.connectionState
        if (connectionState === 'connected') {
          console.log('[RTCManager] ✅ ICE 和 DTLS 都已连接，可以传输媒体')
        } else {
          console.log('[RTCManager] ⏳ ICE 已连接，但 connectionState 仍为', connectionState, '，等待 DTLS 握手完成...')
        }
        // 延迟检查，确保所有 track 都已添加
        setTimeout(() => {
          if (!this.peerConnection) return
          const receivers = this.peerConnection.getReceivers()
          console.log('[RTCManager] 连接建立，检查 receivers，数量:', receivers.length)
          
          // 获取所有接收到的轨道
          const allTracks: MediaStreamTrack[] = []
          receivers.forEach(receiver => {
            if (receiver.track) {
              allTracks.push(receiver.track)
              console.log('[RTCManager] 找到 receiver track:', receiver.track.kind, receiver.track.id, 'readyState:', receiver.track.readyState)
            }
          })
          
          if (allTracks.length > 0) {
            // 找到或创建主流
            // 先尝试从现有流中找到主流
            if (!this.mainRemoteStream) {
              for (const stream of this.remoteStreams.values()) {
                if (stream.getTracks().length > 0) {
                  this.mainRemoteStream = stream
                  console.log('[RTCManager] 从现有流中找到主流:', stream.id)
                  break
                }
              }
            }
            
            // 如果没有主流，创建一个
            if (!this.mainRemoteStream) {
              this.mainRemoteStream = new MediaStream()
              const streamId = this.mainRemoteStream.id
              this.remoteStreams.set(streamId, this.mainRemoteStream)
              console.log('[RTCManager] 创建新主流:', streamId)
            }
            
            // 将所有轨道添加到主流（如果还没有）
            allTracks.forEach(track => {
              if (!this.mainRemoteStream!.getTracks().some(t => t.id === track.id)) {
                this.mainRemoteStream!.addTrack(track)
                console.log('[RTCManager] 将轨道添加到主流:', {
                  kind: track.kind,
                  id: track.id,
                  enabled: track.enabled,
                  readyState: track.readyState
                })
              }
            })
            
            // 触发回调
            if (this.mainRemoteStream && this.onTrackCallback) {
              const videoTracks = this.mainRemoteStream.getVideoTracks()
              const audioTracks = this.mainRemoteStream.getAudioTracks()
              console.log('[RTCManager] ========== 连接建立后调用 onTrackCallback ==========')
              console.log('[RTCManager] 流信息:', {
                streamId: this.mainRemoteStream.id,
                视频轨道数: videoTracks.length,
                音频轨道数: audioTracks.length,
                总轨道数: this.mainRemoteStream.getTracks().length
              })
              this.onTrackCallback(this.mainRemoteStream)
              console.log('[RTCManager] ===================================================')
            }
          }
        }, 300) // 延迟检查，确保所有轨道都已添加
      }
    }

  }

  // ICE candidate 回调
  private onIceCandidateCallback: ((candidate: RTCIceCandidateInit) => void) | null = null
  private onTrackCallback: ((stream: MediaStream) => void) | null = null

  /**
   * 设置 ICE candidate 回调
   */
  setOnIceCandidate(callback: (candidate: RTCIceCandidateInit) => void) {
    this.onIceCandidateCallback = callback
  }

  /**
   * 设置 track 回调
   */
  setOnTrack(callback: (stream: MediaStream) => void) {
    this.onTrackCallback = callback
  }

  /**
   * 获取本地媒体流（摄像头和麦克风）
   */
  async getLocalStream(constraints: MediaStreamConstraints = {
    video: true,
    audio: true
  }): Promise<MediaStream> {
    try {
      // 再次确保 mediaDevices 可用
      ensureMediaDevices()

      // 检查 mediaDevices 是否可用
      if (!navigator.mediaDevices) {
        // 最后尝试：使用旧版 API
        const getUserMedia = 
          navigator.getUserMedia ||
          (navigator as any).webkitGetUserMedia ||
          (navigator as any).mozGetUserMedia ||
          (navigator as any).msGetUserMedia

        if (getUserMedia) {
          console.log('[RTCManager] 使用旧版 getUserMedia API')
          return new Promise((resolve, reject) => {
            getUserMedia.call(navigator, constraints, resolve, reject)
          })
        }
        
        throw new Error('navigator.mediaDevices 不可用。请确保浏览器支持 WebRTC。')
      }

      if (!navigator.mediaDevices.getUserMedia) {
        throw new Error('浏览器不支持 getUserMedia API')
      }

      console.log('[RTCManager] 使用 navigator.mediaDevices.getUserMedia')
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints)
      return this.localStream
    } catch (error: any) {
      console.error('获取本地媒体流失败:', error)
      
      // 提供更友好的错误信息
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        throw new Error('用户拒绝了摄像头/麦克风权限请求。请在浏览器设置中允许访问。')
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        throw new Error('未找到摄像头或麦克风设备。请检查设备连接。')
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        throw new Error('摄像头或麦克风被其他应用占用。请关闭其他使用摄像头的应用。')
      } else if (error.name === 'OverconstrainedError') {
        throw new Error('无法满足媒体约束条件。请检查设备是否支持所需的分辨率或帧率。')
      } else if (error.message?.includes('mediaDevices')) {
        throw new Error('浏览器不支持媒体设备访问。请使用现代浏览器（Chrome、Firefox、Edge）。')
      }
      
      throw error
    }
  }

  /**
   * 获取屏幕共享流
   */
  async getScreenStream(): Promise<MediaStream> {
    try {
      // 检查 mediaDevices 是否可用
      if (!navigator.mediaDevices) {
        throw new Error('navigator.mediaDevices 不可用。屏幕共享需要 HTTPS 环境。')
      }

      if (!navigator.mediaDevices.getDisplayMedia) {
        throw new Error('浏览器不支持屏幕共享功能')
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      })
      return stream
    } catch (error: any) {
      console.error('获取屏幕共享流失败:', error)
      
      // 提供更友好的错误信息
      if (error.name === 'NotAllowedError') {
        throw new Error('用户拒绝了屏幕共享权限请求')
      }
      
      throw error
    }
  }

  /**
   * 添加本地流到 PeerConnection
   * @param stream 可选的媒体流，如果不提供则使用内部的 localStream
   */
  addLocalTracks(stream?: MediaStream) {
    const streamToUse = stream || this.localStream
    if (!streamToUse || !this.peerConnection) return

    // 获取已存在的 transceivers，避免重复添加轨道
    const existingTransceivers = this.peerConnection.getTransceivers()
    const existingTrackIds = new Set(existingTransceivers.map(t => t.sender.track?.id).filter(Boolean))

    streamToUse.getTracks().forEach(track => {
      // 检查轨道是否已经存在
      if (existingTrackIds.has(track.id)) {
        console.log('[RTCManager] 轨道已存在，跳过添加:', track.kind, track.id, track.label)
        return
      }
      
      try {
        // 方案B：使用 addTransceiver 替代 addTrack，以便后续通过 transceiver 管理
        const transceiver = this.peerConnection!.addTransceiver(track, {
          direction: 'sendonly'
        })
        
        // 记录轨道类型为摄像头
        this.trackTypeMap.set(track.id, 'camera')
        console.log('[RTCManager] 已添加摄像头轨道（使用 transceiver）:', track.kind, track.id, track.label)
      } catch (error: any) {
        // 如果添加失败，可能是轨道已经存在
        if (error.name === 'InvalidAccessError' && error.message.includes('already exists')) {
          console.warn('[RTCManager] 轨道已存在，跳过添加:', track.kind, track.id, track.label)
        } else {
          console.error('[RTCManager] 添加轨道失败:', error)
          throw error
        }
      }
    })
  }

  /**
   * 移除屏幕共享轨道
   * 停止屏幕共享时，从 PeerConnection 中移除屏幕共享发送器
   */
  removeScreenTracks() {
    if (!this.peerConnection) return

    // 方案B：通过 trackTypeMap 识别屏幕共享轨道
    const transceivers = this.peerConnection.getTransceivers()
    const screenTransceivers = transceivers.filter(transceiver => {
      const track = transceiver.sender.track
      if (!track) return false
      // 通过 trackTypeMap 识别屏幕共享轨道
      return this.trackTypeMap.get(track.id) === 'screen'
    })

    console.log('[RTCManager] 找到屏幕共享 transceiver 数量:', screenTransceivers.length)
    
    screenTransceivers.forEach(transceiver => {
      try {
        const track = transceiver.sender.track
        // 停止轨道
        if (track) {
          track.stop()
          console.log('[RTCManager] 已停止屏幕共享轨道:', track.label)
          // 从 trackTypeMap 中移除
          this.trackTypeMap.delete(track.id)
        }
        // 从 PeerConnection 中移除 transceiver
        this.peerConnection!.removeTrack(transceiver.sender)
        console.log('[RTCManager] ✅ 已移除屏幕共享 transceiver')
      } catch (error) {
        console.error('[RTCManager] 移除屏幕共享 transceiver 失败:', error)
      }
    })
  }

  /**
   * 添加屏幕流轨道到 PeerConnection
   * 屏幕共享时，先移除旧的屏幕共享轨道，再添加新的
   */
  addScreenTrack(track: MediaStreamTrack, stream: MediaStream) {
    if (!this.peerConnection) return

    // 先移除旧的屏幕共享轨道（如果有）
    this.removeScreenTracks()

    // 检查轨道是否已经存在（防止重复添加）
    const existingTransceivers = this.peerConnection.getTransceivers()
    const trackExists = existingTransceivers.some(t => t.sender.track?.id === track.id)
    
    if (trackExists) {
      console.warn('[RTCManager] 屏幕共享轨道已存在，跳过添加:', track.kind, track.id, track.label)
      return
    }

    // 方案B：使用 addTransceiver 替代 addTrack
    try {
      console.log('[RTCManager] 添加屏幕共享轨道（使用 transceiver）:', track.kind, 'label:', track.label)
      const transceiver = this.peerConnection.addTransceiver(track, {
        direction: 'sendonly'
      })
      
      // 记录轨道类型为屏幕共享
      this.trackTypeMap.set(track.id, 'screen')
      console.log('[RTCManager] ✅ 屏幕共享轨道添加成功')
    } catch (error: any) {
      // 如果添加失败，可能是轨道已经存在
      if (error.name === 'InvalidAccessError' && error.message.includes('already exists')) {
        console.warn('[RTCManager] 屏幕共享轨道已存在，跳过添加:', track.kind, track.id, track.label)
      } else {
        console.error('[RTCManager] 添加屏幕共享轨道失败:', error)
        throw error
      }
    }
  }

  /**
   * 创建 Offer
   * 方案B：在 SDP 中添加 stream-type 标识，用于区分摄像头和屏幕共享轨道
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection 未初始化')
    }

    const offer = await this.peerConnection.createOffer()
    
    // 方案B：修改 SDP，为每个媒体行添加 stream-type 标识
    if (offer.sdp) {
      offer.sdp = this.addStreamTypeToSDP(offer.sdp)
      console.log('[RTCManager] ✅ 已在 SDP 中添加 stream-type 标识')
    }
    
    await this.peerConnection.setLocalDescription(offer)
    return offer
  }
  
  /**
   * 方案B：在 SDP 中为每个媒体行添加 stream-type 标识
   * 格式：a=stream-type:camera 或 a=stream-type:screen
   * 注意：stream-type 标识应该紧跟在媒体行（m=）之后，在第一个属性行（a=）之前
   */
  private addStreamTypeToSDP(sdp: string): string {
    const transceivers = this.peerConnection?.getTransceivers() || []
    let mediaLineIndex = -1
    
    // 按行处理 SDP（处理不同的分隔符：\r\n 或 \n）
    const lines = sdp.split(/\r?\n/)
    const newLines: string[] = []
    const lineEnding = sdp.includes('\r\n') ? '\r\n' : '\n'
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      newLines.push(line)
      
      // 检测媒体行（m=video 或 m=audio）
      if (line.startsWith('m=')) {
        mediaLineIndex++
        
        // 找到对应的 transceiver
        if (mediaLineIndex < transceivers.length) {
          const transceiver = transceivers[mediaLineIndex]
          const track = transceiver.sender.track
          
          if (track) {
            const streamType = this.trackTypeMap.get(track.id) || 'camera'
            
            // 在媒体行后立即插入 stream-type 标识
            // 这样它会在第一个属性行之前
            newLines.push(`a=stream-type:${streamType}`)
            console.log('[RTCManager] 为媒体行添加 stream-type:', {
              mediaLine: line,
              trackId: track.id,
              trackLabel: track.label,
              streamType,
              mediaLineIndex
            })
          } else {
            console.warn('[RTCManager] ⚠️ transceiver 没有 track，无法添加 stream-type:', {
              mediaLineIndex,
              mediaLine: line
            })
          }
        } else {
          console.warn('[RTCManager] ⚠️ 媒体行索引超出 transceiver 数量:', {
            mediaLineIndex,
            transceiversCount: transceivers.length,
            mediaLine: line
          })
        }
      }
    }
    
    return newLines.join(lineEnding)
  }

  /**
   * 创建 Answer
   */
  async createAnswer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection 未初始化')
    }

    await this.peerConnection.setRemoteDescription(offer)
    const answer = await this.peerConnection.createAnswer()
    await this.peerConnection.setLocalDescription(answer)
    return answer
  }

  /**
   * 设置远程描述
   */
  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection 未初始化')
    }
    await this.peerConnection.setRemoteDescription(description)
  }

  /**
   * 添加 ICE Candidate
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('PeerConnection 未初始化')
    }
    await this.peerConnection.addIceCandidate(candidate)
  }

  /**
   * 切换摄像头
   */
  async toggleCamera(enabled: boolean) {
    if (!this.localStream) return

    const videoTrack = this.localStream.getVideoTracks()[0]
    if (videoTrack) {
      videoTrack.enabled = enabled
    }
  }

  /**
   * 切换麦克风
   */
  async toggleMicrophone(enabled: boolean) {
    if (!this.localStream) return

    const audioTrack = this.localStream.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.enabled = enabled
    }
  }

  /**
   * 获取远程流
   */
  getRemoteStream(streamId: string): MediaStream | undefined {
    return this.remoteStreams.get(streamId)
  }

  /**
   * 获取所有远程流
   */
  getAllRemoteStreams(): MediaStream[] {
    return Array.from(this.remoteStreams.values())
  }

  /**
   * 获取 PeerConnection 实例（用于网络状态监控）
   */
  getPeerConnection(): RTCPeerConnection | null {
    return this.peerConnection
  }

  /**
   * 关闭连接
   */
  close() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop())
      this.localStream = null
    }

    this.remoteStreams.forEach(stream => {
      stream.getTracks().forEach(track => track.stop())
    })
    this.remoteStreams.clear()
    this.remoteStreamBySender.clear()
    this.mainRemoteStream = null

    if (this.peerConnection) {
      this.peerConnection.close()
      this.peerConnection = null
    }
  }
}

/**
 * 获取网络状态
 */
export async function getNetworkStats(peerConnection: RTCPeerConnection): Promise<{
  delay: number
  bitrate: number
  status: 'good' | 'normal' | 'poor'
}> {
  try {
    const stats = await peerConnection.getStats()
    let delay = 0
    let bitrate = 0

    stats.forEach(report => {
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        delay = report.currentRoundTripTime ? report.currentRoundTripTime * 1000 : 0
      }
      if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
        bitrate = report.bytesReceived ? report.bytesReceived * 8 : 0
      }
    })

    let status: 'good' | 'normal' | 'poor' = 'good'
    if (delay > 500 || bitrate < 1000000) {
      status = 'poor'
    } else if (delay > 200 || bitrate < 2000000) {
      status = 'normal'
    }

    return { delay: Math.round(delay), bitrate: Math.round(bitrate), status }
  } catch (error) {
    console.error('获取网络状态失败:', error)
    return { delay: 0, bitrate: 0, status: 'poor' }
  }
}


