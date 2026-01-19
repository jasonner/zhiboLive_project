<template>
  <div class="video-area">
    <div class="main-display" ref="mainDisplayRef">
      <!-- 白板模式 -->
      <div v-if="displayMode === 'whiteboard'" class="display-container">
        <Whiteboard ref="whiteboardRef" :is-teacher="false" />
      </div>

      <!-- 屏幕共享模式 -->
      <div v-else-if="displayMode === 'screen'" class="display-container">
        <LiveVideo :stream="screenStream" :is-small="false" />
        <!-- 隐藏的音频播放器，用于播放摄像头流的音频（如果屏幕共享流没有音频） -->
        <LiveVideo
          v-if="teacherStream && teacherStream.getAudioTracks().length > 0 && (!screenStream || screenStream.getAudioTracks().length === 0)"
          :stream="teacherStream" :is-small="false"
          style="position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; z-index: -1;" />
        <div v-if="!screenStream" class="video-placeholder-overlay">
          <el-icon>
            <VideoCamera />
          </el-icon>
          <p>等待老师开启屏幕共享</p>
        </div>
      </div>

      <!-- 文档/视频模式 -->
      <div v-else class="document-video-container">
        <DocumentViewer :document="currentDocument" />
      </div>

      <!-- 弹幕组件 -->
      <Danmaku :messages="chatMessages" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { VideoCamera } from '@element-plus/icons-vue'
import { useLiveStore, type Document } from '@/store/liveStore'
import LiveVideo from '@/components/LiveVideo.vue'
import DocumentViewer from '@/components/DocumentViewer.vue'
import Whiteboard from '@/components/Whiteboard.vue'
import Danmaku from '@/components/Danmaku.vue'

interface Props {
  displayMode?: 'whiteboard' | 'screen' | 'document' | 'video'
  currentDocument?: Document | null
  teacherStream?: MediaStream | null
  screenStream?: MediaStream | null
  chatMessages?: any[]
}

const props = withDefaults(defineProps<Props>(), {
  displayMode: 'document',
  currentDocument: null,
  teacherStream: null,
  screenStream: null,
  chatMessages: () => []
})

const store = useLiveStore()
const mainDisplayRef = ref<HTMLElement | null>(null)
const whiteboardRef = ref<InstanceType<typeof Whiteboard> | null>(null)

// 使用 props 或 store 的值
const displayMode = computed(() => props.displayMode || store.displayMode)
const currentDocument = computed(() => props.currentDocument || store.currentDocument)
const teacherStream = computed(() => props.teacherStream || store.teacherStream)
const screenStream = computed(() => props.screenStream || store.screenStream)
const chatMessages = computed(() => props.chatMessages.length > 0 ? props.chatMessages : store.chatMessages)

defineExpose({
  mainDisplayRef,
  whiteboardRef
})
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.video-area {
  width: 100%;
  height: 100%;
  position: relative;

  .main-display {
    width: 100%;
    height: 100%;
    position: relative;
    background: #000;
    overflow: hidden;

    .display-container {
      width: 100%;
      height: 100%;
      position: relative;
    }

    .document-video-container {
      width: 100%;
      height: 100%;
      position: relative;
    }

    .video-placeholder-overlay {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      color: #999;
      z-index: 10;

      .el-icon {
        font-size: 48px;
        margin-bottom: 16px;
        display: block;
      }

      p {
        font-size: 16px;
        margin: 0;
      }
    }
  }
}
</style>
