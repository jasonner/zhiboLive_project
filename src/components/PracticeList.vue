<template>
  <div class="practice-list">
    <div class="practice-content">
      <div
        v-for="practice in paginatedPractices"
        :key="practice.id"
        class="practice-item"
      >
        <div class="practice-name" :title="practice.name">{{ practice.name }}</div>
        <div class="practice-actions">
          <el-tooltip content="发布" placement="top">
            <el-button
              type="primary"
              size="small"
              :icon="Promotion"
              @click="handlePublish(practice.id)"
              class="action-btn icon-only"
              circle
            />
          </el-tooltip>
          <el-tooltip content="查看详情" placement="top">
            <el-button
              type="default"
              size="small"
              :icon="View"
              @click="handleViewDetail(practice.id)"
              class="action-btn icon-only"
              circle
            />
          </el-tooltip>
        </div>
      </div>

      <el-empty
        v-if="practiceList.length === 0"
        description="暂无随堂练习"
        :image-size="60"
        class="empty-practice"
      />
    </div>

    <!-- 分页 -->
    <div class="pagination-wrapper" v-if="practiceList.length > 10">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="practiceList.length"
        layout="pager"
        small
        @current-change="handleCurrentChange"
        class="practice-pagination"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Promotion, View } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useLiveStore } from '@/store/liveStore'

// 随堂练习接口定义
export interface Practice {
  id: string
  name: string
}

// Props：从主应用获取数据
const props = defineProps<{
  practices?: Practice[]
}>()

// 默认数据（用于测试）
const defaultPractices: Practice[] = []

// 使用传入的数据或默认数据
const practiceList = computed(() => props.practices || defaultPractices)

// 获取 store 以检查直播状态
const store = useLiveStore()

// 分页相关 - 每页显示10条（10行）
const currentPage = ref(1)
const pageSize = ref(10)

const paginatedPractices = computed(() => {
  // 如果练习总数小于等于10，直接返回所有练习，不分页
  if (practiceList.value.length <= 10) {
    return practiceList.value
  }
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return practiceList.value.slice(start, end)
})

function handleCurrentChange(val: number) {
  currentPage.value = val
}

function handlePublish(id: string) {
  // 检查直播状态
  if (!store.isLive) {
    ElMessage.warning('请先开启直播')
    return
  }
  
  ElMessageBox.confirm(
    '确定要发布这个随堂练习吗？发布后学生将可以开始答题。',
    '发布确认',
    {
      confirmButtonText: '确定发布',
      cancelButtonText: '取消',
      type: 'warning',
    }
  ).then(() => {
    ElMessage.success('发布成功！')
    // 触发发布事件
    emit('publish', id)
  }).catch(() => {
    // 用户取消
  })
}

function handleViewDetail(id: string) {
  // 触发查看详情事件
  emit('view-detail', id)
}

// 定义事件
const emit = defineEmits<{
  publish: [id: string]
  'view-detail': [id: string]
}>()
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.practice-list {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: $bg-color;

  .practice-content {
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    // 限制高度，在手风琴中自适应
    max-height: 400px;

    &::-webkit-scrollbar {
      width: 6px;
    }
    &::-webkit-scrollbar-track {
      background: transparent;
    }
    &::-webkit-scrollbar-thumb {
      background: $border-color;
      border-radius: 3px;
      &:hover {
        background: darken($border-color, 10%);
      }
    }

    .practice-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      background: $bg-color;
      border: 1.5px solid $border-color;
      border-radius: 8px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      cursor: pointer;
      position: relative;
      overflow: hidden;

      &::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 4px;
        background: transparent;
        transition: all 0.3s ease;
      }

      &:hover {
        border-color: $primary-color;
        background: $secondary-color;
        transform: translateX(4px);
        box-shadow: 0 4px 12px rgba(74, 138, 244, 0.12);

        &::before {
          background: linear-gradient(180deg, $primary-color 0%, lighten($primary-color, 10%) 100%);
        }
      }

      .practice-name {
        flex: 1;
        font-size: 14px;
        font-weight: 600;
        color: $text-primary;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        transition: color 0.3s ease;
      }

      .practice-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        margin-left: 12px;

        .action-btn {
          transition: all 0.3s ease;

          &.icon-only {
            padding: 8px;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;

            &:hover {
              transform: translateY(-2px) scale(1.05);
              box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
            }
          }
        }
      }
    }

    .empty-practice {
      padding: 40px 0;
    }
  }

  .pagination-wrapper {
    padding: 12px 16px;
    border-top: 1px solid $border-color;
    background: $bg-secondary;
    display: flex;
    justify-content: center;

      .practice-pagination {
        :deep(.el-pager li) {
          min-width: 28px;
          height: 28px;
          line-height: 28px;
          font-size: 12px;
          border-radius: 4px;
          transition: all 0.3s ease;

          &.is-active {
            background: linear-gradient(135deg, $primary-color 0%, lighten($primary-color, 5%) 100%);
            color: #ffffff;
            font-weight: 600;
          }

          &:hover:not(.is-active) {
            background: $secondary-color;
            color: $primary-color;
          }
        }
      }
  }
}
</style>
