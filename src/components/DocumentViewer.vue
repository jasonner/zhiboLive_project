<template>
  <div class="document-viewer">
    <!-- 空状态 - 优先检查，如果没有文档或文档为空，直接显示空状态 -->
    <div v-if="!document || !document.url" class="empty-viewer">
      <el-empty description="暂无课件" :image-size="120" />
    </div>

    <!-- 所有资源都通过 iframe 显示 URL 页面 -->
    <div v-else class="web-viewer">
      <iframe
        :src="document.url"
        class="web-iframe"
        frameborder="0"
        allowfullscreen
        @load="handleIframeLoad"
        @error="handleIframeError"
      ></iframe>
      <div v-if="iframeError" class="iframe-error">
        <el-alert
          title="无法在课件区域显示此资源"
          type="warning"
          :closable="false"
          show-icon
        >
          <template #default>
            <p>该资源可能不支持在iframe中显示，请使用屏幕共享方式。</p>
            <el-button type="primary" size="small" @click="openInNewWindow">
              在新窗口打开并开启屏幕共享
            </el-button>
          </template>
        </el-alert>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { Document as DocumentType } from '@/store/liveStore'

interface Props {
  document?: DocumentType | null
}

const props = defineProps<Props>()

const iframeError = ref(false)

// iframe 加载成功
function handleIframeLoad() {
  iframeError.value = false
  console.log('[DocumentViewer] 资源页面加载成功:', props.document?.url)
}

// iframe 加载失败
function handleIframeError() {
  iframeError.value = true
  console.error('[DocumentViewer] 资源页面加载失败，可能不支持iframe嵌入:', props.document?.url)
}

// 在新窗口打开并提示开启屏幕共享
async function openInNewWindow() {
  if (!props.document?.url) return
  
  const newWindow = window.open(props.document.url, '_blank', 'width=1200,height=800')
  if (newWindow) {
    console.log('[DocumentViewer] 已在新窗口打开资源:', props.document.url)
    // 提示用户开启屏幕共享
    const { ElMessage } = await import('element-plus')
    ElMessage({
      message: '资源已在新窗口打开，请点击"屏幕共享"按钮进行推流',
      type: 'info',
      duration: 5000
    })
  } else {
    console.error('[DocumentViewer] 无法打开新窗口，可能被浏览器阻止')
    const { ElMessage } = await import('element-plus')
    ElMessage.error('无法打开新窗口，请检查浏览器弹窗设置')
  }
}
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.document-viewer {
  width: 100%;
  height: 100%;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;

  .web-viewer {
    width: 100%;
    height: 100%;
    position: relative;
    display: flex;
    flex-direction: column;

    .web-iframe {
      width: 100%;
      height: 100%;
      border: none;
      background: #fff;
    }

    .iframe-error {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 80%;
      max-width: 500px;
      z-index: 10;

      :deep(.el-alert) {
        .el-alert__content {
          .el-alert__description {
            margin-top: 12px;
            
            p {
              margin-bottom: 12px;
              color: $text-secondary;
            }
          }
        }
      }
    }
  }

  .empty-viewer {
    width: 100%;
    height: 100%;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    
    // 覆盖 el-empty 的默认背景图案
    :deep(.el-empty) {
      background: transparent !important;
      
      .el-empty__image {
        background: transparent !important;
      }
    }
  }
}
</style>


