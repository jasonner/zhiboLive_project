import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: 'zhiboLive/teacher'
  },
  {
    path: '/simple',
    name: 'SimpleTest',
    component: () => import('@/pages/SimpleTest.vue'),
    meta: { title: '简单测试' }
  },
  {
    path: '/test',
    name: 'TestPage',
    component: () => import('@/pages/TestPage.vue'),
    meta: { title: '测试页面' }
  },
  {
    path: '/zhiboLive/teacher',
    name: 'TeacherRoom',
    component: () => import('@/pages/TeacherRoom.vue'),
    meta: { title: '教师直播间' }
  },
  {
    path: '/zhiboLive/student',
    name: 'StudentRoom',
    component: () => import('@/pages/StudentRoom.vue'),
    meta: { title: '学生直播间' }
  },
  {
    path: '/summary',
    name: 'Summary',
    component: () => import('@/pages/Summary.vue'),
    meta: { title: '直播总结' }
  },
  {
    path: '/flv-test',
    name: 'FlvPlayerTest',
    component: () => import('@/pages/FlvPlayerTest.vue'),
    meta: { title: 'FLV播放器测试' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 添加路由错误处理
router.beforeEach((to, from, next) => {
  console.log('路由导航:', from.path, '->', to.path)
  next()
})

router.onError((error) => {
  console.error('路由加载错误:', error)
})

export default router


