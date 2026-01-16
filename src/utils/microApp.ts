/**
 * micro-app 工具函数
 * 用于接收和管理主应用传递的数据
 */

declare global {
  interface Window {
    __MICRO_APP_ENVIRONMENT__?: {
      data?: any
      setData?: (data: any) => void
    }
    microApp?: {
      addDataListener?: (callback: (data: any) => void) => void
      removeDataListener?: (callback: (data: any) => void) => void
      dispatch?: (data: any) => void
      getData?: () => any
    }
  }
}

/**
 * 获取主应用传递的数据
 */
export function getMicroAppData(): any {
  if (window.__MICRO_APP_ENVIRONMENT__?.data) {
    return window.__MICRO_APP_ENVIRONMENT__.data
  }
  if (window.microApp?.getData) {
    return window.microApp.getData()
  }
  return null
}

/**
 * 向主应用发送数据
 */
export function sendDataToMainApp(data: any) {
  if (window.microApp?.dispatch) {
    window.microApp.dispatch(data)
    console.log('[micro-app] 向主应用发送数据:', data)
  } else {
    console.warn('[micro-app] 无法向主应用发送数据，microApp 未初始化')
  }
}

/**
 * 监听主应用数据变化
 */
export function onMicroAppDataChange(callback: (data: any) => void) {
  if (window.microApp?.addDataListener) {
    window.microApp.addDataListener(callback)
    console.log('[micro-app] 已注册数据变化监听器')
  } else {
    console.warn('[micro-app] 无法注册数据监听器，microApp 未初始化')
  }
}

/**
 * 移除主应用数据变化监听
 */
export function offMicroAppDataChange(callback: (data: any) => void) {
  if (window.microApp?.removeDataListener) {
    window.microApp.removeDataListener(callback)
    console.log('[micro-app] 已移除数据变化监听器')
  }
}

/**
 * 检查是否在 micro-app 环境中
 */
export function isMicroApp(): boolean {
  return !!(window.__MICRO_APP_ENVIRONMENT__ || window.microApp)
}

