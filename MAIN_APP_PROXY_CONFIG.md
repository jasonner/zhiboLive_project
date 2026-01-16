# 主应用 WebSocket 代理配置指南

## 问题分析

根据日志分析：

1. **子应用运行在主应用上下文中**
   - 浏览器地址：`http://localhost:8086/teacher`
   - 当前页面 host：`localhost:8086`（主应用）
   - WebSocket 请求：`ws://localhost:8086/dev-api/ws/webSocket/117?Authorization=...`

2. **子应用的 Vite 代理不会生效**
   - 子应用运行在 `192.168.3.13:8076`（Vite 开发服务器）
   - 但子应用代码在主应用（`8086`）的上下文中执行
   - WebSocket 请求发送到主应用，不会到达子应用的 Vite 服务器

3. **解决方案：在主应用配置代理**
   - 主应用需要配置 `/dev-api` 的代理
   - 代理目标：`http://192.168.3.20:8080`

## 主应用代理配置

### 方案 1：主应用使用 Vite（推荐）

如果主应用也使用 Vite，在主应用的 `vite.config.ts` 中添加：

```typescript
export default defineConfig({
  server: {
    port: 8086,
    proxy: {
      '/dev-api': {
        target: 'http://192.168.3.20:8080', // 后端服务器地址
        changeOrigin: true,
        secure: false,
        ws: true, // 启用 WebSocket 代理（关键）
        rewrite: (path) => {
          // 去掉 /dev-api 前缀
          // /dev-api/ws/webSocket/117 -> /ws/webSocket/117
          const newPath = path.replace(/^\/dev-api/, '')
          console.log(`[主应用代理] 路径重写: ${path} -> ${newPath}`)
          return newPath
        },
        configure: (proxy, _options) => {
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            console.log(`[主应用代理] WebSocket 代理请求: ${req.url}`)
            console.log(`[主应用代理] 目标: http://192.168.3.20:8080${req.url?.replace(/^\/dev-api/, '') || ''}`)
          })
          proxy.on('error', (err, req, res) => {
            console.error('[主应用代理] 代理错误:', err.message)
          })
        }
      }
    }
  }
})
```

### 方案 2：主应用使用 Node.js/Express

如果主应用使用 Express，安装并配置：

```bash
npm install http-proxy-middleware
```

```javascript
const express = require('express')
const { createProxyMiddleware } = require('http-proxy-middleware')

const app = express()

// 配置 /dev-api 代理
app.use('/dev-api', createProxyMiddleware({
  target: 'http://192.168.3.20:8080',
  changeOrigin: true,
  ws: true, // 启用 WebSocket 代理（关键）
  pathRewrite: {
    '^/dev-api': '' // 去掉 /dev-api 前缀
  },
  onProxyReqWs: (proxyReq, req, socket) => {
    console.log(`[主应用代理] WebSocket 代理请求: ${req.url}`)
  },
  onError: (err, req, res) => {
    console.error('[主应用代理] 代理错误:', err.message)
  }
}))

app.listen(8086, () => {
  console.log('主应用运行在 http://localhost:8086')
})
```

### 方案 3：主应用使用 Nginx

如果主应用使用 Nginx，在配置文件中添加：

```nginx
server {
    listen 8086;
    server_name localhost;

    # 其他配置...

    # WebSocket 代理配置
    location /dev-api {
        proxy_pass http://192.168.3.20:8080;
        proxy_http_version 1.1;
        
        # WebSocket 升级请求头（关键）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # 标准代理头
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket 超时设置
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

### 方案 4：主应用使用其他框架

根据主应用使用的框架，配置相应的代理中间件，确保：
- 路径匹配：`/dev-api`
- 目标地址：`http://192.168.3.20:8080`
- 启用 WebSocket 代理
- 路径重写：去掉 `/dev-api` 前缀

## 验证配置

### 1. 重启主应用服务器

配置完成后，重启主应用服务器。

### 2. 检查代理日志

当 WebSocket 连接时，主应用服务器控制台应该看到：
```
[主应用代理] WebSocket 代理请求: /ws/webSocket/117?Authorization=...
```

### 3. 检查浏览器 Network

打开浏览器开发者工具 → Network → WS，查看：
- 请求 URL：`ws://localhost:8086/dev-api/ws/webSocket/...`
- 状态：应该是 `101 Switching Protocols`（连接成功）

### 4. 检查浏览器控制台

应该看到：
```
[SignalService] WebSocket 连接成功
```

## 常见问题

### Q: 为什么子应用的 Vite 代理不工作？

A: 因为子应用代码在主应用的上下文中执行，WebSocket 请求发送到主应用（`8086`），而不是子应用的 Vite 服务器（`8076`）。

### Q: 子应用的 vite.config.ts 还有用吗？

A: 如果子应用独立运行（直接访问 `192.168.3.13:8076`），Vite 代理会工作。但如果通过主应用加载，需要在主应用配置代理。

### Q: 如何判断需要在主应用还是子应用配置代理？

A: 
- 如果浏览器地址栏是 `localhost:8086` → 在主应用配置
- 如果浏览器地址栏是 `localhost:8076` → 在子应用配置（Vite）

## 配置检查清单

- [ ] 主应用已配置 `/dev-api` 代理
- [ ] 代理目标设置为 `http://192.168.3.20:8080`
- [ ] 启用了 WebSocket 代理（`ws: true` 或相应的配置）
- [ ] 配置了路径重写（去掉 `/dev-api` 前缀）
- [ ] 主应用服务器已重启
- [ ] 测试 WebSocket 连接成功

## 下一步

1. **在主应用配置代理**（根据主应用使用的技术栈选择对应方案）
2. **重启主应用服务器**
3. **测试 WebSocket 连接**
4. **查看主应用服务器日志**，确认代理请求被处理




