/**
 * API 接口封装
 * 在页面中直接调用这些方法即可，无需关心 URL 和 token
 */
const apiPrefix = 'smartstar-digitalapp'
import { get, post, put, del, patch, ApiResponse } from '@/utils/request'

/**
 * 获取教室详情
 * @param classroomId 教室ID
 */
export function getClassroomDetail(classroomId: string): Promise<ApiResponse<{
  id: string
  name: string
  status: string
  teacherId: string
  studentList: Array<{
    id: string
    name: string
  }>
}>> {
  return get(apiPrefix+`/classrooms/${classroomId}`)
}





