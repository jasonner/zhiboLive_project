# WebSocket 代理问题排查指南

## 问题：看不到 [Vite Proxy] 日志

### 可能的原因

1. **WebSocket 请求没有到达 Vite 服务器**
   - 请求可能直接到了主应用（8086）而不是子应用（8076）
   - 检查浏览器 Network 标签中的 WebSocket 请求 URL

2. **请求路径不匹配代理规则**
   - 代理规则是 `/dev-api`
   - 但实际请求路径可能不是以 `/dev-api` 开头

3. **Vite 服务器没有运行或配置未生效**
   - 需要重启开发服务器
   - 确认配置文件被执行

## 诊断步骤

### 步骤 1：确认 Vite 服务器运行状态

**检查启动日志：**
```bash
npm run dev
```

应该看到：
```
==================================================
🚀 Vite 配置文件正在加载...
🔗 后端服务器地址: http://192.168.3.20:8080
==================================================
VITE v4.x.x  ready in xxx ms
➜  Local:   http://localhost:8076/
➜  Network: http://192.168.3.13:8076/
```

**如果没有看到这些日志：**
- 配置文件没有被执行
- 检查是否有其他启动方式

### 步骤 2：检查浏览器中的 WebSocket URL

**打开浏览器开发者工具：**
1. Network 标签
2. 筛选 WS（WebSocket）
3. 查看请求 URL

**应该看到：**
```
ws://192.168.3.13:8076/dev-api/ws/webSocket/117?Authorization=...
```

**如果看到的是：**
- `ws://192.168.3.13:8086/...` → 请求到了主应用，不是子应用
- `ws://192.168.3.20:8080/...` → 直接连接后端，没有经过代理
- 路径不是 `/dev-api` 开头 → 路径不匹配代理规则

### 步骤 3：检查浏览器控制台日志

**应该看到 SignalService 的日志：**
```
[SignalService] ========== WebSocket 连接信息 ==========
[SignalService] WebSocket 服务器地址: ws://192.168.3.13:8076/dev-api/ws/webSocket/117?Authorization=...
[SignalService] 当前页面 host: 192.168.3.13:8076
[SignalService] 是否匹配 /dev-api 路径: true
[SignalService] =========================================
[SignalService] 正在连接 WebSocket: ws://192.168.3.13:8076/dev-api/ws/webSocket/117?Authorization=...
```

**关键检查点：**
- `当前页面 host` 应该是 `192.168.3.13:8076`（子应用）
- `是否匹配 /dev-api 路径` 应该是 `true`
- WebSocket URL 应该包含 `/dev-api`

### 步骤 4：检查 Vite 服务器控制台

**当 WebSocket 连接时，应该看到：**
```
[Vite Proxy] ✅ 路径重写: /dev-api/ws/webSocket/117?Authorization=... -> /ws/webSocket/117?Authorization=...
[Vite Proxy] 🔌 WebSocket 代理请求: /ws/webSocket/117?Authorization=...
[Vite Proxy] 🔌 目标地址: http://192.168.3.20:8080/ws/webSocket/117?Authorization=...
```

**如果没有看到这些日志：**
- 请求没有到达 Vite 服务器
- 或者请求路径不匹配 `/dev-api`

## 常见问题及解决方案

### 问题 1：请求到了主应用（8086）而不是子应用（8076）

**原因：**
- WebSocket URL 使用了错误的 host
- 主应用传递的配置导致使用了主应用的地址

**解决：**
检查 SignalService 构建的 URL，确保使用 `window.location.host`（子应用的 host）

### 问题 2：请求路径不包含 `/dev-api`

**原因：**
- 主应用传递的 `basePath` 不正确
- 或者 URL 构建逻辑有问题

**解决：**
1. 检查主应用传递的配置：
   ```javascript
   wsConfig: {
     basePath: '/dev-api',  // 必须包含 /dev-api
     userId: '117',
     token: '...'
   }
   ```

2. 检查浏览器控制台的 SignalService 日志，确认 `basePath` 是否正确

### 问题 3：Vite 代理配置未生效

**原因：**
- 配置文件有语法错误
- 服务器没有重启

**解决：**
1. 完全停止服务器（Ctrl+C）
2. 重新启动：`npm run dev`
3. 确认看到了配置加载日志

### 问题 4：WebSocket 直接连接后端

**原因：**
- 主应用传递了完整的后端 URL
- 或者环境变量配置了直接连接

**解决：**
- 确保主应用传递的是 `basePath`（如 `/dev-api`），而不是完整 URL
- 确保环境变量 `VITE_WS_URL` 没有设置（如果设置了，会优先使用）

## 调试命令

### 测试代理是否工作

在浏览器控制台运行：
```javascript
// 测试 HTTP 代理（如果后端有 HTTP 接口）
fetch('http://192.168.3.13:8076/dev-api/test')
  .then(r => r.text())
  .then(console.log)
  .catch(console.error)
```

在 Vite 控制台应该看到：
```
[Vite Proxy] 📡 HTTP 代理请求: GET /dev-api/test
```

### 检查当前配置

在浏览器控制台运行：
```javascript
// 检查当前页面信息
console.log('当前 host:', window.location.host)
console.log('当前协议:', window.location.protocol)
console.log('完整 URL:', window.location.href)
```

## 下一步

根据诊断结果：

1. **如果请求到了主应用（8086）**
   - 需要在主应用配置代理
   - 或者修改 SignalService 的 URL 构建逻辑

2. **如果请求路径不匹配**
   - 检查主应用传递的 `basePath`
   - 检查 SignalService 的 URL 构建逻辑

3. **如果请求到了子应用但没有代理日志**
   - 检查 Vite 代理配置
   - 确认 `ws: true` 已启用
   - 检查路径匹配规则

4. **如果看到了代理日志但连接失败**
   - 检查后端服务器是否可访问
   - 检查网络防火墙
   - 查看代理错误日志




