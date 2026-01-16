<template>
  <div class="classroom-tools-panel">

    <!-- 投票功能 -->
    <div class="vote-section">
      <el-button
        type="primary"
        :icon="Plus"
        @click="handleVoteClick"
        style="width: 100%"
      >
        投票
      </el-button>
    </div>

    <!-- 当前投票 -->
    <!-- 学生端：只有在未投票且投票未结束时才显示投票内容；教师端：始终显示 -->
    <div class="vote-content" v-if="currentVote && (isTeacher || (!hasVotedCurrentVote && currentVote.isActive))">
      <div class="vote-header">
        <div class="vote-title">{{ currentVote.title }}</div>
        <div class="vote-content-text" v-if="currentVote.content">{{ currentVote.content }}</div>
      </div>

      <div class="vote-options" v-if="!isTeacher">
        <div v-if="hasVotedCurrentVote" style="margin-bottom: 16px; padding: 12px; background: #f0f9ff; border: 1px solid #b3d8ff; border-radius: 4px; color: #409eff; font-size: 14px;">
          <el-icon><Check /></el-icon>
          <span style="margin-left: 8px;">您已经投过票了</span>
        </div>
        <div v-if="!currentVote.isActive" style="margin-bottom: 16px; padding: 12px; background: #fff7e6; border: 1px solid #ffd591; border-radius: 4px; color: #fa8c16; font-size: 14px;">
          <el-icon><Check /></el-icon>
          <span style="margin-left: 8px;">投票已结束</span>
        </div>
        <el-radio-group
          v-model="selectedVoteOption"
          @change="handleVoteChange"
          :disabled="hasVotedCurrentVote || !currentVote.isActive"
        >
          <el-radio
            v-for="(option, index) in currentVote.options"
            :key="index"
            :label="index"
            class="option-item"
          >
            {{ index + 1 }}. {{ option }}
          </el-radio>
        </el-radio-group>
        <el-button
          v-if="!hasVotedCurrentVote && currentVote.isActive"
          type="primary"
          @click="handleSubmitVote"
          :disabled="selectedVoteOption === null"
          style="width: 100%; margin-top: 16px"
        >
          提交投票
        </el-button>
      </div>

      <div class="vote-results" v-if="isTeacher && currentVote.statistics">
        <div class="result-item" v-for="(result, index) in voteResults" :key="index">
          <div class="result-label">
            {{ index + 1 }}. {{ result.option }}
          </div>
          <div class="result-bar">
            <div class="result-bar-fill" :style="{ width: result.percentage + '%' }"></div>
            <span class="result-percentage">{{ result.percentage }}%</span>
          </div>
        </div>
        <div class="vote-statistics">
          <span>参与人数：{{ currentVote.statistics.total }}</span>
        </div>
        <el-button
          type="danger"
          @click="handleFinishVote"
          style="width: 100%; margin-top: 16px"
        >
          结束投票
        </el-button>
      </div>
    </div>

    <!-- 投票列表弹窗 -->
    <el-dialog
      v-model="showVoteListDialog"
      title="投票列表"
      width="600px"
    >
      <div class="vote-list">
        <div
          v-for="(vote, index) in votes"
          :key="vote.id"
          class="vote-list-item"
        >
          <div class="vote-list-title">{{ index + 1 }}. {{ vote.title }}</div>
          <el-button
            type="primary"
            text
            @click="handleViewVoteDetail(vote.id)"
          >
            查看详情
          </el-button>
        </div>
        <div v-if="votes.length === 0" class="empty-vote-list">
          暂无投票记录
        </div>
      </div>
      <template #footer>
        <el-button
          v-if="isTeacher"
          type="primary"
          @click="showCreateVoteDialog = true"
        >
          发起投票
        </el-button>
        <el-button @click="showVoteListDialog = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 投票详情弹窗 -->
    <el-dialog
      v-model="showVoteDetailDialog"
      title="投票详情"
      width="600px"
    >
      <div v-if="selectedVote" class="vote-detail">
        <div class="detail-title">{{ selectedVote.title }}</div>
        <div class="detail-content" v-if="selectedVote.content">{{ selectedVote.content }}</div>
        <div class="detail-results">
          <div
            v-for="(result, index) in selectedVoteResults"
            :key="result.optionIndex === -1 ? 'abstain' : result.optionIndex"
            class="result-item"
          >
            <div class="result-label">
              <template v-if="result.optionIndex === -1">
                {{ result.option }}
              </template>
              <template v-else>
                {{ index + 1 }}. {{ result.option }}
              </template>
            </div>
            <div class="result-bar">
              <div class="result-bar-fill" :style="{ width: result.percentage + '%' }"></div>
              <span class="result-percentage">{{ result.percentage }}%</span>
            </div>
          </div>
        </div>
        <div class="detail-statistics">
          参与人数：{{ selectedVote.statistics?.total || 0 }}
        </div>
      </div>
      <template #footer>
        <el-button @click="showVoteDetailDialog = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 创建投票对话框 -->
    <el-dialog
      v-model="showCreateVoteDialog"
      title="发起投票"
      width="600px"
      @close="handleCloseCreateDialog"
    >
      <el-form :model="voteForm" label-width="80px">
        <el-form-item label="投票标题">
          <el-input
            v-model="voteForm.title"
            placeholder="请输入投票标题"
          />
        </el-form-item>
        <el-form-item label="投票内容">
          <el-input
            v-model="voteForm.content"
            type="textarea"
            :rows="3"
            placeholder="请输入投票内容（可选）"
          />
        </el-form-item>
        <el-form-item label="投票时长">
          <el-select v-model="voteForm.duration" placeholder="请选择投票时长">
            <el-option label="10秒" :value="10" />
            <el-option label="30秒" :value="30" />
            <el-option label="1分钟" :value="60" />
            <el-option label="2分钟" :value="120" />
            <el-option label="5分钟" :value="300" />
            <el-option label="10分钟" :value="600" />
          </el-select>
        </el-form-item>
        <el-form-item label="选项">
          <div
            v-for="(option, index) in voteForm.options"
            :key="index"
            class="option-input"
          >
            <el-input
              v-model="voteForm.options[index]"
              :placeholder="`选项 ${index + 1}`"
            />
            <el-button
              v-if="voteForm.options.length > 2"
              type="danger"
              :icon="Delete"
              circle
              @click="removeOption(index)"
            />
          </div>
          <el-button
            type="primary"
            text
            @click="addOption"
            v-if="voteForm.options.length < 10"
            style="margin-top: 8px"
          >
            + 添加选项
          </el-button>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="handleCloseCreateDialog">取消</el-button>
        <el-button type="primary" @click="handleCreateVote">发布</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, onUnmounted, type Ref } from 'vue'
import { Plus, Delete, Check } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useLiveStore } from '@/store/liveStore'
import type { Vote } from '@/store/liveStore'
import type { SignalService } from '@/utils/signal'

interface Props {
  isTeacher?: boolean
  currentUserId?: string
}

const props = withDefaults(defineProps<Props>(), {
  isTeacher: false,
  currentUserId: 'student-001'
})

const store = useLiveStore()
// 从父组件注入 signalService
const signalServiceRef = inject<Ref<SignalService | null>>('signalService', ref(null))
const signalService = computed(() => signalServiceRef.value)

const votes = computed(() => store.votes)
const currentVote = computed(() => store.currentVote)

const showVoteListDialog = ref(false)
const showVoteDetailDialog = ref(false)
const showCreateVoteDialog = ref(false)
const selectedVote = ref<Vote | null>(null)
const selectedVoteOption = ref<number | null>(null)

// 投票定时器引用
const voteTimer = ref<number | null>(null)

const voteForm = ref({
  title: '',
  content: '',
  duration: 60,
  options: ['', '']
})

const voteResults = computed(() => {
  if (!currentVote.value) return []
  return store.getVoteResults(currentVote.value.id)
})

const selectedVoteResults = computed(() => {
  if (!selectedVote.value) return []
  return store.getVoteResults(selectedVote.value.id)
})

// 检查当前用户是否已投票
const hasVotedCurrentVote = computed(() => {
  if (!currentVote.value || !props.currentUserId) return false
  return store.hasUserVoted(currentVote.value.id, props.currentUserId)
})

function addOption() {
  if (voteForm.value.options.length < 10) {
    voteForm.value.options.push('')
  }
}

function removeOption(index: number) {
  if (voteForm.value.options.length > 2) {
    voteForm.value.options.splice(index, 1)
  }
}

function handleVoteClick() {
  // 检查直播状态
  if (!store.isLive) {
    ElMessage.warning('请先开启直播')
    return
  }
  showVoteListDialog.value = true
}

function handleCreateVote() {
  // 检查直播状态
  if (!store.isLive) {
    ElMessage.warning('请先开启直播')
    return
  }
  
  if (!voteForm.value.title.trim()) {
    return
  }
  
  if (voteForm.value.options.filter(opt => opt.trim()).length < 2) {
    return
  }

  // 清除之前的定时器（如果有）
  if (voteTimer.value !== null) {
    clearTimeout(voteTimer.value)
    voteTimer.value = null
  }

  const vote: Vote = {
    id: Date.now().toString(),
    title: voteForm.value.title,
    content: voteForm.value.content,
    duration: voteForm.value.duration,
    options: voteForm.value.options.filter(opt => opt.trim()),
    isActive: true,
    createdAt: Date.now()
  }

  store.createVote(vote)
  showCreateVoteDialog.value = false
  showVoteListDialog.value = false

  // 重置表单
  voteForm.value = {
    title: '',
    content: '',
    duration: 60,
    options: ['', '']
  }

  // 通过 WebSocket 发送投票（使用后端 startVote 事件）
  const service = signalService.value
  if (service && props.isTeacher) {
    const classroomId = service.currentClassroomId || 1
    const voteData = {
      voteId: vote.id,
      title: vote.title,
      content: vote.content,
      duration: vote.duration,
      options: vote.options,
      createdAt: vote.createdAt
    }
    console.log('[ClassroomToolsPanel] 📤 发送投票:', voteData)
    service.startVote(classroomId, voteData)
  } else if (!service) {
    console.warn('[ClassroomToolsPanel] ⚠️ signalService 不可用，无法发送投票')
  }

  // 设置投票超时定时器（仅教师端）
  if (props.isTeacher && vote.duration > 0) {
    const durationMs = vote.duration * 1000 // 转换为毫秒
    console.log(`[ClassroomToolsPanel] ⏰ 设置投票定时器: ${vote.duration}秒后自动结束`)
    voteTimer.value = window.setTimeout(() => {
      // 检查投票是否仍然活跃
      const currentVoteInStore = store.currentVote
      if (currentVoteInStore && currentVoteInStore.id === vote.id && currentVoteInStore.isActive) {
        console.log(`[ClassroomToolsPanel] ⏰ 投票时长已到，自动结束投票: ${vote.id}`)
        handleFinishVote()
      }
      voteTimer.value = null
    }, durationMs)
  }
}

function handleCloseCreateDialog() {
  showCreateVoteDialog.value = false
  // 重置表单
  voteForm.value = {
    title: '',
    content: '',
    duration: 60,
    options: ['', '']
  }
}

function handleVoteChange() {
  // 实时保存选择（可选）
}

function handleSubmitVote() {
  if (!currentVote.value || selectedVoteOption.value === null) return

  // 检查是否已投票
  if (props.currentUserId && store.hasUserVoted(currentVote.value.id, props.currentUserId)) {
    console.warn('[ClassroomToolsPanel] ⚠️ 您已经投过票了，不能重复投票')
    return
  }

  const userId = props.currentUserId?.toString()
  const voteId = currentVote.value.id
  store.submitVote(voteId, selectedVoteOption.value, userId)
  
  // 通过 WebSocket 提交投票（使用后端 sendVote 事件）
  const service = signalService.value
  if (service && !props.isTeacher) {
    const classroomId = service.currentClassroomId || 1
    const voteData = {
      voteId: voteId,
      userId: props.currentUserId,
      option: selectedVoteOption.value,
      timestamp: Date.now()
    }
    console.log('[ClassroomToolsPanel] 📤 提交投票:', voteData)
    service.sendVote(classroomId, voteData)
    
    // 学生端投票后，清除 currentVote，不再显示投票内容
    if (store.currentVote && store.currentVote.id === voteId) {
      store.currentVote = null
      console.log('[ClassroomToolsPanel] ✅ 学生端已投票，已清除投票信息')
    }
  }
  
  selectedVoteOption.value = null
}

function handleFinishVote() {
  if (!currentVote.value) return
  
  // 先保存 voteId，因为 store.finishVote 会将 currentVote 设置为 null
  const voteId = currentVote.value.id
  
  // 清除投票定时器
  if (voteTimer.value !== null) {
    clearTimeout(voteTimer.value)
    voteTimer.value = null
  }
  
  store.finishVote(voteId)
  
  // 通过 WebSocket 结束投票（注意：后端没有直接的结束投票事件，可能需要通过其他方式）
  // 如果后端需要，可以使用 sendClassroomMsg 或其他事件
  const service = signalService.value
  if (service && props.isTeacher) {
    const classroomId = service.currentClassroomId || 1
    const finishData = {
      voteId: voteId,
      action: 'finish',
      timestamp: Date.now()
    }
    console.log('[ClassroomToolsPanel] 📤 结束投票:', finishData)
    // 注意：这里可能需要根据后端实际需求调整事件类型
    service.sendClassroomMsg(classroomId, finishData)
  }
  
  selectedVoteOption.value = null
}

function handleViewVoteDetail(voteId: string) {
  const vote = votes.value.find(v => v.id === voteId)
  if (vote) {
    selectedVote.value = vote
    showVoteDetailDialog.value = true
  }
}

// 组件销毁时清理定时器
onUnmounted(() => {
  if (voteTimer.value !== null) {
    clearTimeout(voteTimer.value)
    voteTimer.value = null
  }
})
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.classroom-tools-panel {
  background: $bg-color;
  border-top: 1px solid $border-color;
  height: 100%;
  display: flex;
  flex-direction: column;

  .panel-header {
    padding: 12px 16px;
    border-bottom: 1px solid $border-color;

    .title {
      font-size: 14px;
      font-weight: 500;
      color: $text-primary;
    }
  }

  .vote-section {
    padding: 16px;
  }

  .vote-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;

    .vote-header {
      margin-bottom: 16px;

      .vote-title {
        font-size: 16px;
        color: $text-primary;
        font-weight: 500;
        line-height: 1.5;
        margin-bottom: 8px;
      }

      .vote-content-text {
        font-size: 14px;
        color: $text-secondary;
        line-height: 1.5;
      }
    }

    .vote-options {
      flex: 1;
      margin-bottom: 16px;

      .option-item {
        display: block;
        margin-bottom: 12px;
        font-size: 14px;
        color: $text-primary;
      }
    }

    .vote-results {
      flex: 1;
      margin-bottom: 16px;

      .result-item {
        margin-bottom: 16px;

        .result-label {
          font-size: 14px;
          color: $text-primary;
          margin-bottom: 8px;
        }

        .result-bar {
          position: relative;
          height: 32px;
          background: #f0f0f0;
          border-radius: 4px;
          overflow: hidden;

          .result-bar-fill {
            height: 100%;
            background: $primary-color;
            transition: width 0.3s;
          }

          .result-percentage {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 14px;
            color: $text-primary;
            font-weight: 500;
          }
        }
      }

      .vote-statistics {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid $border-color;
        font-size: 14px;
        color: $text-primary;
      }
    }
  }

  .vote-list {
    max-height: 400px;
    overflow-y: auto;

    .vote-list-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid $border-color;

      .vote-list-title {
        flex: 1;
        font-size: 14px;
        color: $text-primary;
      }
    }

    .empty-vote-list {
      text-align: center;
      padding: 40px 0;
      color: $text-secondary;
      font-size: 14px;
    }
  }

  .vote-detail {
    .detail-title {
      font-size: 18px;
      font-weight: 500;
      color: $text-primary;
      margin-bottom: 12px;
    }

    .detail-content {
      font-size: 14px;
      color: $text-secondary;
      margin-bottom: 24px;
      line-height: 1.5;
    }

    .detail-results {
      margin-bottom: 16px;

      .result-item {
        margin-bottom: 16px;

        .result-label {
          font-size: 14px;
          color: $text-primary;
          margin-bottom: 8px;
        }

        .result-bar {
          position: relative;
          height: 32px;
          background: #f0f0f0;
          border-radius: 4px;
          overflow: hidden;

          .result-bar-fill {
            height: 100%;
            background: $primary-color;
            transition: width 0.3s;
          }

          .result-percentage {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 14px;
            color: $text-primary;
            font-weight: 500;
          }
        }
      }
    }

    .detail-statistics {
      padding-top: 16px;
      border-top: 1px solid $border-color;
      font-size: 14px;
      color: $text-primary;
    }
  }

  .option-input {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
    align-items: center;
  }
}
</style>
