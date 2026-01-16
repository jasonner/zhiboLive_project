<template>
  <div class="live-video-container">
    <video
      ref="videoRef"
      autoplay
      playsinline
      :muted="!hasAudio"
      disablePictureInPicture
      class="video-element"
      :class="{ 'video-small': isSmall }"
      @loadedmetadata="onLoadedMetadata"
      @play="onPlay"
      @error="onError"
      @pause="onPause"
    ></video>
    <div class="video-overlay" v-if="showControls">
      <div class="video-info">
        <span class="user-name">{{ userName }}</span>
        <div class="video-status">
          <el-icon v-if="!cameraEnabled"><VideoCamera /></el-icon>
          <el-icon v-if="!microphoneEnabled"><Microphone /></el-icon>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { VideoCamera, Microphone } from '@element-plus/icons-vue'

interface Props {
  stream?: MediaStream | null
  userName?: string
  isSmall?: boolean
  cameraEnabled?: boolean
  microphoneEnabled?: boolean
  showControls?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  userName: '',
  isSmall: false,
  cameraEnabled: true,
  microphoneEnabled: true,
  showControls: true
})

const videoRef = ref<HTMLVideoElement | null>(null)
const isComponentMounted = ref(false)

// 计算是否有音频轨道
const hasAudio = computed(() => {
  return props.stream ? props.stream.getAudioTracks().length > 0 : false
})

const setupVideoStream = async (stream: MediaStream | null) => {
  // 检查 video 元素是否存在
  if (!videoRef.value) {
    console.warn('[LiveVideo] video 元素不存在，跳过设置流')
    return
  }

  const videoElement = videoRef.value

  if (stream) {
    console.log('[LiveVideo] 设置视频流:', stream.id, '轨道数:', stream.getTracks().length)
    stream.getTracks().forEach(track => {
      console.log(`[LiveVideo] 轨道: ${track.kind}, enabled: ${track.enabled}, readyState: ${track.readyState}, muted: ${track.muted}`)
    })
    
    // 再次检查 video 元素是否存在
    if (!videoElement) {
      console.warn('[LiveVideo] video 元素在设置流时被移除')
      return
    }
    
    // 检查是否已经是同一个流，如果是则不需要重新设置（避免 readyState 重置）
    if (videoElement.srcObject === stream) {
      console.log('[LiveVideo] ⚠️ srcObject 已经是同一个流，跳过设置（避免 readyState 重置）')
      console.log('[LiveVideo] 当前状态:', {
        readyState: videoElement.readyState,
        paused: videoElement.paused,
        videoWidth: videoElement.videoWidth,
        videoHeight: videoElement.videoHeight
      })
      // 即使流相同，也检查是否需要播放
      if (videoElement.paused && videoElement.readyState >= 2) {
        console.log('[LiveVideo] 流相同但视频暂停，尝试播放...')
        tryPlayVideo(videoElement)
      }
      return
    }
    
    // 先清除旧的流（如果有）
    if (videoElement.srcObject) {
      const oldStream = videoElement.srcObject as MediaStream
      console.log('[LiveVideo] 清除旧的 srcObject:', {
        oldStreamId: oldStream.id,
        newStreamId: stream.id,
        oldTracks: oldStream.getTracks().length,
        newTracks: stream.getTracks().length
      })
      videoElement.srcObject = null
      // 等待一下，确保清除完成
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    
    // 禁用画中画功能
    videoElement.disablePictureInPicture = true
    
    // 设置 srcObject
    videoElement.srcObject = stream
    console.log('[LiveVideo] ✅ srcObject 已设置')
    console.log('[LiveVideo] 设置后验证:', {
      srcObject: videoElement.srcObject,
      srcObjectId: videoElement.srcObject ? (videoElement.srcObject as MediaStream).id : null,
      expectedStreamId: stream.id,
      matches: videoElement.srcObject === stream,
      readyState: videoElement.readyState,
      paused: videoElement.paused
    })
    
    // 如果设置失败，尝试再次设置
    if (videoElement.srcObject !== stream) {
      console.warn('[LiveVideo] ⚠️ srcObject 设置失败，尝试再次设置...')
      videoElement.srcObject = null
      await new Promise(resolve => setTimeout(resolve, 50))
      videoElement.srcObject = stream
      console.log('[LiveVideo] 重新设置后验证:', {
        srcObject: videoElement.srcObject,
        matches: videoElement.srcObject === stream
      })
    }
    
    // 检查流的轨道状态
    const videoTracks = stream.getVideoTracks()
    const audioTracks = stream.getAudioTracks()
    console.log('[LiveVideo] 流轨道状态:', {
      video: videoTracks.map(t => ({ enabled: t.enabled, readyState: t.readyState, muted: t.muted })),
      audio: audioTracks.map(t => ({ enabled: t.enabled, readyState: t.readyState, muted: t.muted }))
    })
    
    // 重要：根据是否有音频轨道来设置 video 元素的 muted 属性
    // 如果有音频轨道，取消静音以播放音频
    if (audioTracks.length > 0) {
      videoElement.muted = false
      console.log('[LiveVideo] 🔊 检测到音频轨道，取消视频元素静音以播放音频')
      console.log('[LiveVideo] 音频轨道详情:', audioTracks.map(t => ({
        id: t.id,
        label: t.label,
        enabled: t.enabled,
        readyState: t.readyState,
        muted: t.muted
      })))
    } else {
      videoElement.muted = true
      console.log('[LiveVideo] 🔇 没有音频轨道，保持视频元素静音')
    }
    
    // 强制尝试播放（不等待事件）
    setTimeout(() => {
      if (videoElement && videoElement.srcObject === stream) {
        console.log('[LiveVideo] 延迟尝试播放，readyState:', videoElement.readyState)
        // 检查视频元素是否可见
        const rect = videoElement.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) {
          console.warn('[LiveVideo] ⚠️ 视频元素尺寸为 0，可能被隐藏')
        }
        tryPlayVideo(videoElement)
      }
    }, 100)
    
    // 多次尝试播放（确保在微前端环境中能播放）
    setTimeout(() => {
      if (videoElement && videoElement.srcObject === stream && videoElement.paused) {
        console.log('[LiveVideo] 延迟 500ms 后再次尝试播放（视频仍暂停）')
        tryPlayVideo(videoElement)
      }
    }, 500)
    
    setTimeout(() => {
      if (videoElement && videoElement.srcObject === stream && videoElement.paused) {
        console.log('[LiveVideo] 延迟 1000ms 后再次尝试播放（视频仍暂停）')
        tryPlayVideo(videoElement)
      }
    }, 1000)
    
    // 监听所有可能的事件，确保能捕获到媒体数据加载
    const onMetadataLoaded = () => {
      console.log('[LiveVideo] ✅ loadedmetadata 事件触发，readyState:', videoElement.readyState)
      console.log('[LiveVideo] 视频尺寸:', videoElement.videoWidth, 'x', videoElement.videoHeight)
      if (videoElement && videoElement.srcObject === stream) {
        tryPlayVideo(videoElement)
      }
    }
    videoElement.addEventListener('loadedmetadata', onMetadataLoaded, { once: true })
    
    const onLoadedData = () => {
      console.log('[LiveVideo] ✅ loadeddata 事件触发，readyState:', videoElement.readyState)
      if (videoElement && videoElement.srcObject === stream && videoElement.paused) {
        tryPlayVideo(videoElement)
      }
    }
    videoElement.addEventListener('loadeddata', onLoadedData, { once: true })
    
    const onCanPlay = () => {
      console.log('[LiveVideo] ✅ canplay 事件触发，readyState:', videoElement.readyState)
      if (videoElement && videoElement.paused && videoElement.srcObject === stream) {
        tryPlayVideo(videoElement)
      }
    }
    videoElement.addEventListener('canplay', onCanPlay, { once: true })
    
    const onCanPlayThrough = () => {
      console.log('[LiveVideo] ✅ canplaythrough 事件触发，readyState:', videoElement.readyState)
      if (videoElement && videoElement.paused && videoElement.srcObject === stream) {
        tryPlayVideo(videoElement)
      }
    }
    videoElement.addEventListener('canplaythrough', onCanPlayThrough, { once: true })
    
    // 监听 playing 事件
    const onPlaying = () => {
      console.log('[LiveVideo] ✅ playing 事件触发，视频正在播放')
      console.log('[LiveVideo] 播放时状态:', {
        readyState: videoElement.readyState,
        videoWidth: videoElement.videoWidth,
        videoHeight: videoElement.videoHeight,
        paused: videoElement.paused
      })
    }
    videoElement.addEventListener('playing', onPlaying, { once: true })
    
    // 监听 readyState 变化
    let lastReadyState = videoElement.readyState
    const checkReadyState = setInterval(() => {
      if (videoElement && videoElement.srcObject === stream) {
        const currentReadyState = videoElement.readyState
        if (currentReadyState !== lastReadyState) {
          console.log(`[LiveVideo] readyState 变化: ${lastReadyState} -> ${currentReadyState}`, {
            0: 'HAVE_NOTHING',
            1: 'HAVE_METADATA',
            2: 'HAVE_CURRENT_DATA',
            3: 'HAVE_FUTURE_DATA',
            4: 'HAVE_ENOUGH_DATA'
          }[currentReadyState])
          lastReadyState = currentReadyState
          
          // 如果 readyState 变为 HAVE_METADATA 或更高，尝试播放
          if (currentReadyState >= 1 && videoElement.paused) {
            console.log('[LiveVideo] readyState 已变化，尝试播放...')
            tryPlayVideo(videoElement)
          }
        }
        
        // 如果 readyState 一直是 0，检查视频轨道
        if (currentReadyState === 0) {
          const videoTracks = stream.getVideoTracks()
          if (videoTracks.length > 0) {
            const track = videoTracks[0]
            console.log('[LiveVideo] ⚠️ readyState 仍为 0，检查视频轨道:', {
              enabled: track.enabled,
              readyState: track.readyState,
              muted: track.muted,
              label: track.label,
              settings: track.getSettings ? track.getSettings() : '无法获取设置'
            })
            
            // 如果轨道 enabled 但 readyState 仍为 0，可能是数据流问题
            if (track.enabled && track.readyState === 'live') {
              console.warn('[LiveVideo] ⚠️ 视频轨道是 live 但视频元素 readyState 仍为 0，可能是数据流未传输')
            }
          }
        }
      } else {
        clearInterval(checkReadyState)
      }
    }, 500)
    
    // 10 秒后停止检查
    setTimeout(() => {
      clearInterval(checkReadyState)
      console.log('[LiveVideo] 停止 readyState 检查')
    }, 10000)
  } else {
    console.log('[LiveVideo] 清除视频流')
    if (videoElement) {
      videoElement.srcObject = null
    }
  }
}

const tryPlayVideo = async (videoElement: HTMLVideoElement) => {
  if (!videoElement) {
    console.warn('[LiveVideo] video 元素不存在，无法播放')
    return
  }

  // 检查视频元素的状态
  const checkVideoState = () => {
    const rect = videoElement.getBoundingClientRect()
    const computedStyle = window.getComputedStyle(videoElement)
    return {
      hasSrcObject: !!videoElement.srcObject,
      readyState: videoElement.readyState,
      paused: videoElement.paused,
      ended: videoElement.ended,
      muted: videoElement.muted,
      autoplay: videoElement.autoplay,
      playsinline: videoElement.playsInline,
      width: videoElement.videoWidth,
      height: videoElement.videoHeight,
      clientWidth: videoElement.clientWidth,
      clientHeight: videoElement.clientHeight,
      offsetWidth: videoElement.offsetWidth,
      offsetHeight: videoElement.offsetHeight,
      rectWidth: rect.width,
      rectHeight: rect.height,
      display: computedStyle.display,
      visibility: computedStyle.visibility,
      opacity: computedStyle.opacity,
      zIndex: computedStyle.zIndex,
      position: computedStyle.position
    }
  }

  const state = checkVideoState()
  console.log('[LiveVideo] 尝试播放前的视频状态:', state)

  // 检查视频元素是否可见
  if (state.rectWidth === 0 || state.rectHeight === 0) {
    console.warn('[LiveVideo] ⚠️ 视频元素尺寸为 0，可能被隐藏或未渲染')
    console.warn('[LiveVideo] 元素尺寸:', {
      clientWidth: state.clientWidth,
      clientHeight: state.clientHeight,
      offsetWidth: state.offsetWidth,
      offsetHeight: state.offsetHeight,
      rectWidth: state.rectWidth,
      rectHeight: state.rectHeight,
      display: state.display,
      visibility: state.visibility,
      opacity: state.opacity
    })
  }

  // 检查是否有 srcObject
  if (!videoElement.srcObject) {
    console.error('[LiveVideo] ❌ 视频元素没有 srcObject，无法播放')
    return
  }

    // 检查视频轨道是否有效
    const stream = videoElement.srcObject as MediaStream | null
    if (!stream) {
      console.error('[LiveVideo] ❌ 视频元素没有 srcObject，无法检查轨道')
      return
    }
    
    const videoTracks = stream.getVideoTracks()
    if (videoTracks.length === 0) {
      console.warn('[LiveVideo] ⚠️ 流中没有视频轨道')
    } else {
      videoTracks.forEach((track, index) => {
        const settings = track.getSettings ? track.getSettings() : {}
        const capabilities = track.getCapabilities ? track.getCapabilities() : {}
        console.log(`[LiveVideo] 视频轨道 ${index} 详细状态:`, {
          id: track.id,
          enabled: track.enabled,
          readyState: track.readyState,
          muted: track.muted,
          label: track.label,
          settings: settings,
          capabilities: capabilities,
          frameRate: settings.frameRate || '未知',
          width: settings.width || '未知',
          height: settings.height || '未知'
        })
        
        // 如果 frameRate 为 0，说明没有实际数据
        if (settings.frameRate === 0) {
          console.error(`[LiveVideo] ❌ 视频轨道 ${index} frameRate 为 0，没有实际视频数据！`)
          console.error(`[LiveVideo] 可能的原因：`)
          console.error(`[LiveVideo] 1. WebRTC 连接未完全建立`)
          console.error(`[LiveVideo] 2. 媒体流未传输`)
          console.error(`[LiveVideo] 3. 视频轨道被禁用或静音`)
        }
        
        // 监听轨道状态变化
        track.onended = () => {
          console.warn(`[LiveVideo] ⚠️ 视频轨道 ${index} 已结束`)
        }
        
        track.onmute = () => {
          console.warn(`[LiveVideo] ⚠️ 视频轨道 ${index} 被静音`)
        }
        
        track.onunmute = () => {
          console.log(`[LiveVideo] ✅ 视频轨道 ${index} 取消静音`)
        }
        
        // 如果轨道被静音，说明轨道暂时没有数据
        // 注意：在 WebRTC 中，轨道可能在数据开始传输前暂时被标记为 muted
        // 我们应该等待一段时间，看轨道是否会取消静音
        if (track.muted) {
          console.warn(`[LiveVideo] ⚠️ 视频轨道 ${index} 被静音（可能暂时没有数据），轨道ID: ${track.id}, label: ${track.label}`)
          
          // 监听 unmute 事件，当数据开始传输时自动取消静音
          const handleUnmute = () => {
            console.log(`[LiveVideo] ✅ 视频轨道 ${index} 取消静音，数据开始传输`)
            track.removeEventListener('unmute', handleUnmute)
          }
          track.addEventListener('unmute', handleUnmute)
          
          // 如果轨道持续被静音超过 3 秒，可能是真的没有数据
          setTimeout(() => {
            if (track.muted && videoElement.srcObject === stream) {
              console.warn(`[LiveVideo] ⚠️ 视频轨道 ${index} 持续被静音超过 3 秒，可能没有数据`)
              // 检查是否有其他未静音的轨道
              const currentStream = videoElement.srcObject as MediaStream | null
              if (currentStream) {
                const activeTracks = currentStream.getVideoTracks().filter(t => !t.muted && t.readyState === 'live')
                if (activeTracks.length === 0) {
                  console.error(`[LiveVideo] ❌ 流中所有视频轨道都被静音，无法显示视频`)
                  // 清除流，避免显示黑色背景
                  videoElement.srcObject = null
                } else if (activeTracks.length < currentStream.getVideoTracks().length) {
                  // 创建新流，只包含未静音的轨道
                  console.log(`[LiveVideo] 创建新流，移除被静音的轨道...`)
                  const newStream = new MediaStream([...activeTracks, ...currentStream.getAudioTracks()])
                  videoElement.srcObject = newStream
                  console.log(`[LiveVideo] ✅ 已创建新流，包含 ${activeTracks.length} 个活跃视频轨道`)
                }
              }
            }
          }, 3000)
        }
        
        // 如果轨道 enabled 但视频元素 readyState 为 0，尝试重新启用轨道
        if (track.enabled && videoElement.readyState === 0) {
          console.log(`[LiveVideo] 尝试重新启用视频轨道 ${index}...`)
          track.enabled = false
          setTimeout(() => {
            track.enabled = true
            console.log(`[LiveVideo] 视频轨道 ${index} 已重新启用`)
            
            // 重新启用后，再次检查 readyState
            setTimeout(() => {
              if (videoElement.readyState === 0) {
                console.error(`[LiveVideo] ❌ 重新启用后 readyState 仍为 0`)
                console.error(`[LiveVideo] 可能的原因：媒体流没有实际数据传输`)
              }
            }, 500)
          }, 100)
        }
        
        // 如果轨道未启用，尝试启用
        if (!track.enabled) {
          console.warn(`[LiveVideo] ⚠️ 视频轨道 ${index} 未启用，尝试启用...`)
          track.enabled = true
        }
      })
      
      // 如果所有轨道都 enabled 但 readyState 仍为 0，尝试重新设置流
      const allEnabled = videoTracks.every(t => t.enabled)
      const allLive = videoTracks.every(t => t.readyState === 'live')
      if (allEnabled && allLive && videoElement.readyState === 0) {
        console.warn('[LiveVideo] ⚠️ 所有轨道都 enabled 且 live，但 readyState 仍为 0')
        console.warn('[LiveVideo] 尝试重新设置流...')
        
        // 保存当前流
        const currentStream = videoElement.srcObject as MediaStream
        
        // 清除并重新设置
        setTimeout(() => {
          if (videoElement && videoElement.srcObject === currentStream) {
            videoElement.srcObject = null
            setTimeout(() => {
              videoElement.srcObject = currentStream
              console.log('[LiveVideo] 已重新设置流，等待 readyState 变化...')
              
              // 监听 readyState 变化
              const checkReadyState = setInterval(() => {
                if (videoElement.readyState > 0) {
                  console.log('[LiveVideo] ✅ 重新设置后 readyState 已变化:', videoElement.readyState)
                  clearInterval(checkReadyState)
                  tryPlayVideo(videoElement)
                }
              }, 100)
              
              // 5 秒后停止检查
              setTimeout(() => {
                clearInterval(checkReadyState)
                if (videoElement.readyState === 0) {
                  console.error('[LiveVideo] ❌ 重新设置后 readyState 仍为 0，可能是媒体流没有实际数据')
                }
              }, 5000)
            }, 100)
          }
        }, 500)
      }
    }
    
    // 检查 WebRTC 连接状态（如果可能）
    // 尝试从全局或父组件获取 PeerConnection 状态
    try {
      // 检查是否有全局的 RTC 管理器
      const checkRTCConnection = () => {
        // 尝试通过 DOM 或其他方式获取连接状态
        // 这里我们添加一个提示，让用户检查连接状态
        console.log('[LiveVideo] 💡 提示：如果视频不播放，请检查 WebRTC 连接状态')
        console.log('[LiveVideo] 💡 连接状态应该在 StudentRoom 的日志中显示')
      }
      checkRTCConnection()
    } catch (error) {
      // 忽略错误
    }

  try {
    // 确保视频元素是可见的
    if (state.display === 'none') {
      console.warn('[LiveVideo] ⚠️ 视频元素被隐藏，尝试显示...')
      videoElement.style.display = 'block'
    }

    // 强制设置 autoplay 和 playsinline
    if (!videoElement.autoplay) {
      videoElement.setAttribute('autoplay', '')
      videoElement.autoplay = true
    }
    if (!videoElement.playsInline) {
      videoElement.setAttribute('playsinline', '')
      videoElement.playsInline = true
    }

    // 重要：对于屏幕共享流，确保视频元素不被静音（虽然 muted 属性可能为 true，但不影响显示）
    // 注意：muted 属性主要用于音频，对于视频显示没有影响
    // 但如果视频元素被静音，可能需要取消静音（虽然通常不需要）
    // 这里我们只确保 autoplay 和 playsinline 设置正确

    // 尝试播放
    const playPromise = videoElement.play()
    
    if (playPromise !== undefined) {
      await playPromise
      console.log('[LiveVideo] ✅ 视频播放成功')
      
      // 验证播放状态
      setTimeout(() => {
        const afterState = checkVideoState()
        console.log('[LiveVideo] 播放后的视频状态:', {
          paused: afterState.paused,
          ended: afterState.ended,
          readyState: afterState.readyState,
          width: afterState.width,
          height: afterState.height
        })
        
        if (afterState.paused) {
          console.warn('[LiveVideo] ⚠️ 视频播放后仍然暂停，尝试再次播放...')
          videoElement.play().catch(err => {
            console.error('[LiveVideo] ❌ 再次播放失败:', err)
          })
        }
      }, 100)
    } else {
      console.log('[LiveVideo] play() 返回 undefined（可能已播放）')
    }
  } catch (error: any) {
    // 忽略 AbortError（通常是因为元素被移除或流被替换）
    if (error?.name === 'AbortError') {
      console.log('[LiveVideo] 播放请求被中断（可能是流被替换）')
      return
    }
    console.error('[LiveVideo] ❌ 视频播放失败:', error)
    console.error('[LiveVideo] 错误详情:', {
      name: error?.name,
      message: error?.message,
      stack: error?.stack
    })
    
    // 如果是 NotAllowedError，说明需要用户交互
    if (error?.name === 'NotAllowedError') {
      console.warn('[LiveVideo] ⚠️ 自动播放被阻止，需要用户交互')
    }
  }
}

// 使用 watchEffect 确保能捕获到流的变化
watch(() => props.stream, async (newStream, oldStream) => {
  console.log('[LiveVideo] ========== stream 变化 ==========')
  console.log('[LiveVideo] stream 变化:', {
    old: oldStream?.id,
    new: newStream?.id,
    hasVideo: newStream ? newStream.getVideoTracks().length > 0 : false,
    hasAudio: newStream ? newStream.getAudioTracks().length > 0 : false,
    oldTracks: oldStream ? oldStream.getTracks().length : 0,
    newTracks: newStream ? newStream.getTracks().length : 0,
    videoElementExists: !!videoRef.value,
    propsStream: props.stream?.id,
    streamReference: props.stream
  })
  
  // 如果流没有变化，跳过
  if (newStream === oldStream && newStream !== null) {
    console.log('[LiveVideo] 流引用未变化，但触发 watch，检查是否需要更新...')
    // 即使引用相同，也检查一下 srcObject 是否正确设置
    if (videoRef.value && newStream && videoRef.value.srcObject !== newStream) {
      console.log('[LiveVideo] ⚠️ 流引用相同但 srcObject 不匹配，重新设置...')
      await setupVideoStream(newStream)
    }
    return
  }
  
  // 如果 video 元素不存在，尝试通过 DOM 查询（微前端环境）
  if (!videoRef.value) {
    console.warn('[LiveVideo] ⚠️ video 元素不存在，尝试通过 DOM 查询（微前端环境）...')
    
    // 立即尝试通过 DOM 查询
    const findVideoElement = (): HTMLVideoElement | null => {
      // 尝试多种选择器，适应不同的 DOM 结构
      const selectors = [
        '.live-video-container video',
        'video.video-element',
        '.teacher-video-mini video',
        'video[autoplay]'
      ]
      
      for (const selector of selectors) {
        const element = document.querySelector(selector) as HTMLVideoElement
        if (element) {
          console.log(`[LiveVideo] 通过选择器 "${selector}" 找到 video 元素`)
          return element
        }
      }
      return null
    }
    
    let videoElement = findVideoElement()
    
    // 如果立即找不到，使用轮询检查（最多等待 3 秒）
    if (!videoElement) {
      let attempts = 0
      const maxAttempts = 30 // 30 * 100ms = 3秒
      while (!videoElement && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 100))
        attempts++
        videoElement = findVideoElement()
        if (videoElement) {
          console.log(`[LiveVideo] 通过 DOM 查询找到 video 元素（等待 ${attempts * 100}ms）`)
          break
        }
      }
    }
    
    // 如果找到 video 元素，设置 ref
    if (videoElement) {
      videoRef.value = videoElement
      console.log('[LiveVideo] ✅ video 元素已找到并设置 ref')
    } else {
      console.error('[LiveVideo] ❌ 无法找到 video 元素（已等待 3 秒）')
      // 即使找不到 ref，也尝试直接通过 DOM 设置流
      if (newStream) {
        const container = document.querySelector('.live-video-container')
        if (container) {
          const directVideoElement = container.querySelector('video') as HTMLVideoElement
          if (directVideoElement) {
            console.log('[LiveVideo] 通过 DOM 直接设置流（未找到 ref）...')
            directVideoElement.srcObject = newStream
            try {
              await directVideoElement.play()
              console.log('[LiveVideo] ✅ 通过 DOM 直接设置流成功')
              // 设置成功后，更新 ref
              videoRef.value = directVideoElement
            } catch (error) {
              console.error('[LiveVideo] ❌ 通过 DOM 直接设置流失败:', error)
            }
          }
        }
      }
      return
    }
  }
  
  // 如果组件未挂载但 video 元素存在，也尝试设置（微前端环境）
  if (!isComponentMounted.value && videoRef.value) {
    console.warn('[LiveVideo] ⚠️ 组件未挂载但 video 元素存在，尝试设置流（微前端环境）...')
    // 在微前端环境中，即使组件未完全挂载，只要 video 元素存在就可以设置流
    if (newStream && videoRef.value) {
      console.log('[LiveVideo] 在微前端环境中直接设置流...')
      try {
        videoRef.value.srcObject = newStream
        console.log('[LiveVideo] ✅ 流已设置到 video 元素')
        // 尝试播放
        setTimeout(async () => {
          if (videoRef.value && videoRef.value.srcObject === newStream) {
            try {
              await videoRef.value.play()
              console.log('[LiveVideo] ✅ 视频播放成功')
            } catch (error) {
              console.warn('[LiveVideo] ⚠️ 自动播放失败（可能需要用户交互）:', error)
            }
          }
        }, 100)
      } catch (error) {
        console.error('[LiveVideo] ❌ 设置流失败:', error)
      }
    }
    return
  }
  
  // 使用 nextTick 确保 DOM 已更新
  await nextTick()
  
  // 再次检查 video 元素是否存在
  if (!videoRef.value) {
    console.warn('[LiveVideo] ⚠️ video 元素在 nextTick 后仍不存在，等待挂载...')
    await new Promise(resolve => setTimeout(resolve, 50))
    if (!videoRef.value) {
      console.error('[LiveVideo] ❌ video 元素仍然不存在，无法设置流')
      return
    }
  }
  
  console.log('[LiveVideo] 准备设置流到 video 元素...')
  await setupVideoStream(newStream || null)
  
  // 验证设置结果（多次验证，确保设置成功）
  if (videoRef.value && newStream) {
    // 立即验证
    const immediateCheck = () => {
      if (videoRef.value) {
        const actualSrcObject = videoRef.value.srcObject
        const matches = actualSrcObject === newStream
        console.log('[LiveVideo] 立即验证 srcObject:', {
          hasSrcObject: !!actualSrcObject,
          srcObjectId: actualSrcObject ? (actualSrcObject as MediaStream).id : null,
          expectedStreamId: newStream.id,
          matches
        })
        
        if (!matches) {
          console.warn('[LiveVideo] ⚠️ srcObject 不匹配，强制设置...')
          videoRef.value.srcObject = newStream
        }
      }
    }
    
    immediateCheck()
    
    // 延迟验证（确保设置完成）
    setTimeout(() => {
      if (videoRef.value) {
        const actualSrcObject = videoRef.value.srcObject
        const matches = actualSrcObject === newStream
        console.log('[LiveVideo] 延迟验证 srcObject (200ms):', {
          hasSrcObject: !!actualSrcObject,
          srcObjectId: actualSrcObject ? (actualSrcObject as MediaStream).id : null,
          expectedStreamId: newStream.id,
          matches
        })
        
        if (!matches && newStream) {
          console.error('[LiveVideo] ❌ srcObject 仍未正确设置，最后一次尝试...')
          if (videoRef.value) {
            videoRef.value.srcObject = newStream
            // 再次验证
            setTimeout(() => {
              if (videoRef.value) {
                console.log('[LiveVideo] 最终验证 srcObject:', {
                  hasSrcObject: !!videoRef.value.srcObject,
                  matches: videoRef.value.srcObject === newStream
                })
              }
            }, 100)
          }
        }
      }
    }, 200)
  }
  
  console.log('[LiveVideo] =========================================')
}, { immediate: true, deep: false }) // 改为 deep: false，因为 MediaStream 对象引用变化即可

onMounted(async () => {
  console.log('[LiveVideo] ========== 组件已挂载 ==========')
  isComponentMounted.value = true
  
  // 禁用画中画功能
  if (videoRef.value) {
    videoRef.value.disablePictureInPicture = true
    // 防止通过 API 启用画中画
    if (videoRef.value.requestPictureInPicture) {
      videoRef.value.requestPictureInPicture = () => {
        console.warn('[LiveVideo] 画中画功能已禁用')
        return Promise.reject(new Error('画中画功能已禁用'))
      }
    }
  }
     
  console.log('[LiveVideo] 挂载时状态:', {
    hasVideoElement: !!videoRef.value,
    hasStream: !!props.stream,
    streamId: props.stream?.id,
    videoTracks: props.stream?.getVideoTracks().length || 0,
    audioTracks: props.stream?.getAudioTracks().length || 0,
    isMicroApp: !!(window.__MICRO_APP_ENVIRONMENT__ || (window as any).microApp)
  })
  
  // 在微前端环境中，需要更长的等待时间确保 DOM 完全渲染
  const isMicroAppEnv = !!(window.__MICRO_APP_ENVIRONMENT__ || (window as any).microApp)
  const waitTime = isMicroAppEnv ? 300 : 100
  
  // 等待下一个 tick，确保 DOM 已完全渲染
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, waitTime))
  
  // 如果 video 元素仍不存在，使用轮询检查（微前端环境）
  if (!videoRef.value) {
    console.warn('[LiveVideo] ⚠️ 挂载后 video 元素不存在，使用轮询检查（微前端环境）...')
    let attempts = 0
    const maxAttempts = 30 // 增加到 30 次，3 秒
    while (!videoRef.value && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 100))
      attempts++
      
      // 尝试通过 DOM 查询找到 video 元素
      const container = document.querySelector('.live-video-container')
      if (container) {
        const videoElement = container.querySelector('video') as HTMLVideoElement
        if (videoElement) {
          console.log(`[LiveVideo] 通过 DOM 查询找到 video 元素（等待 ${attempts * 100}ms）`)
          videoRef.value = videoElement
          break
        }
      }
      
      if (videoRef.value) {
        console.log(`[LiveVideo] ✅ video 元素已找到（等待 ${attempts * 100}ms）`)
        break
      }
    }
  }
  
  if (!videoRef.value) {
    console.error('[LiveVideo] ❌ 挂载后 video 元素仍不存在（已等待 3 秒）')
    // 即使找不到，也尝试在下一个 tick 设置
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // 最后尝试：通过 DOM 查询
    const container = document.querySelector('.live-video-container')
    if (container) {
      const videoElement = container.querySelector('video') as HTMLVideoElement
      if (videoElement) {
        console.log('[LiveVideo] 通过 DOM 查询找到 video 元素，设置 ref')
        videoRef.value = videoElement
      }
    }
    
    if (!videoRef.value) {
      console.error('[LiveVideo] ❌ nextTick 后 video 元素仍不存在')
      return
    }
  }
  
  if (props.stream) {
    console.log('[LiveVideo] 挂载时检测到流，立即设置...')
    await setupVideoStream(props.stream)
    
    // 验证设置（多次验证，确保在微前端环境中设置成功）
    const verifyAndRetry = (attempt: number = 1) => {
      if (!videoRef.value) return
      
      setTimeout(() => {
        if (!videoRef.value) return
        
        const actualSrcObject = videoRef.value.srcObject
        console.log(`[LiveVideo] 挂载后验证 srcObject (第 ${attempt} 次):`, {
          hasSrcObject: !!actualSrcObject,
          srcObjectId: actualSrcObject ? (actualSrcObject as MediaStream).id : null,
          expectedStreamId: props.stream?.id,
          matches: actualSrcObject === props.stream
        })
        
        if (!actualSrcObject && props.stream) {
          if (attempt < 3) {
            console.warn(`[LiveVideo] ⚠️ srcObject 未设置，尝试重新设置（第 ${attempt} 次）...`)
            videoRef.value.srcObject = props.stream
            tryPlayVideo(videoRef.value)
            verifyAndRetry(attempt + 1)
          } else {
            console.error('[LiveVideo] ❌ 多次尝试后 srcObject 仍未设置')
          }
        } else if (actualSrcObject === props.stream) {
          console.log('[LiveVideo] ✅ srcObject 设置成功')
        }
      }, attempt * 100)
    }
    
    verifyAndRetry()
  } else {
    console.log('[LiveVideo] 挂载时没有流，等待 stream prop 变化...')
  }
  console.log('[LiveVideo] =========================================')
})

const onLoadedMetadata = () => {
  console.log('[LiveVideo] 视频元数据加载完成')
  if (videoRef.value) {
    console.log('[LiveVideo] 视频尺寸:', videoRef.value.videoWidth, 'x', videoRef.value.videoHeight)
    console.log('[LiveVideo] 当前 srcObject:', videoRef.value.srcObject)
    console.log('[LiveVideo] 视频 readyState:', videoRef.value.readyState)
    
    // 如果元数据已加载但还没播放，尝试播放
    if (videoRef.value.paused) {
      console.log('[LiveVideo] 视频暂停中，尝试播放...')
      tryPlayVideo(videoRef.value)
    }
  }
}

const onPlay = () => {
  console.log('[LiveVideo] 视频开始播放')
  if (videoRef.value) {
    console.log('[LiveVideo] 播放状态 - paused:', videoRef.value.paused, 'ended:', videoRef.value.ended)
  }
}

const onError = (event: Event) => {
  console.error('[LiveVideo] 视频错误:', event)
  if (videoRef.value) {
    console.error('[LiveVideo] 视频错误详情:', videoRef.value.error)
  }
}

// 防止视频暂停
const onPause = () => {
  if (videoRef.value && !videoRef.value.ended) {
    console.log('[LiveVideo] 检测到暂停，自动恢复播放')
    videoRef.value.play().catch(err => {
      console.error('[LiveVideo] 自动恢复播放失败:', err)
    })
  }
}

onUnmounted(() => {
  isComponentMounted.value = false
  if (videoRef.value) {
    videoRef.value.srcObject = null
  }
})
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.live-video-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  overflow: hidden;
  display: block;
  visibility: visible;
  opacity: 1;
  z-index: 1;

  .video-element {
    width: 100% !important;
    height: 100% !important;
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
    position: relative;
    z-index: 1;
    object-fit: contain;
    background: #000;

    &.video-small {
      object-fit: cover;
    }
  }

  .video-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent);
    padding: 12px;
    color: white;
    z-index: 5;

    .video-info {
      display: flex;
      align-items: center;
      justify-content: space-between;

      .user-name {
        font-size: 14px;
        font-weight: 500;
      }

      .video-status {
        display: flex;
        gap: 8px;

        .el-icon {
          font-size: 18px;
          color: #f56c6c;
        }
      }
    }
  }

  // 禁用视频元素的右键菜单和默认控件
  .video-element {
    &::-webkit-media-controls {
      display: none !important;
    }

    &::-webkit-media-controls-enclosure {
      display: none !important;
    }

    // 禁用画中画按钮
    &::part(picture-in-picture-button) {
      display: none !important;
    }
  }
}
</style>


