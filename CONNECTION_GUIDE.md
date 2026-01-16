# 子应用 WebSocket 连接指南

## 架构说明

- **主应用**：`192.168.3.13:8086`
- **子应用**：`192.168.3.13:8076`（独立运行，Vite 开发服务器）
- **后端服务**：`192.168.3.20:8080`

## 连接流程

### 1. WebSocket URL 构建

子应用会构建 WebSocket URL：
```
ws://192.168.3.13:8076/dev-api/ws/webSocket/{userId}?Authorization={token}
```

### 2. Vite 代理转发

子应用的 Vite 代理会将请求转发到后端：
```
ws://192.168.3.13:8076/dev-api/ws/webSocket/117?Authorization=...
  ↓ (Vite 代理)
ws://192.168.3.20:8080/ws/webSocket/117?Authorization=...
```

### 3. 配置说明

#### vite.config.ts 配置

```typescript
server: {
  port: 8076, // 子应用端口
  proxy: {
    '/dev-api': {
      target: 'http://192.168.3.20:8080', // 后端服务器
      changeOrigin: true,
      ws: true, // 启用 WebSocket 代理
      rewrite: (path) => path.replace(/^\/dev-api/, '') // 去掉 /dev-api 前缀
    }
  }
}
```

#### 主应用传递配置

主应用应该传递以下配置：

```javascript
<micro-app 
  name="zhibo-live" 
  url="http://192.168.3.13:8076"
  data="{{
    wsConfig: {
      basePath: '/dev-api',  // 代理路径
      userId: '117',
      token: 'your-token-here'
    },
    roomId: 'room-001',
    userId: 'user-001'
  }}"
></micro-app>
```

## 验证步骤

### 1. 启动子应用

```bash
npm run dev
```

应该看到：
```
==================================================
🚀 Vite 配置文件正在加载...
🔗 后端服务器地址: http://192.168.3.20:8080
📝 当前工作目录: C:\project\zhibo_live
🌐 Node 环境变量 VITE_BACKEND_URL: 未设置
==================================================
VITE v4.x.x  ready in xxx ms
➜  Local:   http://localhost:8076/
➜  Network: http://192.168.3.13:8076/
```

### 2. 检查 WebSocket 连接

打开浏览器开发者工具：

1. **Network 标签** → 筛选 WS（WebSocket）
2. **查看请求 URL**：应该是 `ws://192.168.3.13:8076/dev-api/ws/webSocket/...`
3. **查看状态**：应该是 `101 Switching Protocols`（连接成功）

### 3. 检查代理日志

在 Vite 开发服务器控制台，应该看到：
```
[Vite Proxy] 路径重写: /dev-api/ws/webSocket/117?Authorization=... -> /ws/webSocket/117?Authorization=...
[Vite Proxy] WebSocket 代理请求: /ws/webSocket/117?Authorization=...
```

### 4. 检查浏览器控制台

应该看到 SignalService 的日志：
```
[SignalService] 从 micro-app 主应用获取 wsConfig，构建 WebSocket URL: ws://192.168.3.13:8076/dev-api/ws/webSocket/117?Authorization=...
[SignalService] WebSocket 服务器地址: ws://192.168.3.13:8076/dev-api/ws/webSocket/117?Authorization=...
[SignalService] 正在连接 WebSocket: ws://192.168.3.13:8076/dev-api/ws/webSocket/117?Authorization=...
[SignalService] WebSocket 连接成功
```

## 故障排查

### 问题 1：看不到 Vite 配置日志

**原因**：配置文件没有执行

**解决**：
1. 确认应用是通过 `npm run dev` 启动的
2. 确认端口是 `8076`
3. 完全重启开发服务器

### 问题 2：WebSocket 连接失败

**检查清单**：
- [ ] Vite 代理配置正确（`/dev-api`，`ws: true`）
- [ ] 后端服务器可访问（`192.168.3.20:8080`）
- [ ] 网络防火墙允许连接
- [ ] 查看 Vite 控制台的代理日志
- [ ] 查看浏览器控制台的错误信息

### 问题 3：代理没有转发

**检查**：
1. 查看 Vite 控制台是否有 `[Vite Proxy]` 日志
2. 如果没有，说明请求没有匹配到代理规则
3. 确认 WebSocket URL 路径以 `/dev-api` 开头

## 环境变量配置（可选）

如果需要通过环境变量配置后端地址，创建 `.env` 文件：

```bash
# 后端服务器地址
VITE_BACKEND_URL=http://192.168.3.20:8080
```

## 总结

✅ **已完成的配置：**
- 子应用端口：`8076`
- Vite 代理：`/dev-api` → `http://192.168.3.20:8080`
- WebSocket 代理已启用
- 路径重写已配置

📝 **主应用需要传递：**
- `basePath: '/dev-api'`
- `userId` 和 `token`

🔍 **验证方法：**
- 查看 Vite 启动日志
- 查看浏览器 Network 标签
- 查看 Vite 代理日志
- 查看浏览器控制台日志
