# WebSocket 代理配置说明

## 问题背景

当子应用需要连接后端 WebSocket 服务时，可能会遇到以下问题：

1. **跨域问题**：直接访问后端服务器（如 `http://192.168.3.20:8080`）会遇到跨域限制
2. **代理地址不匹配**：主应用传递的代理地址（如 `http://localhost:8086`）是主应用的代理，子应用无法直接使用

## 解决方案

### 方案一：使用 Vite 代理（推荐）

在子应用中配置 Vite 代理，将 WebSocket 请求代理到后端服务器。

#### 1. 配置 Vite 代理

在 `vite.config.ts` 中已经配置了代理：

```typescript
proxy: {
  '/api': {
    target: 'http://192.168.3.20:8080', // 后端服务器地址
    changeOrigin: true,
    secure: false,
    ws: true, // 启用 WebSocket 代理
    rewrite: (path) => path.replace(/^\/api/, '')
  },
  '/ws': {
    target: 'http://192.168.3.20:8080',
    changeOrigin: true,
    secure: false,
    ws: true,
    rewrite: (path) => path
  }
}
```

#### 2. 通过环境变量配置后端地址

创建 `.env` 文件（或 `.env.local`）：

```bash
# 后端服务器地址
VITE_BACKEND_URL=http://192.168.3.20:8080
```

#### 3. 主应用传递配置

主应用应该传递 `basePath`（代理路径），而不是完整的 URL：

```javascript
<micro-app 
  name="zhibo-live" 
  url="http://localhost:3000"
  data="{{
    wsConfig: {
      basePath: '/api',  // 子应用的代理路径
      userId: '123',
      token: 'your-token'
    },
    roomId: 'room-001',
    userId: 'user-001'
  }}"
></micro-app>
```

#### 4. WebSocket URL 构建逻辑

子应用会自动构建 WebSocket URL：

```
ws://localhost:3000/api/ws/webSocket/123?Authorization=your-token
```

这个 URL 会通过 Vite 代理转发到：

```
ws://192.168.3.20:8080/ws/webSocket/123?Authorization=your-token
```

### 方案二：主应用传递完整代理路径

如果主应用传递的是完整的代理地址（如 `http://localhost:8086`），子应用会自动提取路径部分：

```javascript
<micro-app 
  name="zhibo-live" 
  url="http://localhost:3000"
  data="{{
    wsConfig: {
      basePath: '/api',
      proxyUrl: 'http://localhost:8086',  // 主应用的代理地址（仅用于提取路径）
      userId: '123',
      token: 'your-token'
    }
  }}"
></micro-app>
```

子应用会：
1. 提取 `proxyUrl` 的路径部分
2. 使用当前页面（子应用）的 host
3. 构建 WebSocket URL

### 方案三：使用环境变量

如果不想通过主应用传递，可以直接在子应用中配置：

创建 `.env` 文件：

```bash
# WebSocket 服务器地址（完整 URL）
VITE_WS_URL=ws://192.168.3.20:8080/ws/webSocket

# 或者后端服务器地址（用于代理）
VITE_BACKEND_URL=http://192.168.3.20:8080
```

## 配置示例

### 开发环境

**主应用配置：**
```javascript
<micro-app 
  name="zhibo-live" 
  url="http://localhost:3000"
  data="{{
    wsConfig: {
      basePath: '/api',
      userId: '123',
      token: 'your-token-here'
    }
  }}"
></micro-app>
```

**子应用 `.env`：**
```bash
VITE_BACKEND_URL=http://192.168.3.20:8080
```

**最终 WebSocket URL：**
```
ws://localhost:3000/api/ws/webSocket/123?Authorization=your-token-here
```

### 生产环境

**主应用配置：**
```javascript
<micro-app 
  name="zhibo-live" 
  url="https://your-domain.com"
  data="{{
    wsConfig: {
      basePath: '/api',
      userId: '123',
      token: 'your-token-here'
    }
  }}"
></micro-app>
```

**子应用构建时配置：**
```bash
VITE_BACKEND_URL=https://backend.your-domain.com
```

**最终 WebSocket URL：**
```
wss://your-domain.com/api/ws/webSocket/123?Authorization=your-token-here
```

## 注意事项

1. **代理路径匹配**：确保 Vite 代理配置的路径（如 `/api`）与主应用传递的 `basePath` 一致
2. **WebSocket 协议**：子应用会自动根据当前页面协议（http/https）选择 ws/wss
3. **跨域问题**：通过 Vite 代理可以解决跨域问题，因为请求是从子应用本地发出的
4. **环境变量**：`.env` 文件不会被提交到版本控制，每个环境可以有不同的配置

## 调试

如果连接失败，检查以下几点：

1. **查看控制台日志**：SignalService 会输出详细的连接信息
2. **检查代理配置**：确认 `vite.config.ts` 中的代理配置正确
3. **检查后端地址**：确认 `VITE_BACKEND_URL` 环境变量设置正确
4. **检查网络**：确认子应用可以访问后端服务器

## 常见问题

### Q: 为什么使用子应用的 host 而不是主应用的代理地址？

A: 因为代理是在子应用本地（Vite 开发服务器）配置的，所以 WebSocket 连接应该指向子应用的地址，然后由 Vite 代理转发到后端。

### Q: 主应用传递的代理地址有什么用？

A: 主应用传递的代理地址主要用于提取路径信息。如果主应用和子应用使用相同的代理路径结构，可以确保配置一致。

### Q: 生产环境如何配置？

A: 生产环境通常使用 Nginx 等反向代理服务器。需要在 Nginx 中配置 WebSocket 代理，而不是在 Vite 中配置（因为 Vite 只在开发环境生效）。
