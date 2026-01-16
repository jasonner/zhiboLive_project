<template>
  <div class="student-list">
    <el-collapse v-model="activeNames" accordion class="accordion-container">
      <!-- 学生列表 -->
      <el-collapse-item name="students" class="accordion-item">
        <template #title>
          <div class="accordion-title">
            <span class="title-text">学生列表</span>
            <span class="count">({{ studentList.length }})</span>
          </div>
        </template>
        <div class="list-content">
          <el-tooltip
            v-for="student in studentList"
            :key="student.userId"
            :content="student.isOnline ? '在线' : '离线'"
            placement="top"
            effect="dark"
          >
            <div
              class="student-item"
              :class="{ online: student.isOnline, offline: !student.isOnline }"
            >
              <div class="student-avatar-wrapper">
                <el-avatar
                  :size="48"
                  :src="student.avatar || undefined"
                  class="student-avatar"
                  :style="{ backgroundColor: getAvatarColor(student.name) }"
                >
                  {{ getAvatarText(student.name) }}
                </el-avatar>
                <div class="status-indicator" :class="{ online: student.isOnline, offline: !student.isOnline }"></div>
              </div>
              <div class="student-name" :title="student.name">{{ student.name }}</div>
            </div>
          </el-tooltip>

          <el-empty
            v-if="studentList.length === 0"
            description="暂无学生"
            :image-size="80"
          />
        </div>
      </el-collapse-item>

      <!-- 随堂练习列表 -->
      <el-collapse-item name="practice" class="accordion-item">
        <template #title>
          <div class="accordion-title">
            <span class="title-text">随堂练习</span>
            <span class="count">({{ practiceList.length }})</span>
          </div>
        </template>
        <PracticeList
          :practices="practiceList"
          @publish="handlePublish"
          @view-detail="handleViewDetail"
        />
      </el-collapse-item>

      <!-- 资源列表 -->
      <el-collapse-item name="resources" class="accordion-item">
        <template #title>
          <div class="accordion-title">
            <span class="title-text">资源列表</span>
            <span class="count">({{ resourceList.length }})</span>
          </div>
        </template>
        <ResourceList
          :resources="resourceList"
          @view="handleViewResource"
        />
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, inject, type Ref } from 'vue'
import { useLiveStore } from '@/store/liveStore'
import PracticeList from './PracticeList.vue'
import type { Practice } from './PracticeList.vue'
import ResourceList from './ResourceList.vue'
import type { Resource } from './ResourceList.vue'
import { getMicroAppData, sendDataToMainApp } from '@/utils/microApp'
import type { SignalService } from '@/utils/signal'

const store = useLiveStore()
// 手风琴当前激活的面板（accordion 模式下是字符串，不是数组）
const activeNames = ref<string>('students')

// 从父组件注入 signalService
const signalServiceRef = inject<Ref<SignalService | null>>('signalService', ref(null))
const signalService = computed(() => signalServiceRef.value)

// 随堂练习数据（从主应用获取，这里使用假数据作为示例）
const practiceList = ref<Practice[]>([])

// 处理发布事件
function handlePublish(id: string) {
  console.log('发布练习:', id)
  
  // 查找对应的练习数据
  const practice = practiceList.value.find(p => p.id === id)
  if (!practice) {
    console.warn('[StudentList] ⚠️ 未找到练习数据:', id)
    return
  }
  
  // 调用 pushTask 事件
  const service = signalService.value
  if (service) {
    const classroomId = service.currentClassroomId || 1
    const itemId = parseInt(id) || Date.now()
    const taskData = {
      taskId: id,
      name: practice.name,
      itemId:practice?.itemId || ''
    }
    console.log('[StudentList] 📤 发送发布随堂练习请求:', taskData)
    service.pushTask(classroomId, itemId, taskData)
  } else {
    console.warn('[StudentList] ⚠️ signalService 不可用，无法发送发布随堂练习请求')
  }
}

// 处理查看详情事件
function handleViewDetail(id: string) {
  console.log('查看练习详情:', id)
  
  // 查找对应的练习数据
  const practice = practiceList.value.find(p => p.id === id)
  if (!practice) {
    console.warn('[StudentList] ⚠️ 未找到练习数据:', id)
    return
  }
  
  // 向主应用发送数据
  sendDataToMainApp({
    type: 'viewPracticeDetail',
    data:practice,
    timer: Date.now()
  })
  console.log('[StudentList] ✅ 已向主应用发送查看练习详情请求:', practice)
}

// 资源列表数据（从主应用获取，这里使用假数据作为示例）
const resourceList = ref<Resource[]>([])

// 处理查看资源事件
function handleViewResource(id: string) {
  console.log('查看资源:', id)
  
  // 查找对应的资源数据
  const resource = resourceList.value.find(r => r.id === id)
  if (!resource) {
    console.warn('[StudentList] ⚠️ 未找到资源数据:', id)
    return
  }
  
  // 向主应用发送数据
  sendDataToMainApp({
    type: 'viewResource',
    data: {
      id: resource.id,
      name: resource.name,
      category: resource.category,
      resType: resource.resType
    },
    timer: Date.now()
  })
  console.log('[StudentList] ✅ 已向主应用发送查看资源请求:', resource)
}

// 只显示学生，不显示教师
const studentList = computed(() => {
  const realStudents = store.students.filter(s => s.role === 'student')
  return realStudents.length > 0 ? realStudents : []
})

// 获取头像文字（姓名首字符）
function getAvatarText(name: string): string {
  if (!name) return '?'
  // 如果是中文，取最后一个字符；如果是英文，取首字母
  const lastChar = name[name.length - 1]
  if (/[\u4e00-\u9fa5]/.test(lastChar)) {
    return lastChar
  }
  return name.charAt(0).toUpperCase()
}

// 根据姓名生成头像背景色（类似腾讯会议）
function getAvatarColor(name: string): string {
  const colors = [
    '#4A8AF4', // 蓝色
    '#67C23A', // 绿色
    '#E6A23C', // 橙色
    '#F56C6C', // 红色
    '#909399', // 灰色
    '#409EFF', // 亮蓝
    '#9C27B0', // 紫色
    '#FF9800', // 深橙
  ]
  if (!name) return colors[0]
  // 根据姓名生成一个稳定的颜色索引
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

// 组件挂载时，如果没有真实数据，设置假数据
onMounted(() => {
  getMicroData()
})

const getMicroData = () => {
  const studentList = getMicroAppData()?.data?.signs || []
  if (studentList) {
    if (studentList.length > 0) {
      const data = studentList.map((res: any) => {
        return {
          userId: res.userId,
          name: res.nickName,
          role: 'student',
          isOnline: false,
          avatar: res.avatar || undefined,
        }
      })
      store.setStudents(data)
    }
  }
  practiceList.value =  getMicroAppData()?.data?.tasks || []
  
  // 获取资源列表
  const resources = getMicroAppData()?.data?.resources || []
  
  // 获取课件数据（和resources同级）
  const coursewareId = getMicroAppData()?.data?.coursewareId
  const coursewareName = getMicroAppData()?.data?.coursewareName
  
  // 如果有课件数据，转换成Resource格式并添加到资源列表前面
  if (coursewareId && coursewareName) {
    const coursewareResource: Resource = {
      id: String(coursewareId),
      itemId: String(coursewareId),
      name: coursewareName,
      category: '课件资源',
      resType: 0,
      moduleType: 4
    }
    resourceList.value = [coursewareResource, ...resources]
  } else {
    resourceList.value = resources
  }
  
  const CourseName = getMicroAppData()?.data?.name
  store.setCourseName(CourseName)
}

</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.student-list {
  background: $bg-color;
  height: 100%;
  display: flex;
  flex-direction: column;

  .accordion-container {
    border: none;
    background: transparent;
    height: 100%;
    display: flex;
    flex-direction: column;

    :deep(.el-collapse-item) {
      border: none;
      border-bottom: 1px solid $border-color;

      &:last-child {
        border-bottom: none;
      }

      .el-collapse-item__header {
        padding: 12px 16px;
        background: $bg-color;
        border: none;
        font-size: 14px;
        font-weight: 500;
        color: $text-primary;
        transition: all 0.3s ease;

        &:hover {
          background: $secondary-color;
        }

        .el-collapse-item__arrow {
          margin-right: 12px;
          color: $text-secondary;
          transition: transform 0.3s ease;
        }

        &.is-active {
          .el-collapse-item__arrow {
            transform: rotate(90deg);
          }
        }
      }

      .el-collapse-item__wrap {
        border: none;
        background: $bg-color;

        .el-collapse-item__content {
          padding: 0;
          background: $bg-color;
        }
      }
    }
  }

  .accordion-title {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;

    .title-text {
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
    overflow-y: auto;
    padding: 12px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    align-content: start;
    max-height: 400px;
    // 自定义滚动条样式
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

    .student-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 12px 8px;
      border-radius: 8px;
      background: $bg-color;
      border: 1px solid $border-color;
      transition: all 0.3s ease;
      cursor: pointer;
      position: relative;
      height: fit-content;

      &:hover {
        background: $secondary-color;
        border-color: $primary-color;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(74, 138, 244, 0.15);
      }

      &.online {
        .status-indicator {
          background-color: #67c23a;
          box-shadow: 0 0 0 2px $bg-color, 0 0 0 4px rgba(103, 194, 58, 0.2);
        }
      }

      &.offline {
        .status-indicator {
          background-color: #F56C6C;
          box-shadow: 0 0 0 2px $bg-color, 0 0 0 4px rgba(245, 108, 108, 0.2);
        }
        .student-avatar {
          opacity: 0.6;
        }
        .student-name {
          color: $text-secondary;
          width: 40px;
        }
      }

      .student-avatar-wrapper {
        position: relative;
        margin-bottom: 8px;

        .student-avatar {
          border: 2px solid transparent;
          transition: all 0.3s ease;
          font-weight: 600;
          font-size: 18px;
          color: #ffffff;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          
          &:deep(.el-avatar__inner) {
            font-weight: 600;
            font-size: 18px;
          }
        }

        .status-indicator {
          position: absolute;
          bottom: 0;
          right: 0;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: 2px solid $bg-color;
          transition: all 0.3s ease;
          z-index: 1;
        }
      }

      .student-name {
        font-size: 12px;
        color: $text-primary;
        font-weight: 500;
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        width: 40px;
        max-width: 100%;
        transition: color 0.3s ease;
        line-height: 1.2;
      }
    }
  }

}
</style>
