<template>
  <div class="document-list">
    <div class="list-header">
      <span class="title">课件列表</span>
      <span class="count">({{ documents.length }})</span>
    </div>

    <div class="list-content">
      <div
        v-for="doc in documents"
        :key="doc.id"
        class="document-item"
        :class="{ active: currentDocument?.id === doc.id }"
        @click="handleSwitchDocument(doc.id)"
      >
        <div class="doc-icon">
          <el-icon v-if="doc.type === 'ppt'"><Document /></el-icon>
          <el-icon v-else-if="doc.type === 'pdf'"><Document /></el-icon>
          <el-icon v-else-if="doc.type === 'image'"><Picture /></el-icon>
          <el-icon v-else-if="doc.type === 'video'"><VideoPlay /></el-icon>
          <el-icon v-else><Headset /></el-icon>
        </div>
        <div class="doc-info">
          <div class="doc-name" :title="doc.name">{{ doc.name }}</div>
          <div class="doc-type">{{ getTypeText(doc.type) }}</div>
        </div>
      </div>

      <el-empty
        v-if="documents.length === 0"
        description="暂无课件"
        :image-size="80"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { Document, Picture, VideoPlay, Headset } from '@element-plus/icons-vue'
import { useLiveStore } from '@/store/liveStore'
import type { Document as DocumentType } from '@/store/liveStore'
import type { SignalService } from '@/utils/signal'

const store = useLiveStore()

// 从父组件注入 signalService（仅在教师端需要）
const signalService = inject<SignalService | null>('signalService', null)

const documents = computed(() => store.documents)
const currentDocument = computed(() => store.currentDocument)

function getTypeText(type: DocumentType['type']): string {
  const typeMap = {
    ppt: 'PPT',
    pdf: 'PDF',
    image: '图片',
    video: '视频',
    audio: '音频'
  }
  return typeMap[type] || '未知'
}

function handleSwitchDocument(docId: string) {
  // 更新本地 store
  store.switchDocument(docId)
  
  // 如果是教师端，通过 WebSocket 通知学生端
  if (signalService) {
    const doc = store.documents.find(d => d.id === docId)
    if (doc) {
      // 发送完整的文档信息
      console.log('[DocumentList] 切换文档，准备通知学生端:', {
        docId,
        docName: doc.name,
        docType: doc.type,
        docUrl: doc.url,
        signalServiceConnected: signalService.isConnected
      })
      signalService.switchDocument(docId, doc)
      console.log('[DocumentList] 已发送文档切换事件到服务器')
    } else {
      console.warn('[DocumentList] 未找到文档:', docId)
    }
  } else {
    console.log('[DocumentList] signalService 不可用（可能是学生端）')
  }
}
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.document-list {
  background: $bg-color;
  border-top: 1px solid $border-color;
  height: 100%;
  display: flex;
  flex-direction: column;

  .list-header {
    padding: 12px 16px;
    border-bottom: 1px solid $border-color;
    display: flex;
    align-items: center;
    gap: 8px;

    .title {
      font-size: 14px;
      font-weight: 500;
      color: $text-primary;
    }

    .count {
      font-size: 12px;
      color: $text-secondary;
    }
  }

  .list-content {
    flex: 1;
    overflow-y: auto;
    padding: 8px;

    .document-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      margin-bottom: 8px;

      &:hover {
        background: $secondary-color;
      }

      &.active {
        background: $secondary-color;
        border: 1px solid $primary-color;
      }

      .doc-icon {
        font-size: 24px;
        color: $primary-color;
      }

      .doc-info {
        flex: 1;
        min-width: 0;

        .doc-name {
          font-size: 14px;
          color: $text-primary;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .doc-type {
          font-size: 12px;
          color: $text-secondary;
          margin-top: 4px;
        }
      }
    }
  }
}
</style>



