import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import fs from 'fs'
import path from 'path'

// 检查是否存在本地证书（用于 HTTPS）
const certPath = path.resolve(__dirname, 'localhost.pem')
const keyPath = path.resolve(__dirname, 'localhost-key.pem')

let httpsConfig: { cert: Buffer; key: Buffer } | false = false

// 如果存在证书文件，使用 HTTPS
if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  httpsConfig = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath)
  }
  console.log('✅ 找到 HTTPS 证书，启用 HTTPS')
} else {
  console.log('ℹ️  未找到 HTTPS 证书，使用 HTTP（某些浏览器可能限制摄像头访问）')
  console.log('💡 提示：可以运行 "npm run cert" 生成自签名证书')
}

// 从环境变量获取后端服务器地址，如果没有则使用默认值
// 可以通过 .env 文件设置：VITE_BACKEND_URL=http://192.168.3.20:8080
const backendUrl = process.env.VITE_BACKEND_URL || 'http://192.168.3.20:8080'

// 强制输出日志，确认配置文件是否被执行
console.log('='.repeat(50))
console.log('🚀 Vite 配置文件正在加载...')
console.log('🔗 后端服务器地址:', backendUrl)
console.log('📝 当前工作目录:', __dirname)
console.log('🌐 Node 环境变量 VITE_BACKEND_URL:', process.env.VITE_BACKEND_URL || '未设置')
console.log('='.repeat(50))

export default defineConfig({
  base: '/zhiboLive/', // 静态文件基础路径，用于部署到服务器的子目录
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    host: '0.0.0.0', // 监听所有网络接口，允许通过 IP 地址访问
    port: 8076, // 子应用端口：192.168.3.13:8076
    open: true,
    https: httpsConfig || undefined, // 如果存在证书，启用 HTTPS
    // 允许自签名证书
    ...(httpsConfig && {
      strictPort: false
    }),
    // 配置 CORS，允许主应用跨域加载子应用资源
    cors: {
      origin: true, // 允许所有来源（开发环境）
      // 或者指定具体的主应用地址（生产环境推荐）
      // origin: ['http://localhost:8086', 'http://192.168.3.13:8086'],
      credentials: true, // 允许携带凭证（cookies等）
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    },
    // 配置代理，将 WebSocket 和 API 请求代理到后端服务器
    proxy: {
      // 代理所有 /dev-api 路径的请求到后端服务器（主应用传递的代理路径）
      '/dev-api': {
        target: backendUrl, // 后端服务器地址（从环境变量或默认值获取）
        changeOrigin: true, // 改变请求头中的 origin
        secure: false, // 如果是 https 接口，需要配置这个参数
        ws: true, // 启用 WebSocket 代理（关键：必须启用）
        rewrite: (path) => {
          // 重写路径，去掉 /dev-api 前缀
          // 例如：/dev-api/ws/webSocket/117 -> /ws/webSocket/117
          const newPath = path.replace(/^\/dev-api/, '')
          console.log(`[Vite Proxy] ✅ 路径重写: ${path} -> ${newPath}`)
          return newPath
        },
        configure: (proxy, _options) => {
          // 监听所有代理请求（HTTP 和 WebSocket）
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log(`[Vite Proxy] 📡 HTTP 代理请求: ${req.method} ${req.url}`)
          })
          
          // 监听 WebSocket 升级请求
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            console.log(`[Vite Proxy] 🔌 WebSocket 代理请求: ${req.url}`)
            console.log(`[Vite Proxy] 🔌 目标地址: ${backendUrl}${req.url?.replace(/^\/dev-api/, '') || ''}`)
          })
          
          // 监听 WebSocket 连接成功
          proxy.on('open', (proxySocket) => {
            console.log('[Vite Proxy] ✅ WebSocket 代理连接已建立')
          })
          
          // 监听代理错误
          proxy.on('error', (err, req, res) => {
            console.error('[Vite Proxy] ❌ 代理错误:', err.message)
            console.error('[Vite Proxy] ❌ 请求 URL:', req.url)
            console.error('[Vite Proxy] ❌ 错误堆栈:', err.stack)
          })
          
          // 监听 WebSocket 错误
          proxy.on('proxyWs', (proxyReq, req, socket, head) => {
            console.log('[Vite Proxy] 🔌 WebSocket 代理处理中:', req.url)
          })
        }
      },
      // 代理所有 /api 路径的请求到后端服务器（兼容旧配置）
      '/dev-api': {
        target: backendUrl,
        changeOrigin: true,
        secure: false,
        ws: true, // 启用 WebSocket 代理
        rewrite: (path) => path.replace(/^\/api/, '') // 重写路径，去掉 /api 前缀
      },
      // 如果后端 WebSocket 路径是 /ws，也可以单独配置
      '/ws': {
        target: backendUrl,
        changeOrigin: true,
        secure: false,
        ws: true, // 启用 WebSocket 代理
        rewrite: (path) => path // 保持路径不变
      }
    }
  }
})



