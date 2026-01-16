<template>
  <div class="tool-bar">
    <div class="tool-section">
      <div class="section-title">课件管理</div>
      <el-button
        type="primary"
        :icon="FolderOpened"
        @click="showDocumentDialog = true"
        style="width: 100%"
      >
        上传课件
      </el-button>
    </div>

    <!-- 课件上传对话框 -->
    <el-dialog
      v-model="showDocumentDialog"
      title="上传课件"
      width="500px"
    >
      <el-upload
        class="upload-demo"
        drag
        :auto-upload="false"
        :on-change="handleFileChange"
        multiple
      >
        <el-icon class="el-icon--upload"><Upload /></el-icon>
        <div class="el-upload__text">
          将文件拖到此处，或<em>点击上传</em>
        </div>
        <template #tip>
          <div class="el-upload__tip">
            支持 PPT、PDF、图片、音视频文件
          </div>
        </template>
      </el-upload>
      <template #footer>
        <el-button @click="showDocumentDialog = false">取消</el-button>
        <el-button type="primary" @click="handleUpload">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { FolderOpened, Upload } from '@element-plus/icons-vue'
import type { UploadFile } from 'element-plus'

const showDocumentDialog = ref(false)
const selectedFiles = ref<UploadFile[]>([])

const emit = defineEmits<{
  uploadDocuments: [files: File[]]
}>()

function handleFileChange(file: UploadFile) {
  selectedFiles.value.push(file)
}

function handleUpload() {
  const files = selectedFiles.value
    .map(f => f.raw)
    .filter((f): f is File => f !== undefined)
  
  if (files.length > 0) {
    emit('uploadDocuments', files)
    showDocumentDialog.value = false
    selectedFiles.value = []
  }
}
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.tool-bar {
  padding: 16px;
  background: $bg-color;
  border-right: 1px solid $border-color;
  height: 100%;
  overflow-y: auto;

  .tool-section {
    margin-bottom: 24px;

    .section-title {
      font-size: 14px;
      font-weight: 500;
      color: $text-primary;
      margin-bottom: 12px;
    }

    .tool-buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .whiteboard-tools {
      margin-top: 12px;
    }
  }
}
</style>

