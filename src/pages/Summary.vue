<template>
  <div class="summary-page">
    <div class="summary-container">
      <div class="summary-header">
        <h1>直播总结</h1>
        <p class="course-name">{{ courseName }}</p>
      </div>

      <div class="summary-content">
        <!-- 基础统计 -->
        <el-row :gutter="20" class="stats-row">
          <el-col :span="6">
            <div class="stat-card">
              <div class="stat-icon">
                <el-icon><Timer /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-value">{{ formatTime }}</div>
                <div class="stat-label">直播时长</div>
              </div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="stat-card">
              <div class="stat-icon">
                <el-icon><User /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-value">{{ averageOnlineCount }}</div>
                <div class="stat-label">平均在线人数</div>
              </div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="stat-card">
              <div class="stat-icon">
                <el-icon><ChatLineRound /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-value">{{ chatMessages.length }}</div>
                <div class="stat-label">聊天消息数</div>
              </div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="stat-card">
              <div class="stat-icon">
                <el-icon><Trophy /></el-icon>
              </div>
              <div class="stat-info">
                <div class="stat-value">{{ quizHistory.length }}</div>
                <div class="stat-label">互动题数量</div>
              </div>
            </div>
          </el-col>
        </el-row>

        <!-- 互动题报告 -->
        <div class="quiz-report" v-if="quizHistory.length > 0">
          <h2>互动题报告</h2>
          <el-table :data="quizHistory" style="width: 100%">
            <el-table-column prop="question" label="题目" min-width="200" />
            <el-table-column prop="type" label="类型" width="100">
              <template #default="{ row }">
                <el-tag v-if="row.type === 'single'">单选题</el-tag>
                <el-tag v-else-if="row.type === 'multiple'">多选题</el-tag>
                <el-tag v-else>判断题</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="参与人数" width="100">
              <template #default="{ row }">
                {{ row.statistics?.total || 0 }}
              </template>
            </el-table-column>
            <el-table-column label="正确率" width="100">
              <template #default="{ row }">
                {{ getCorrectRate(row) }}%
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- 回放生成 -->
        <div class="replay-section">
          <h2>回放生成</h2>
          <div class="replay-status">
            <el-progress
              :percentage="replayProgress"
              :status="replayStatus"
            />
            <p v-if="replayStatus === 'success'">
              回放已生成，<el-button type="primary" text>点击查看</el-button>
            </p>
            <p v-else-if="replayStatus === 'exception'">
              回放生成失败，<el-button type="primary" text>重新生成</el-button>
            </p>
            <p v-else>正在生成回放...</p>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="action-buttons">
          <el-button @click="handleBack">返回首页</el-button>
          <el-button type="primary" @click="handleDownloadReport">下载报告</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Timer, User, ChatLineRound, Trophy } from '@element-plus/icons-vue'
import { useLiveStore } from '@/store/liveStore'

const router = useRouter()
const store = useLiveStore()

const courseName = computed(() => store.courseName)
const formatTime = computed(() => store.formatTime)
const chatMessages = computed(() => store.chatMessages)
const quizHistory = computed(() => store.quizHistory)

const averageOnlineCount = ref(0)
const replayProgress = ref(0)
const replayStatus = ref<'success' | 'exception' | ''>('')

onMounted(() => {
  // 模拟计算平均在线人数
  averageOnlineCount.value = store.onlineCount

  // 模拟回放生成进度
  simulateReplayGeneration()
})

function simulateReplayGeneration() {
  let progress = 0
  const interval = setInterval(() => {
    progress += 10
    replayProgress.value = progress

    if (progress >= 100) {
      clearInterval(interval)
      replayStatus.value = 'success'
    }
  }, 500)
}

function getCorrectRate(quiz: any): number {
  if (!quiz.statistics) return 0
  const { total, correct } = quiz.statistics
  return total > 0 ? Math.round((correct / total) * 100) : 0
}

function handleBack() {
  router.push('/')
}

function handleDownloadReport() {
  // 下载报告逻辑
  console.log('下载报告')
}
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.summary-page {
  width: 100%;
  min-height: 100vh;
  background: $bg-secondary;
  padding: 40px;

  .summary-container {
    max-width: 1200px;
    margin: 0 auto;
    background: $bg-color;
    border-radius: 8px;
    padding: 40px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);

    .summary-header {
      text-align: center;
      margin-bottom: 40px;

      h1 {
        font-size: 28px;
        color: $text-primary;
        margin-bottom: 8px;
      }

      .course-name {
        font-size: 16px;
        color: $text-secondary;
      }
    }

    .summary-content {
      .stats-row {
        margin-bottom: 40px;

        .stat-card {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 24px;
          background: $secondary-color;
          border-radius: 8px;

          .stat-icon {
            font-size: 40px;
            color: $primary-color;
          }

          .stat-info {
            .stat-value {
              font-size: 24px;
              font-weight: 600;
              color: $text-primary;
              margin-bottom: 4px;
            }

            .stat-label {
              font-size: 14px;
              color: $text-secondary;
            }
          }
        }
      }

      .quiz-report {
        margin-bottom: 40px;

        h2 {
          font-size: 20px;
          color: $text-primary;
          margin-bottom: 16px;
        }
      }

      .replay-section {
        margin-bottom: 40px;

        h2 {
          font-size: 20px;
          color: $text-primary;
          margin-bottom: 16px;
        }

        .replay-status {
          p {
            margin-top: 12px;
            color: $text-secondary;
          }
        }
      }

      .action-buttons {
        display: flex;
        justify-content: center;
        gap: 16px;
      }
    }
  }
}
</style>



















