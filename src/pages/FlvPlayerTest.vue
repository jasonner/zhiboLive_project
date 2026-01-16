<template>
  <div class="flv-player-test">
    <div class="player-container">
      <div class="player-header">
        <h2>FLV 播放器测试</h2>
        <div class="controls">
          <el-input
            v-model="streamUrl"
            placeholder="输入FLV流地址"
            style="width: 400px; margin-right: 10px;"
          />
          <el-button type="primary" @click="loadPlayer" :disabled="loading">
            {{ loading ? '加载中...' : '加载播放' }}
          </el-button>
          <el-button @click="destroyPlayer" :disabled="!player">停止播放</el-button>
        </div>
      </div>
      
      <div class="player-wrapper">
        <video
          ref="videoElement"
          class="flv-video"
          controls
          autoplay
          muted
        ></video>
        <div v-if="error" class="error-message">
          <el-alert
            :title="error"
            type="error"
            :closable="false"
            show-icon
          />
        </div>
        <div v-if="!player && !error" class="placeholder">
          <el-empty description="请输入FLV流地址并点击加载播放" />
        </div>
      </div>
      
      <div class="player-info" v-if="player">
        <el-descriptions title="播放器信息" :column="2" border>
          <el-descriptions-item label="流地址">{{ streamUrl }}</el-descriptions-item>
          <el-descriptions-item label="播放状态">
            <el-tag :type="isPlaying ? 'success' : 'info'">
              {{ isPlaying ? '播放中' : '已停止' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="缓冲状态">
            <el-tag :type="buffered > 0 ? 'success' : 'warning'">
              {{ buffered > 0 ? `已缓冲 ${buffered.toFixed(2)}s` : '缓冲中...' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="视频尺寸" v-if="videoWidth && videoHeight">
            {{ videoWidth }} x {{ videoHeight }}
          </el-descriptions-item>
        </el-descriptions>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
// @ts-ignore
import flvjs from 'flv.js'

const streamUrl = ref('http://192.168.0.12:8080/live/test.flv')
const videoElement = ref<HTMLVideoElement | null>(null)
const player = ref<any>(null)
const loading = ref(false)
const error = ref('')
const isPlaying = ref(false)
const buffered = ref(0)
const videoWidth = ref(0)
const videoHeight = ref(0)

const loadPlayer = async () => {
  if (!streamUrl.value) {
    error.value = '请输入FLV流地址'
    return
  }

  // 先销毁旧的播放器
  destroyPlayer()
  
  if (!videoElement.value) {
    error.value = '视频元素未找到'
    return
  }

  loading.value = true
  error.value = ''

  try {
    // 检查浏览器是否支持flv.js
    if (!flvjs.isSupported()) {
      throw new Error('当前浏览器不支持FLV播放，请使用Chrome、Firefox或Edge浏览器')
    }

    // 创建FLV播放器
    const flvPlayer = flvjs.createPlayer({
      type: 'flv',
      url: streamUrl.value,
      isLive: true, // 直播流
      hasAudio: true,
      hasVideo: true,
      enableWorker: false, // 禁用Worker，避免跨域问题
      enableStashBuffer: false, // 禁用缓冲，降低延迟
      stashInitialSize: 128,
      autoCleanupSourceBuffer: true
    }, {
      enableWorker: false,
      lazyLoad: false,
      lazyLoadMaxDuration: 3 * 60,
      lazyLoadRecoverDuration: 30,
      deferLoadAfterSourceOpen: false,
      autoCleanupSourceBuffer: true,
      statisticsInfoReportInterval: 1000
    })

    // 附加到video元素
    flvPlayer.attachMediaElement(videoElement.value)
    
    // 加载播放器
    flvPlayer.load()
    
    player.value = flvPlayer

    // 监听播放器事件
    flvPlayer.on(flvjs.Events.LOADING_COMPLETE, () => {
      console.log('[FLV Player] 加载完成')
      loading.value = false
    })

    flvPlayer.on(flvjs.Events.RECOVERED_EARLY_EOF, () => {
      console.log('[FLV Player] 恢复早期EOF')
    })

    flvPlayer.on(flvjs.Events.MEDIA_INFO, (info: any) => {
      console.log('[FLV Player] 媒体信息:', info)
      if (info.width && info.height) {
        videoWidth.value = info.width
        videoHeight.value = info.height
      }
    })

    flvPlayer.on(flvjs.Events.STATISTICS_INFO, (info: any) => {
      // 更新缓冲信息
      if (videoElement.value) {
        const bufferedRanges = videoElement.value.buffered
        if (bufferedRanges.length > 0) {
          const end = bufferedRanges.end(bufferedRanges.length - 1)
          const start = bufferedRanges.start(0)
          buffered.value = end - start
        }
      }
    })

    // 监听video元素事件
    if (videoElement.value) {
      videoElement.value.addEventListener('play', () => {
        isPlaying.value = true
        loading.value = false
      })

      videoElement.value.addEventListener('pause', () => {
        isPlaying.value = false
      })

      videoElement.value.addEventListener('loadedmetadata', () => {
        if (videoElement.value) {
          videoWidth.value = videoElement.value.videoWidth
          videoHeight.value = videoElement.value.videoHeight
        }
      })

      videoElement.value.addEventListener('error', (e) => {
        console.error('[FLV Player] 视频错误:', e)
        error.value = '视频播放出错，请检查流地址是否正确'
        loading.value = false
      })
    }

    // 尝试播放
    try {
      await videoElement.value.play()
      isPlaying.value = true
    } catch (err: any) {
      console.error('[FLV Player] 播放失败:', err)
      error.value = `播放失败: ${err.message || '未知错误'}`
    }

    loading.value = false
  } catch (err: any) {
    console.error('[FLV Player] 加载失败:', err)
    error.value = `加载失败: ${err.message || '未知错误'}`
    loading.value = false
  }
}

const destroyPlayer = () => {
  if (player.value) {
    try {
      player.value.pause()
      player.value.unload()
      player.value.detachMediaElement()
      player.value.destroy()
    } catch (err) {
      console.error('[FLV Player] 销毁播放器时出错:', err)
    }
    player.value = null
  }
  
  if (videoElement.value) {
    videoElement.value.srcObject = null
    videoElement.value.src = ''
  }
  
  isPlaying.value = false
  buffered.value = 0
  videoWidth.value = 0
  videoHeight.value = 0
  error.value = ''
}

onMounted(() => {
  console.log('[FLV Player] 组件已挂载')
  // 自动加载默认流
  // loadPlayer()
})

onUnmounted(() => {
  console.log('[FLV Player] 组件即将卸载，清理播放器')
  destroyPlayer()
})
</script>

<style scoped lang="scss">
.flv-player-test {
  width: 100%;
  height: 100vh;
  padding: 20px;
  background: #f5f5f5;
  overflow: auto;

  .player-container {
    max-width: 1400px;
    margin: 0 auto;
    background: white;
    border-radius: 8px;
    padding: 20px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);

    .player-header {
      margin-bottom: 20px;

      h2 {
        margin: 0 0 15px 0;
        color: #333;
      }

      .controls {
        display: flex;
        align-items: center;
      }
    }

    .player-wrapper {
      position: relative;
      width: 100%;
      background: #000;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 20px;
      min-height: 400px;
      display: flex;
      align-items: center;
      justify-content: center;

      .flv-video {
        width: 100%;
        height: auto;
        max-height: 70vh;
        display: block;
      }

      .error-message {
        position: absolute;
        top: 20px;
        left: 20px;
        right: 20px;
        z-index: 10;
      }

      .placeholder {
        width: 100%;
        height: 400px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
    }

    .player-info {
      margin-top: 20px;
    }
  }
}
</style>

