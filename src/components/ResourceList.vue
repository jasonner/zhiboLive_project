<template>
  <div class="resource-list">
    <div class="resource-content">
      <div
        v-for="resource in paginatedResources"
        :key="resource.id"
        class="resource-item"
      >
        <div class="resource-info">
          <div class="resource-details">
            <div class="resource-name" :title="resource.name">{{ resource.name }}</div>
            <div class="resource-type">
              <el-tag size="small" :type="getTypeTagType(resource)" :class="`res-type-${resource.resType}${resource.resType === 0 ? `-module-${resource.moduleType}` : ''}`">
                {{ getTypeText(resource) }}
              </el-tag>
            </div>
          </div>
        </div>
        <div class="resource-actions">
          <el-tooltip content="查看" placement="top">
            <el-button
              type="default"
              size="small"
              :icon="View"
              @click="handleView(resource.itemId || resource.id)"
              class="action-btn icon-only"
              circle
            />
          </el-tooltip>
        </div>
      </div>

      <el-empty
        v-if="resourceList.length === 0"
        description="暂无资源"
        :image-size="60"
        class="empty-resource"
      />
    </div>

    <!-- 分页 -->
    <div class="pagination-wrapper" v-if="resourceList.length > 10">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :total="resourceList.length"
        layout="pager"
        small
        @current-change="handleCurrentChange"
        class="resource-pagination"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, inject, type Ref } from 'vue'
import { View } from '@element-plus/icons-vue'
import { sendDataToMainApp, getMicroAppData } from '@/utils/microApp'
import type { SignalService } from '@/utils/signal'

// 资源接口定义
export interface Resource {
  id: string
  itemId?: string
  name: string
  category: string
  resType: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  moduleType?: 1 | 2 | 4
}

// Props：从主应用获取数据
const props = defineProps<{
  resources?: Resource[]
}>()

// 获取 signalService（用于判断是否是教师端）
const signalServiceRef = inject<Ref<SignalService | null>>('signalService', ref(null))
const signalService = computed(() => signalServiceRef.value)

// 判断是否是教师端（通过检查是否有 signalService）
const isTeacher = computed(() => !!signalService.value)

// 默认数据（用于测试）
const defaultResources: Resource[] = [
  { id: '1', name: '高等数学第一章课件', category: '课件资源', resType: 1 },
  { id: '2', name: '函数与极限练习题', category: '练习资源', resType: 2 },
  { id: '3', name: '数学公式图表', category: '图片资源', resType: 3 },
  { id: '4', name: '微积分教学视频', category: '视频资源', resType: 4 },
  { id: '5', name: '数学概念讲解音频', category: '音频资源', resType: 5 },
  { id: '6', name: '课程大纲文档', category: '文档资源', resType: 6 },
  { id: '7', name: '学生成绩统计表', category: '数据资源', resType: 7 },
  { id: '8', name: '导数与微分课件', category: '课件资源', resType: 8 },
  { id: '9', name: '积分计算练习题', category: '练习资源', resType: 9 },
  { id: '10', name: '几何图形示例', category: '图片资源', resType: 1 },
]

// 使用传入的数据或默认数据
const resourceList = computed(() => props.resources || defaultResources)

// 分页相关 - 每页显示10条（10行）
const currentPage = ref(1)
const pageSize = ref(10)

const paginatedResources = computed(() => {
  // 如果资源总数小于等于10，直接返回所有资源，不分页
  if (resourceList.value.length <= 10) {
    return resourceList.value
  }
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return resourceList.value.slice(start, end)
})

function handleCurrentChange(val: number) {
  currentPage.value = val
}

function getTypeText(resource: Resource): string {
  // 如果 resType 为 0，根据 moduleType 判断
  if (resource.resType === 0) {
    const moduleTypeMap: Record<1 | 2 | 4, string> = {
      1: '数字教材',
      2: '数字课程',
      4: '数字课件'
    }
    return moduleTypeMap[resource.moduleType as 1 | 2 | 4] || '未知'
  }
  
  // 其他 resType 的映射
  const typeMap: Record<Exclude<Resource['resType'], 0>, string> = {
    1: '图片',
    2: '视频',
    3: '图纸',
    4: '三维模型',
    5: '二维交互',
    6: '虚拟课程',
    7: '电子图书',
    8: '三维交互',
    9: '试题资源'
  }
  return typeMap[resource.resType as Exclude<Resource['resType'], 0>] || '未知'
}

function getTypeTagType(resource: Resource): 'success' | 'info' | 'warning' | 'danger' | '' {
  // 如果 resType 为 0，根据 moduleType 判断
  if (resource.resType === 0) {
    const moduleTypeMap: Record<1 | 2 | 4, 'success' | 'info' | 'warning' | 'danger' | ''> = {
      1: 'success',  // 数字教材
      2: 'info',     // 数字课程
      4: 'warning'   // 数字课件
    }
    return moduleTypeMap[resource.moduleType as 1 | 2 | 4] || 'info'
  }
  
  // 使用 Element Plus 内置类型作为基础，具体颜色通过 CSS 类覆盖
  const typeMap: Record<Exclude<Resource['resType'], 0>, 'success' | 'info' | 'warning' | 'danger' | ''> = {
    1: 'success',  // 图片
    2: 'warning',  // 视频
    3: 'info',     // 图纸
    4: 'danger',   // 三维模型
    5: 'success',  // 二维交互
    6: 'info',     // 虚拟课程
    7: 'warning',  // 电子图书
    8: 'danger',   // 三维交互
    9: ''          // 试题资源
  }
  return typeMap[resource.resType as Exclude<Resource['resType'], 0>] || ''
}

// 根据资源ID和类型拼接URL
function buildResourceUrl(resourceId: string, resType: Resource['resType'], moduleType?: Resource['moduleType']): string {
  // 从主应用获取基础URL配置
  const microAppData = getMicroAppData()
  const baseUrl = microAppData?.resourceBaseUrl || microAppData?.baseUrl || ''
  
  // 如果 resType 为 0 且 moduleType 为 1（教材），使用特殊格式
  if (resType === 0 && moduleType === 1) {
    if (baseUrl) {
      const url = new URL(baseUrl)
      return `${url.origin}/textBook/pptDetail?id=${resourceId}&digitalType=${moduleType}`
    }
    // 如果没有 baseUrl，使用当前页面的 origin
    const currentOrigin = window.location.origin
    return `${currentOrigin}/textBook/pptDetail?id=${resourceId}&digitalType=${moduleType}`
  }
  
  // 如果 resType 为 0 且 moduleType 为 2（课程），使用特殊格式
  if (resType === 0 && moduleType === 2) {
    if (baseUrl) {
      const url = new URL(baseUrl)
      return `${url.origin}/course/courseDetails/${resourceId}?digitalType=${moduleType}`
    }
    // 如果没有 baseUrl，使用当前页面的 origin
    const currentOrigin = window.location.origin
    return `${currentOrigin}/course/courseDetails/${resourceId}?digitalType=${moduleType}`
  }
  
  // 如果 resType 为 0 且 moduleType 为 4（课件），使用特殊格式
  if (resType === 0 && moduleType === 4) {
    if (baseUrl) {
      const url = new URL(baseUrl)
      return `${url.origin}/courseware/lookCourseware?id=${resourceId}&digitalType=${moduleType}`
    }
    // 如果没有 baseUrl，使用当前页面的 origin
    const currentOrigin = window.location.origin
    return `${currentOrigin}/courseware/lookCourseware?id=${resourceId}&digitalType=${moduleType}`
  }
  
  // 如果主应用提供了完整的URL拼接规则，使用它
  if (microAppData?.resourceUrlBuilder) {
    try {
      // 如果是一个函数，调用它
      if (typeof microAppData.resourceUrlBuilder === 'function') {
        return microAppData.resourceUrlBuilder(resourceId, resType)
      }
      // 如果是字符串模板，替换占位符
      if (typeof microAppData.resourceUrlBuilder === 'string') {
        return microAppData.resourceUrlBuilder
          .replace('{id}', resourceId)
          .replace('{resType}', resType.toString())
      }
    } catch (error) {
      console.warn('[ResourceList] URL构建函数执行失败:', error)
    }
  }
  
  // 优先使用 resourceLive 格式：${baseUrl}/resourceLive?id=${id}&resType=${resType}
  // 如果 baseUrl 存在，使用 baseUrl；否则使用当前页面的 origin
  if (baseUrl) {
    const url = new URL(baseUrl)
    return `${url.origin}/resourceLive?id=${resourceId}&resType=${resType}`
  }
  
  // 如果没有 baseUrl，使用当前页面的 origin
  const currentOrigin = window.location.origin
  return `${currentOrigin}/resourceLive?id=${resourceId}&resType=${resType}`
}

async function handleView(itemId: string) {
  // 根据 itemId 查找对应的资源对象（优先使用 itemId，如果没有则使用 id）
  const resource = resourceList.value.find(r => (r.itemId || r.id) === itemId)
  
  if (!resource) {
    console.warn('[ResourceList] 未找到资源，itemId:', itemId)
    emit('view', itemId)
    return
  }
  
  // 如果是教师端，直接在新窗口打开URL并提示开启屏幕共享
  if (isTeacher.value) {
    try {
      // 根据资源ID拼接URL
      const resourceUrl = buildResourceUrl(resource.itemId || resource.id, resource.resType, resource.moduleType)
      console.log('[ResourceList] 教师端查看资源，拼接URL:', resourceUrl)
      
      // 在新窗口打开资源URL
      const newWindow = window.open(resourceUrl, '_blank', 'width=1200,height=800')
      
      if (newWindow) {
        console.log('[ResourceList] ✅ 已在新窗口打开资源:', resourceUrl)
        
        // 提示用户开启屏幕共享
        const { ElMessage } = await import('element-plus')
        ElMessage({
          message: `资源"${resource.name}"已在新窗口打开，请点击"屏幕共享"按钮进行推流`,
          type: 'info',
          duration: 5000,
          showClose: true
        })
      } else {
        console.error('[ResourceList] ❌ 无法打开新窗口，可能被浏览器阻止')
        const { ElMessage } = await import('element-plus')
        ElMessage.error('无法打开新窗口，请检查浏览器弹窗设置')
      }
    } catch (error) {
      console.error('[ResourceList] 打开资源窗口失败:', error)
      const { ElMessage } = await import('element-plus')
      ElMessage.error('打开资源失败，请重试')
    }
  }
  
  // 发送完整的资源信息给主应用
  sendDataToMainApp({
    type: 'viewResource',
    data: {
      id: resource.id,
      name: resource.name,
      category: resource.category,
      resType: resource.resType,
      resTypeText: getTypeText(resource)
    }
  })
  console.log('[ResourceList] 查看资源，已发送给主应用:', resource)
  
  // 同时触发查看事件，供父组件使用
  emit('view', itemId)
}

// 定义事件
const emit = defineEmits<{
  view: [id: string]
}>()
</script>

<style scoped lang="scss">
@import '@/styles/variables.scss';

.resource-list {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: $bg-color;

  .resource-content {
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

    .resource-item {
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

      .resource-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;

        .resource-category {
          font-size: 12px;
          color: $text-secondary;
          font-weight: 500;
        }

        .resource-details {
          display: flex;
          align-items: center;
          gap: 12px;

          .resource-name {
            flex: 1;
            font-size: 14px;
            font-weight: 600;
            color: $text-primary;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            transition: color 0.3s ease;
          }

          .resource-type {
            flex-shrink: 0;

            // 为不同类型的资源标签设置不同的颜色
            :deep(.el-tag) {
              &.res-type-1 {
                background-color: #67c23a;
                border-color: #67c23a;
                color: #ffffff;
              }

              &.res-type-2 {
                background-color: #e6a23c;
                border-color: #e6a23c;
                color: #ffffff;
              }

              &.res-type-3 {
                background-color: #409eff;
                border-color: #409eff;
                color: #ffffff;
              }

              &.res-type-4 {
                background-color: #f56c6c;
                border-color: #f56c6c;
                color: #ffffff;
              }

              &.res-type-5 {
                background-color: #95d475;
                border-color: #95d475;
                color: #ffffff;
              }

              &.res-type-6 {
                background-color: #73c0de;
                border-color: #73c0de;
                color: #ffffff;
              }

              &.res-type-7 {
                background-color: #f0a020;
                border-color: #f0a020;
                color: #ffffff;
              }

              &.res-type-8 {
                background-color: #e85a5a;
                border-color: #e85a5a;
                color: #ffffff;
              }

              &.res-type-9 {
                background-color: #9c27b0;
                border-color: #9c27b0;
                color: #ffffff;
              }

              // resType 为 0 时，根据 moduleType 设置样式
              &.res-type-0-module-1 {
                background-color: #67c23a;
                border-color: #67c23a;
                color: #ffffff;
              }

              &.res-type-0-module-2 {
                background-color: #409eff;
                border-color: #409eff;
                color: #ffffff;
              }

              &.res-type-0-module-4 {
                background-color: #e6a23c;
                border-color: #e6a23c;
                color: #ffffff;
              }
            }
          }
        }
      }

      .resource-actions {
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

    .empty-resource {
      padding: 40px 0;
    }
  }

  .pagination-wrapper {
    padding: 12px 16px;
    border-top: 1px solid $border-color;
    background: $bg-secondary;
    display: flex;
    justify-content: center;

    .resource-pagination {
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
