/**
 * 媒体流处理 - 摄像头、麦克风、屏幕共享
 */
import { Ref } from 'vue'
import { useLiveStore } from '@/store/liveStore'
import { RTCManager } from '@/utils/rtc'
import { SignalService } from '@/utils/signal'

export function useMediaStream(
  rtcManager: Ref<RTCManager | null>,
  signalService: Ref<SignalService | null>,
  currentUserId: Ref<string | undefined>
) {
  const store = useLiveStore()
  
  // 记录屏幕共享开始的时间戳
  let screenShareStartTime = 0
  // 记录已识别的摄像头轨道ID
  const knownCameraTrackIds = new Set<string>()
  // 记录当前 Offer/ICE 对应的流类型
  let currentStreamType: 'camera' | 'screen' | null = null
  // 从 SDP 中解析的轨道类型映射
  const trackStreamTypeMap = new Map<string, 'camera' | 'screen'>()
  let onTrackCallback: (() => void) | null = null

  /**
   * 从 SDP 中解析 stream-type 标识
   */
  function parseStreamTypeFromSDP(sdp: string): Map<string, 'camera' | 'screen'> {
    const streamTypeMap = new Map<string, 'camera' | 'screen'>()
    const lines = sdp.split(/\r?\n/)
    let mediaLineIndex = -1
    let currentMediaIndex = -1

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.startsWith('m=')) {
        mediaLineIndex++
        currentMediaIndex = mediaLineIndex
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j]
          if (nextLine.startsWith('m=')) break
          if (nextLine.startsWith('a=stream-type:')) {
            const streamType = nextLine.substring('a=stream-type:'.length).trim() as 'camera' | 'screen'
            streamTypeMap.set(currentMediaIndex.toString(), streamType)
            break
          }
        }
        if (!streamTypeMap.has(currentMediaIndex.toString())) {
          // 默认为 camera
        }
      }
    }
    return streamTypeMap
  }

  /**
   * 恢复流状态（页面刷新后）
   */
  function restoreStreamState() {
    if (store.displayMode === 'screen') {
      currentStreamType = 'screen'
      screenShareStartTime = Date.now() - 5000
    }
  }

  /**
   * 设置轨道回调函数（处理轨道识别和流创建）
   */
  function setupTrackCallback() {
    onTrackCallback = () => {
      if (!rtcManager.value) return
      const connectionPc = rtcManager.value.getPeerConnection()
      if (!connectionPc) return

      const receivers = connectionPc.getReceivers()
      const transceivers = connectionPc.getTransceivers()

      // 从 SDP 解析轨道类型
      if (trackStreamTypeMap.size === 0 && rtcManager.value) {
        const localDescription = connectionPc.localDescription
        const remoteDescription = connectionPc.remoteDescription
        const sdp = remoteDescription?.sdp || localDescription?.sdp
        if (sdp) {
          const parsedMap = parseStreamTypeFromSDP(sdp)
          parsedMap.forEach((type, key) => {
            const mediaIndex = parseInt(key)
            if (!isNaN(mediaIndex) && mediaIndex < transceivers.length) {
              const transceiver = transceivers[mediaIndex]
              if (transceiver.receiver.track) {
                trackStreamTypeMap.set(transceiver.receiver.track.id, type)
              }
            }
          })
        }
      }

      // 分别收集摄像头轨道和屏幕共享轨道
      const cameraVideoTracks: MediaStreamTrack[] = []
      const screenVideoTracks: MediaStreamTrack[] = []
      const cameraAudioTracks: MediaStreamTrack[] = []
      const screenAudioTracks: MediaStreamTrack[] = []

      const currentDisplayMode = store.displayMode
      const isScreenMode = currentDisplayMode === 'screen'
      const now = Date.now()
      const screenShareActive = (screenShareStartTime > 0 && now - screenShareStartTime < 30000) || currentStreamType === 'screen'

      // 从 transceiver 中识别轨道类型
      if (trackStreamTypeMap.size === 0) {
        const localDescription = connectionPc.localDescription
        const remoteDescription = connectionPc.remoteDescription
        const sdp = remoteDescription?.sdp || localDescription?.sdp
        if (sdp) {
          const parsedMap = parseStreamTypeFromSDP(sdp)
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
      }

      for (let i = 0; i < transceivers.length; i++) {
        const transceiver = transceivers[i]
        const receiver = transceiver.receiver
        if (!receiver.track) continue

        const track = receiver.track
        const label = track.label?.toLowerCase() || ''

        let streamTypeFromSDP = trackStreamTypeMap.get(track.id)
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
            }
          }
        }

        if (track.kind === 'video') {
          if (streamTypeFromSDP) {
            if (streamTypeFromSDP === 'screen') {
              screenVideoTracks.push(track)
            } else {
              cameraVideoTracks.push(track)
              knownCameraTrackIds.add(track.id)
            }
          } else {
            const isScreen = label.includes('screen') || label.includes('display') || label.includes('desktop') || label.includes('window')
            const isCamera = label.includes('camera') || label.includes('webcam') || label.includes('video') || label.includes('user')
            const isKnownCamera = knownCameraTrackIds.has(track.id)

            if (isScreen) {
              screenVideoTracks.push(track)
            } else if (isCamera || isKnownCamera) {
              cameraVideoTracks.push(track)
              if (!isKnownCamera) {
                knownCameraTrackIds.add(track.id)
              }
            } else {
              // 标签不明确，默认识别为摄像头
              cameraVideoTracks.push(track)
              knownCameraTrackIds.add(track.id)
            }
          }
        } else if (track.kind === 'audio') {
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

      // 处理屏幕共享流
      if (screenVideoTracks.length > 0) {
        const hasValidScreenVideo = screenVideoTracks.some(t => t.readyState !== 'ended')
        if (hasValidScreenVideo || screenVideoTracks.length > 0) {
          const currentScreenStream = store.screenStream
          let needsUpdate = true
          const isScreenShareJustStarted = screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000

          if (isScreenShareJustStarted) {
            needsUpdate = true
          } else if (currentScreenStream) {
            const currentTracks = currentScreenStream.getVideoTracks()
            const allTracksPresent = screenVideoTracks.every(t => currentTracks.some(ct => ct.id === t.id))
            const allTracksValid = currentTracks.every(t => t.readyState !== 'ended')
            if (allTracksPresent && currentTracks.length === screenVideoTracks.length && allTracksValid) {
              const hasLiveTracks = currentTracks.some(t => t.readyState === 'live')
              if (hasLiveTracks) {
                const allTracksMuted = currentTracks.every(t => t.muted)
                if (allTracksMuted) {
                  needsUpdate = true
                } else {
                  const hasValidUnmutedTracks = currentTracks.some(t => !t.muted && t.readyState !== 'ended')
                  if (hasValidUnmutedTracks) {
                    needsUpdate = false
                    if (!store.screenStream) {
                      needsUpdate = true
                    } else {
                      return
                    }
                  } else {
                    needsUpdate = true
                  }
                }
              }
            }
          }

          if (needsUpdate) {
            const isFirstScreenShare = !store.screenStream || (screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000)
            const oldStreamTrackIds = new Set<string>()
            if (store.screenStream) {
              store.screenStream.getTracks().forEach(track => {
                oldStreamTrackIds.add(track.id)
              })
            }

            let liveScreenTracks: MediaStreamTrack[]
            if (isFirstScreenShare) {
              const isPageRefresh = !store.screenStream
              liveScreenTracks = isPageRefresh ? [...screenVideoTracks] : screenVideoTracks.filter(t => t.readyState !== 'ended')
            } else {
              const isScreenShareJustStarted = screenShareStartTime > 0 && Date.now() - screenShareStartTime < 2000
              const newTracks = screenVideoTracks.filter(t => {
                const isNewTrack = !oldStreamTrackIds.has(t.id)
                const isValid = t.readyState !== 'ended'
                const isMutedButAllowed = isNewTrack && isScreenShareJustStarted && t.muted
                const isUnmuted = !t.muted
                return isNewTrack && isValid && (isMutedButAllowed || isUnmuted)
              })

              if (newTracks.length === 0 && screenVideoTracks.length > 0) {
                const allLiveTracks = screenVideoTracks.filter(t => t.readyState !== 'ended')
                if (allLiveTracks.length > 0) {
                  const isPageRefresh = !store.screenStream && allLiveTracks.length > 0
                  const allTracksMuted = allLiveTracks.every(t => t.muted)
                  if (allTracksMuted && !isScreenShareJustStarted && !isPageRefresh) {
                    liveScreenTracks = []
                  } else {
                    liveScreenTracks = allLiveTracks
                  }
                } else {
                  liveScreenTracks = []
                }
              } else {
                liveScreenTracks = newTracks
              }
            }

            if (liveScreenTracks.length === 0 && screenVideoTracks.length > 0) {
              const isPageRefresh = !store.screenStream
              if (isPageRefresh && screenVideoTracks.length > 0) {
                liveScreenTracks = [...screenVideoTracks]
              } else {
                const fallbackTracks = screenVideoTracks.filter(t => t.readyState !== 'ended')
                if (fallbackTracks.length > 0) {
                  liveScreenTracks = fallbackTracks
                } else {
                  return
                }
              }
            }

            if (store.screenStream) {
              store.setScreenStream(null)
            }

            const allScreenTracks = [...liveScreenTracks, ...screenAudioTracks]
            const screenStream = new MediaStream(allScreenTracks)

            const currentScreenStream = store.screenStream
            const needsUpdateCheck = !currentScreenStream ||
              !currentScreenStream.getVideoTracks().some(t => allScreenTracks.some(st => st.id === t.id))

            if (needsUpdateCheck) {
              store.setScreenStream(screenStream)
            } else {
              console.log('[useMediaStream] ⏳ 屏幕共享流已存在且轨道相同，跳过更新（避免闪烁）')
            }

            if (currentDisplayMode !== 'screen') {
              store.setDisplayMode('screen')
              if (currentStreamType !== 'screen') {
                currentStreamType = 'screen'
                if (screenShareStartTime === 0) {
                  screenShareStartTime = Date.now() - 5000
                }
              }
            }
          }
        }
      }

      // 处理摄像头流
      if (cameraVideoTracks.length > 0 || cameraAudioTracks.length > 0) {
        const hasValidCameraVideo = cameraVideoTracks.some(t => t.readyState !== 'ended')
        const hasValidCameraAudio = cameraAudioTracks.some(t => t.readyState !== 'ended')

        let finalCameraVideoTracks = cameraVideoTracks
        if (currentDisplayMode === 'screen' && screenVideoTracks.length > 0) {
          const misidentifiedTracks = finalCameraVideoTracks.filter(track => {
            const label = track.label?.toLowerCase() || ''
            const isScreen = label.includes('screen') || label.includes('display') || label.includes('desktop') || label.includes('window')
            const isKnownCamera = knownCameraTrackIds.has(track.id)
            return isScreen && !isKnownCamera
          })
          if (misidentifiedTracks.length > 0) {
            finalCameraVideoTracks = finalCameraVideoTracks.filter(t => !misidentifiedTracks.includes(t))
          }
        }

        if (finalCameraVideoTracks.length === 0 && cameraVideoTracks.length > 0) {
          finalCameraVideoTracks = cameraVideoTracks
        }

        const hasValidFinalVideo = finalCameraVideoTracks.some(t => t.readyState !== 'ended')

        if (hasValidFinalVideo || hasValidCameraAudio) {
          const currentTeacherStream = store.teacherStream
          let needsUpdate = true

          if (currentTeacherStream) {
            const currentVideoTracks = currentTeacherStream.getVideoTracks()
            const currentAudioTracks = currentTeacherStream.getAudioTracks()
            const allVideoTracksPresent = finalCameraVideoTracks.length === 0 ||
              finalCameraVideoTracks.every(t => currentVideoTracks.some(ct => ct.id === t.id))
            const allAudioTracksPresent = cameraAudioTracks.length === 0 ||
              cameraAudioTracks.every(t => currentAudioTracks.some(ct => ct.id === t.id))
            const videoTracksMatch = currentVideoTracks.length === finalCameraVideoTracks.length
            const audioTracksMatch = currentAudioTracks.length === cameraAudioTracks.length

            if (allVideoTracksPresent && allAudioTracksPresent && videoTracksMatch && audioTracksMatch) {
              const allTracksValid = [...currentVideoTracks, ...currentAudioTracks].every(t => t.readyState !== 'ended')
              if (allTracksValid) {
                const hasLiveTracks = [...currentVideoTracks, ...currentAudioTracks].some(t => t.readyState === 'live')
                if (hasLiveTracks) {
                  needsUpdate = false
                }
              }
            }
          }

          if (needsUpdate) {
            const isPageRefresh = !store.teacherStream
            const validVideoTracks = isPageRefresh
              ? finalCameraVideoTracks
              : finalCameraVideoTracks.filter(t => t.readyState !== 'ended')
            const validAudioTracks = isPageRefresh
              ? cameraAudioTracks
              : cameraAudioTracks.filter(t => t.readyState !== 'ended')

            if (validVideoTracks.length > 0 || validAudioTracks.length > 0) {
              const cameraStream = new MediaStream([...validVideoTracks, ...validAudioTracks])
              store.setTeacherStream(cameraStream)
              validVideoTracks.forEach(track => {
                knownCameraTrackIds.add(track.id)
              })
            }
          }
        }
      }
    }

    if (rtcManager.value && onTrackCallback) {
      rtcManager.value.setOnTrack(onTrackCallback)
    }
  }

  /**
   * 设置页面刷新后的轨道恢复
   */
  function setupPageRefreshTrackRecovery() {
    setTimeout(() => {
      if (rtcManager.value) {
        const pc = rtcManager.value.getPeerConnection()
        if (pc) {
          const receivers = pc.getReceivers()
          const videoReceivers = receivers.filter(r => r.track?.kind === 'video' && r.track.readyState !== 'ended')
          const audioReceivers = receivers.filter(r => r.track?.kind === 'audio' && r.track.readyState !== 'ended')

          if (videoReceivers.length > 0 || audioReceivers.length > 0) {
            if (videoReceivers.length > 1) {
              if (currentStreamType !== 'screen') {
                currentStreamType = 'screen'
                screenShareStartTime = Date.now() - 5000
              }
              if ((store.displayMode as string) !== 'screen') {
                store.setDisplayMode('screen')
              }
            } else if (videoReceivers.length === 1 && (store.displayMode as string) !== 'screen') {
              const track = videoReceivers[0].track
              if (track) {
                const label = track.label?.toLowerCase() || ''
                const isScreen = label.includes('screen') || label.includes('display') || label.includes('desktop') || label.includes('window')
                if (isScreen) {
                  if (currentStreamType !== 'screen') {
                    currentStreamType = 'screen'
                    screenShareStartTime = Date.now() - 5000
                  }
                  if ((store.displayMode as string) !== 'screen') {
                    store.setDisplayMode('screen')
                  }
                }
              }
            }

            if (onTrackCallback) {
              onTrackCallback()
            }
          }
        }
      }
    }, 2000)
  }

  /**
   * 设置 ICE candidate 回调
   */
  function setupIceCandidateHandler() {
    if (!rtcManager.value) return
    rtcManager.value.setOnIceCandidate((candidate) => {
      if (signalService.value) {
        signalService.value.sendIceCandidate('broadcast', candidate)
      }
    })
  }

  return {
    screenShareStartTime: () => screenShareStartTime,
    setScreenShareStartTime: (time: number) => { screenShareStartTime = time },
    currentStreamType: () => currentStreamType,
    setCurrentStreamType: (type: 'camera' | 'screen' | null) => { currentStreamType = type },
    knownCameraTrackIds,
    trackStreamTypeMap,
    parseStreamTypeFromSDP,
    restoreStreamState,
    setupTrackCallback,
    setupPageRefreshTrackRecovery,
    setupIceCandidateHandler,
    getOnTrackCallback: () => onTrackCallback,
    setOnTrackCallback: (callback: (() => void) | null) => { onTrackCallback = callback }
  }
}
