<template>
  <div class="media-whiteboard-toolbar">
    <!-- 媒体控制区域 -->
    <div class="toolbar-section media-controls">
      <div class="section-label">媒体控制</div>
      <div class="button-group">
        <el-button
          :type="cameraEnabled ? 'primary' : 'default'"
          :icon="VideoCamera"
          circle
          size="large"
          @click="toggleCamera"
          class="control-button"
        >
          <span class="button-label">摄像头</span>
        </el-button>
        <el-button
          :type="microphoneEnabled ? 'primary' : 'default'"
          :icon="Microphone"
          circle
          size="large"
          @click="toggleMicrophone"
          class="control-button"
        >
          <span class="button-label">麦克风</span>
        </el-button>
        <el-button
          :type="screenSharing ? 'success' : 'default'"
          :icon="Monitor"
          circle
          size="large"
          @click="toggleScreenShare"
          class="control-button"
        >
          <span class="button-label">屏幕共享</span>
        </el-button>
      </div>
    </div>

    <!-- 分隔线 -->
    <div class="divider"></div>

    <!-- 白板工具区域 -->
    <div class="toolbar-section whiteboard-tools">
      <div class="section-label">白板工具</div>
      <div class="button-group">
        <el-button
          :type="whiteboardEnabled ? 'primary' : 'default'"
          :icon="EditPen"
          circle
          size="large"
          @click="toggleWhiteboard"
          class="control-button"
        >
          <span class="button-label">白板</span>
        </el-button>
        <el-button
          :icon="Delete"
          circle
          size="large"
          @click="clearWhiteboard"
          :disabled="!whiteboardEnabled"
          class="control-button"
        >
          <span class="button-label">清除</span>
        </el-button>
      </div>
      <!-- 白板工具选项 -->
      <div v-if="whiteboardEnabled" class="whiteboard-options">
        <el-button-group>
          <el-button 
            size="small" 
            :type="currentTool === 'pen' ? 'primary' : 'default'"
            @click="selectTool('pen')"
          >
            画笔
          </el-button>
          <el-button 
            size="small" 
            :type="currentTool === 'line' ? 'primary' : 'default'"
            @click="selectTool('line')"
          >
            直线
          </el-button>
          <el-button 
            size="small" 
            :type="currentTool === 'rect' ? 'primary' : 'default'"
            @click="selectTool('rect')"
          >
            矩形
          </el-button>
          <el-button 
            size="small" 
            :type="currentTool === 'circle' ? 'primary' : 'default'"
            @click="selectTool('circle')"
          >
            圆形
          </el-button>
          <el-button 
            size="small" 
            :type="currentTool === 'text' ? 'primary' : 'default'"
            @click="selectTool('text')"
          >
            文字
          </el-button>
        </el-button-group>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { VideoCamera, Microphone, Monitor, EditPen, Delete } from '@element-plus/icons-vue'
import { useLiveStore } from '@/store/liveStore'

const store = useLiveStore()

const cameraEnabled = computed(() => store.cameraEnabled)
const microphoneEnabled = computed(() => store.microphoneEnabled)
const screenSharing = computed(() => store.screenSharing)
const whiteboardEnabled = computed(() => store.whiteboardEnabled)

const currentTool = ref('pen')

const emit = defineEmits<{
  toggleCamera: []
  toggleMicrophone: []
  toggleScreenShare: []
  toggleWhiteboard: []
  clearWhiteboard: []
  selectTool: [tool: string]
}>()

function toggleCamera() {
  store.cameraEnabled = !store.cameraEnabled
  emit('toggleCamera')
}

function toggleMicrophone() {
  store.microphoneEnabled = !store.microphoneEnabled
  emit('toggleMicrophone')
}

function toggleScreenShare() {
  // 不在这里切换状态，让父组件的 handleToggleScreenShare 来管理状态
  emit('toggleScreenShare')
}

function toggleWhiteboard() {
  store.whiteboardEnabled = !store.whiteboardEnabled
  store.setDisplayMode(store.whiteboardEnabled ? 'whiteboard' : 'document')
  emit('toggleWhiteboard')
}

function clearWhiteboard() {
  emit('clearWhiteboard')
}

function selectTool(tool: string) {
  currentTool.value = tool
  emit('selectTool', tool)
}
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.media-whiteboard-toolbar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 16px 24px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.85) 0%, rgba(0, 0, 0, 0.75) 100%);
  backdrop-filter: blur(10px);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 100;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.3);

  .toolbar-section {
    display: flex;
    align-items: center;
    gap: 16px;

    .section-label {
      font-size: 13px;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.7);
      white-space: nowrap;
      min-width: 60px;
    }

    .button-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .control-button {
      position: relative;
      transition: all 0.3s ease;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 0 !important;
      margin: 0 !important;
      
      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(64, 158, 255, 0.4);
        
        .button-label {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
          pointer-events: auto;
        }
      }
      
      // 确保图标在按钮中居中且可见
      :deep(.el-icon) {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        margin: 0 !important;
        padding: 0 !important;
        line-height: 1 !important;
        vertical-align: middle !important;
        font-size: 20px !important;
      }
      
      :deep(.el-icon svg) {
        display: block !important;
        width: 1em !important;
        height: 1em !important;
        fill: currentColor !important;
      }
      
      // 确保按钮内容居中，但不影响图标显示
      :deep(> span) {
        margin: 0 !important;
        padding: 0 !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        line-height: 1 !important;
      }

      .button-label {
        position: absolute;
        top: -40px;
        left: 50%;
        transform: translateX(-50%) translateY(5px);
        font-size: 12px;
        font-weight: 500;
        color: #fff;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transition: all 0.3s ease;
        background: rgba(0, 0, 0, 0.8);
        padding: 6px 12px;
        border-radius: 6px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        
        // 小箭头
        &::after {
          content: '';
          position: absolute;
          bottom: -4px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 4px solid transparent;
          border-right: 4px solid transparent;
          border-top: 4px solid rgba(0, 0, 0, 0.8);
        }
      }
    }
  }

  .divider {
    width: 1px;
    height: 40px;
    background: rgba(255, 255, 255, 0.2);
  }

  .whiteboard-tools {
    .whiteboard-options {
      margin-left: 8px;
      padding-left: 16px;
      border-left: 1px solid rgba(255, 255, 255, 0.1);
    }
  }

  // 响应式设计
  @media (max-width: 1200px) {
    gap: 16px;
    padding: 12px 16px;

    .toolbar-section {
      gap: 12px;

      .section-label {
        font-size: 12px;
        min-width: 50px;
      }

      .button-group {
        gap: 8px;
      }

      .control-button {
        :deep(.el-icon) {
          font-size: 18px;
        }

        .button-label {
          font-size: 11px;
          top: -36px;
          padding: 5px 10px;
        }
      }
    }

    .whiteboard-options {
      :deep(.el-button) {
        padding: 6px 12px;
        font-size: 12px;
      }
    }
  }
}

// 深色主题适配
:deep(.el-button) {
  &.is-circle {
    width: 48px !important;
    height: 48px !important;
    min-width: 48px !important;
    padding: 0 !important;
    margin: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    line-height: 1 !important;
    
    @media (max-width: 1200px) {
      width: 42px !important;
      height: 42px !important;
      min-width: 42px !important;
    }
    
    // 确保图标居中且可见
    > .el-icon,
    > span > .el-icon {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      margin: 0 !important;
      padding: 0 !important;
      line-height: 1 !important;
      vertical-align: middle !important;
      font-size: 20px !important;
      width: auto !important;
      height: auto !important;
    }
    
    > .el-icon svg,
    > span > .el-icon svg {
      display: block !important;
      width: 1em !important;
      height: 1em !important;
      fill: currentColor !important;
    }
    
    // 移除按钮内部的任何间距
    > * {
      margin: 0 !important;
      padding: 0 !important;
    }
  }

  &.el-button--large {
    font-size: 20px;
  }

  &.is-primary {
    background: linear-gradient(135deg, #409eff 0%, #66b1ff 100%);
    border: none;
    
    &:hover {
      background: linear-gradient(135deg, #66b1ff 0%, #409eff 100%);
    }
  }

  &.is-success {
    background: linear-gradient(135deg, #67c23a 0%, #85ce61 100%);
    border: none;
    
    &:hover {
      background: linear-gradient(135deg, #85ce61 0%, #67c23a 100%);
    }
  }

  &.is-default {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.9);
    
    &:hover {
      background: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.3);
      color: #fff;
    }

    &.is-disabled {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.3);
    }
  }
}

:deep(.el-button-group) {
  .el-button {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.9);
    
    &:hover {
      background: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.3);
      color: #fff;
    }

    &.is-primary {
      background: linear-gradient(135deg, #409eff 0%, #66b1ff 100%);
      border-color: transparent;
      color: #fff;
    }
  }
}
</style>

