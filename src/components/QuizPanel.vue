<template>
  <div class="quiz-panel">
    <div class="panel-header">
      <span class="title">互动题</span>
    </div>

    <!-- 教师端：创建题目 -->
    <div class="quiz-create" v-if="isTeacher && !currentQuiz">
      <el-button
        type="primary"
        :icon="Plus"
        @click="showCreateDialog = true"
        style="width: 100%"
      >
        创建题目
      </el-button>
    </div>

    <!-- 当前题目 -->
    <div class="quiz-content" v-if="currentQuiz">
      <div class="quiz-header">
        <div class="quiz-type-badge">
          {{ getQuizTypeText(currentQuiz.type) }}
        </div>
        <div class="quiz-question">{{ currentQuiz.question }}</div>
      </div>

      <div class="quiz-options" v-if="currentQuiz.options">
        <el-radio-group
          v-model="selectedAnswer"
          v-if="currentQuiz.type === 'single'"
          @change="handleAnswerChange"
        >
          <el-radio
            v-for="(option, index) in currentQuiz.options"
            :key="index"
            :label="String.fromCharCode(65 + index)"
            class="option-item"
          >
            {{ String.fromCharCode(65 + index) }}. {{ option }}
          </el-radio>
        </el-radio-group>

        <el-checkbox-group
          v-model="selectedAnswers"
          v-else-if="currentQuiz.type === 'multiple'"
          @change="handleAnswerChange"
        >
          <el-checkbox
            v-for="(option, index) in currentQuiz.options"
            :key="index"
            :label="String.fromCharCode(65 + index)"
            class="option-item"
          >
            {{ String.fromCharCode(65 + index) }}. {{ option }}
          </el-checkbox>
        </el-checkbox-group>

        <el-radio-group
          v-model="selectedAnswer"
          v-else-if="currentQuiz.type === 'judge'"
          @change="handleAnswerChange"
        >
          <el-radio label="true" class="option-item">正确</el-radio>
          <el-radio label="false" class="option-item">错误</el-radio>
        </el-radio-group>
      </div>

      <div class="quiz-actions">
        <el-button
          v-if="!isTeacher"
          type="primary"
          @click="handleSubmit"
          :disabled="!hasAnswer"
        >
          提交答案
        </el-button>
        <div class="quiz-statistics" v-if="isTeacher && currentQuiz.statistics">
          <div class="stat-item">
            <span>参与人数：</span>
            <span>{{ currentQuiz.statistics.total }}</span>
          </div>
          <div class="stat-item">
            <span>正确率：</span>
            <span>{{ getCorrectRate() }}%</span>
          </div>
        </div>
        <el-button
          v-if="isTeacher"
          type="danger"
          @click="handleFinishQuiz"
        >
          结束题目
        </el-button>
      </div>
    </div>

    <!-- 创建题目对话框 -->
    <el-dialog
      v-model="showCreateDialog"
      title="创建互动题"
      width="600px"
    >
      <el-form :model="quizForm" label-width="80px">
        <el-form-item label="题目类型">
          <el-radio-group v-model="quizForm.type">
            <el-radio label="single">单选题</el-radio>
            <el-radio label="multiple">多选题</el-radio>
            <el-radio label="judge">判断题</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="题目内容">
          <el-input
            v-model="quizForm.question"
            type="textarea"
            :rows="3"
            placeholder="请输入题目"
          />
        </el-form-item>
        <el-form-item
          label="选项"
          v-if="quizForm.type !== 'judge'"
        >
          <div
            v-for="(option, index) in quizForm.options"
            :key="index"
            class="option-input"
          >
            <el-input
              v-model="quizForm.options[index]"
              :placeholder="`选项 ${String.fromCharCode(65 + index)}`"
            />
            <el-button
              v-if="quizForm.options.length > 2"
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
            v-if="quizForm.options.length < 6"
          >
            + 添加选项
          </el-button>
        </el-form-item>
        <el-form-item label="正确答案">
          <el-input
            v-model="quizForm.correctAnswer"
            placeholder="单选题/判断题：A，多选题：A,B,C"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="handleCreateQuiz">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, type Ref } from 'vue'
import { Plus, Delete } from '@element-plus/icons-vue'
import { useLiveStore } from '@/store/liveStore'
import type { Quiz } from '@/store/liveStore'
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

const currentQuiz = computed(() => store.currentQuiz)
const showCreateDialog = ref(false)

const quizForm = ref({
  type: 'single' as 'single' | 'multiple' | 'judge',
  question: '',
  options: ['', ''],
  correctAnswer: ''
})

const selectedAnswer = ref('')
const selectedAnswers = ref<string[]>([])

const hasAnswer = computed(() => {
  if (currentQuiz.value?.type === 'multiple') {
    return selectedAnswers.value.length > 0
  }
  return !!selectedAnswer.value
})

function getQuizTypeText(type: Quiz['type']): string {
  const typeMap = {
    single: '单选题',
    multiple: '多选题',
    judge: '判断题'
  }
  return typeMap[type]
}

function addOption() {
  if (quizForm.value.options.length < 6) {
    quizForm.value.options.push('')
  }
}

function removeOption(index: number) {
  if (quizForm.value.options.length > 2) {
    quizForm.value.options.splice(index, 1)
  }
}

function handleCreateQuiz() {
  if (!quizForm.value.question.trim()) {
    return
  }

  const quiz: Quiz = {
    id: Date.now().toString(),
    type: quizForm.value.type,
    question: quizForm.value.question,
    options: quizForm.value.type !== 'judge' ? quizForm.value.options : undefined,
    correctAnswer: quizForm.value.correctAnswer,
    isActive: true
  }

  store.createQuiz(quiz)
  showCreateDialog.value = false

  // 重置表单
  quizForm.value = {
    type: 'single',
    question: '',
    options: ['', ''],
    correctAnswer: ''
  }

  // 通过 WebSocket 发送题目（使用后端 pushTask 事件）
  const service = signalService.value
  if (service && props.isTeacher) {
    const classroomId = service.currentClassroomId || 1
    const itemId = parseInt(quiz.id) || Date.now()
    const quizData = {
      quizId: quiz.id,
      type: quiz.type,
      question: quiz.question,
      options: quiz.options,
      correctAnswer: quiz.correctAnswer
    }
    console.log('[QuizPanel] 📤 发送互动题:', quizData)
    service.pushTask(classroomId, itemId, quizData)
  } else if (!service) {
    console.warn('[QuizPanel] ⚠️ signalService 不可用，无法发送互动题')
  }
}

function handleAnswerChange() {
  // 实时保存答案（可选）
}

function handleSubmit() {
  if (!currentQuiz.value) return

  const answer = currentQuiz.value.type === 'multiple'
    ? selectedAnswers.value
    : selectedAnswer.value

  store.submitQuizAnswer(props.currentUserId || 'student-001', answer)
  
  // 通过 WebSocket 提交答案（注意：后端没有直接的提交答案事件，可能需要通过其他方式）
  // 如果后端需要，可以使用 sendClassroomMsg 或其他事件
  const service = signalService.value
  if (service && !props.isTeacher) {
    const classroomId = service.currentClassroomId || 1
    const answerData = {
      quizId: currentQuiz.value.id,
      userId: props.currentUserId,
      answer: answer,
      timestamp: Date.now()
    }
    console.log('[QuizPanel] 📤 提交答案:', answerData)
    // 注意：这里可能需要根据后端实际需求调整事件类型
    // 如果后端有专门的答案提交事件，应该使用那个事件
    service.sendClassroomMsg(classroomId, answerData)
  }
}

function handleFinishQuiz() {
  store.finishQuiz()
  selectedAnswer.value = ''
  selectedAnswers.value = []
  
  // 通过 WebSocket 结束题目（注意：后端没有直接的结束题目事件，可能需要通过其他方式）
  // 如果后端需要，可以使用 sendClassroomMsg 或其他事件
  const service = signalService.value
  if (service && props.isTeacher) {
    const classroomId = service.currentClassroomId || 1
    const finishData = {
      quizId: currentQuiz.value?.id,
      action: 'finish',
      timestamp: Date.now()
    }
    console.log('[QuizPanel] 📤 结束题目:', finishData)
    // 注意：这里可能需要根据后端实际需求调整事件类型
    service.sendClassroomMsg(classroomId, finishData)
  }
}

function getCorrectRate(): number {
  if (!currentQuiz.value?.statistics) return 0
  const { total, correct } = currentQuiz.value.statistics
  return total > 0 ? Math.round((correct / total) * 100) : 0
}
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.quiz-panel {
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

  .quiz-create {
    padding: 16px;
  }

  .quiz-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;

    .quiz-header {
      margin-bottom: 16px;

      .quiz-type-badge {
        display: inline-block;
        padding: 4px 8px;
        background: $primary-color;
        color: white;
        border-radius: 4px;
        font-size: 12px;
        margin-bottom: 8px;
      }

      .quiz-question {
        font-size: 16px;
        color: $text-primary;
        font-weight: 500;
        line-height: 1.5;
      }
    }

    .quiz-options {
      flex: 1;
      margin-bottom: 16px;

      .option-item {
        display: block;
        margin-bottom: 12px;
        font-size: 14px;
        color: $text-primary;
      }
    }

    .quiz-actions {
      border-top: 1px solid $border-color;
      padding-top: 16px;

      .quiz-statistics {
        display: flex;
        gap: 20px;
        margin-bottom: 12px;

        .stat-item {
          font-size: 14px;
          color: $text-primary;

          span:last-child {
            color: $primary-color;
            font-weight: 500;
          }
        }
      }
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


