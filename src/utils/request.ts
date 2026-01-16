/**
 * Axios 请求封装
 * 自动从主应用获取 token 并添加到请求头
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios'
import { getMicroAppData } from './microApp'

// 响应数据接口
export interface ApiResponse<T = any> {
  code: number
  message: string
  data: T
}

// 创建 axios 实例
const service: AxiosInstance = axios.create({
  baseURL: '/dev-api', // 使用 Vite 代理路径
  timeout: 30000, // 请求超时时间 30秒
  headers: {
    'Content-Type': 'application/json;charset=UTF-8'
  }
})

/**
 * 从主应用获取 token
 */
function getToken(): string | null {
  try {
    const microAppData = getMicroAppData()
    // 从主应用传递的 wsConfig 中获取 token
    if (microAppData?.wsConfig?.token) {
      return microAppData.wsConfig.token
    }
    // 兼容其他可能的 token 传递方式
    if (microAppData?.token) {
      return microAppData.token
    }
    return null
  } catch (error) {
    console.warn('[request] 获取 token 失败:', error)
    return null
  }
}

/**
 * 请求拦截器
 */
service.interceptors.request.use(
  (config: AxiosRequestConfig) => {
    // 从主应用获取 token 并添加到请求头
    const token = getToken()
    if (token && config.headers) {
      config.headers['Authorization'] =  'Bearer ' +token
    }

    // 打印请求信息（开发环境）
    if (import.meta.env.DEV) {
      console.log('[request] 请求:', {
        method: config.method?.toUpperCase(),
        url: config.url,
        headers: config.headers
      })
    }

    return config
  },
  (error: AxiosError) => {
    console.error('[request] 请求拦截器错误:', error)
    return Promise.reject(error)
  }
)

/**
 * 响应拦截器
 */
service.interceptors.response.use(
  (response: AxiosResponse<ApiResponse>) => {
    const res = response.data

    // 如果后端返回的状态码不是成功状态，则视为错误
    // 这里根据实际后端接口规范调整
    if (res.code && res.code !== 200 && res.code !== 0) {
      console.error('[request] 接口返回错误:', res.message || '未知错误')
      
      // 可以根据不同的错误码进行不同的处理
      // 例如：401 未授权，403 禁止访问，500 服务器错误等
      if (res.code === 401) {
        console.warn('[request] 未授权，可能需要重新登录')
        // 可以在这里触发登录逻辑
      }

      return Promise.reject(new Error(res.message || '请求失败'))
    }

    // 返回数据
    return res
  },
  (error: AxiosError) => {
    console.error('[request] 响应错误:', error)

    // 处理 HTTP 错误状态码
    if (error.response) {
      const { status, data } = error.response
      
      switch (status) {
        case 401:
          console.error('[request] 401 未授权，token 可能已过期')
          break
        case 403:
          console.error('[request] 403 禁止访问，没有权限')
          break
        case 404:
          console.error('[request] 404 请求的资源不存在')
          break
        case 500:
          console.error('[request] 500 服务器内部错误')
          break
        default:
          console.error(`[request] HTTP 错误 ${status}:`, data)
      }
    } else if (error.request) {
      console.error('[request] 请求已发出，但没有收到响应:', error.request)
    } else {
      console.error('[request] 请求配置错误:', error.message)
    }

    return Promise.reject(error)
  }
)

/**
 * GET 请求
 */
export function get<T = any>(url: string, params?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
  return service.get(url, { params, ...config })
}

/**
 * POST 请求
 */
export function post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
  return service.post(url, data, config)
}

/**
 * PUT 请求
 */
export function put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
  return service.put(url, data, config)
}

/**
 * DELETE 请求
 */
export function del<T = any>(url: string, params?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
  return service.delete(url, { params, ...config })
}

/**
 * PATCH 请求
 */
export function patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<ApiResponse<T>> {
  return service.patch(url, data, config)
}

/**
 * 导出 axios 实例，以便需要时直接使用
 */
export default service

