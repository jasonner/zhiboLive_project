import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'

import App from './App.vue'
import router from './router'
import './styles/main.scss'

// micro-app 集成
import { isMicroApp, getMicroAppData, onMicroAppDataChange } from './utils/microApp'

// 初始化 micro-app 数据接收
if (isMicroApp()) {
  console.log('[micro-app] 检测到 micro-app 环境')
  const initialData = getMicroAppData()
  console.log('[micro-app] 初始数据:', initialData)
  
  // 监听主应用数据变化
  onMicroAppDataChange((data: any) => {
    console.log('[micro-app] 收到主应用数据变化:', data)
    // 更新全局数据
    if (window.__MICRO_APP_ENVIRONMENT__) {
      window.__MICRO_APP_ENVIRONMENT__.data = {
        ...window.__MICRO_APP_ENVIRONMENT__.data,
        ...data
      }
    }
  })
} else {
  console.log('[micro-app] 未检测到 micro-app 环境，运行在独立模式')
}

// 在应用启动时初始化 mediaDevices polyfill（用于 HTTP + IP 地址环境）
if (!navigator.mediaDevices) {
  console.log('[App] navigator.mediaDevices 不可用，尝试创建 polyfill')
  const getUserMedia = 
    navigator.getUserMedia ||
    (navigator as any).webkitGetUserMedia ||
    (navigator as any).mozGetUserMedia ||
    (navigator as any).msGetUserMedia

  if (getUserMedia) {
    console.log('[App] 找到旧版 getUserMedia API，创建 polyfill')
    ;(navigator as any).mediaDevices = {
      getUserMedia: function(constraints: MediaStreamConstraints) {
        return new Promise((resolve, reject) => {
          getUserMedia.call(navigator, constraints, resolve, reject)
        })
      },
      getDisplayMedia: function() {
        return Promise.reject(new Error('屏幕共享需要 HTTPS 环境'))
      }
    }
    console.log('[App] mediaDevices polyfill 创建成功')
  } else {
    console.warn('[App] 未找到任何 getUserMedia API，浏览器可能不支持 WebRTC')
  }
} else {
  console.log('[App] navigator.mediaDevices 可用')
}

const app = createApp(App)

// 注册所有图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })

// 添加全局错误处理
app.config.errorHandler = (err, instance, info) => {
  console.error('Vue 错误:', err)
  console.error('错误信息:', info)
  console.error('组件实例:', instance)
}

try {
  app.mount('#app')
  console.log('Vue 应用已成功挂载')
} catch (error) {
  console.error('挂载 Vue 应用失败:', error)
}


