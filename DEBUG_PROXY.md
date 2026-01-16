# WebSocket 代理调试指南

## 问题诊断

根据网络请求截图，WebSocket 连接请求到：
```
ws://localhost:8086/dev-api/ws/webSocket/117?Authorization=...
```

但连接无响应。可能的原因：

1. **代理路径未配置**：已修复 ✅
2. **应用端口不匹配**：请求到 `8086`，但 Vite 默认是 `3000`
3. **代理未生效**：需要重启开发服务器

## 解决方案

### 1. 确认应用运行端口

检查你的应用实际运行在哪个端口：

**如果应用运行在 `localhost:8086`：**
- 可能是主应用在 `8086` 端口
- 子应用可能通过主应用加载，代理需要在主应用配置
- 或者子应用被配置为运行在 `8086` 端口

**如果子应用独立运行（Vite 开发服务器）：**
- 默认端口是 `3000`
- 可以通过环境变量或命令行参数修改

### 2. 验证代理配置

#### 方式 A：子应用独立运行（Vite）

如果子应用通过 `npm run dev` 独立运行：

1. **确认 Vite 配置已更新**
   - 检查 `vite.config.ts` 中是否有 `/dev-api` 代理配置
   - 确认 `ws: true` 已启用

2. **重启开发服务器**
   ```bash
   # 停止当前服务器（Ctrl+C）
   # 重新启动
   npm run dev
   ```

3. **检查控制台输出**
   - 启动时应该看到：`🔗 后端服务器地址: http://192.168.3.20:8080`
   - WebSocket 连接时应该看到：`[Vite Proxy] 路径重写: ...`

4. **验证代理是否生效**
   - 打开浏览器开发者工具
   - 查看 Network 标签
   - 检查 WebSocket 请求是否被代理转发

#### 方式 B：子应用通过主应用加载

如果子应用是通过主应用（`localhost:8086`）加载的微前端：

1. **主应用需要配置代理**
   - 主应用（运行在 `8086`）需要配置 `/dev-api` 的代理
   - 代理目标：`http://192.168.3.20:8080`

2. **主应用代理配置示例（Nginx）**
   ```nginx
   location /dev-api {
       proxy_pass http://192.168.3.20:8080;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
   }
   ```

3. **主应用代理配置示例（Node.js/Express）**
   ```javascript
   const { createProxyMiddleware } = require('http-proxy-middleware');
   
   app.use('/dev-api', createProxyMiddleware({
     target: 'http://192.168.3.20:8080',
     changeOrigin: true,
     ws: true, // 启用 WebSocket 代理
     pathRewrite: {
       '^/dev-api': '' // 去掉 /dev-api 前缀
     }
   }));
   ```

### 3. 修改子应用端口（如果需要）

如果子应用需要运行在 `8086` 端口：

**方式 1：修改 vite.config.ts**
```typescript
server: {
  port: 8086, // 改为 8086
  // ...
}
```

**方式 2：使用环境变量**
```bash
# .env 文件
VITE_PORT=8086
```

**方式 3：命令行参数**
```bash
npm run dev -- --port 8086
```

### 4. 调试步骤

1. **检查后端服务是否可访问**
   ```bash
   # 使用 curl 测试后端 WebSocket（需要支持 WebSocket 的工具）
   # 或者使用 Postman 测试（你已经验证可以连接）
   ```

2. **检查代理日志**
   - 查看 Vite 开发服务器控制台
   - 应该看到 `[Vite Proxy]` 相关的日志
   - 如果有错误，会显示 `[Vite Proxy] 代理错误: ...`

3. **检查网络请求**
   - 打开浏览器开发者工具
   - Network 标签 → 筛选 WS（WebSocket）
   - 查看请求详情：
     - Request URL 是否正确
     - Status 是什么（101 Switching Protocols 表示成功）
     - 是否有错误信息

4. **检查 SignalService 日志**
   - 打开浏览器控制台
   - 查看 `[SignalService]` 相关的日志
   - 确认 WebSocket URL 构建正确

### 5. 常见问题

#### Q: 为什么 Postman 能连接，但浏览器不能？

A: Postman 直接连接到后端服务器，不经过代理。浏览器需要通过代理，所以需要确保代理配置正确。

#### Q: 代理配置了，但还是连接不上？

A: 检查以下几点：
1. 是否重启了开发服务器？
2. 代理路径是否匹配（`/dev-api`）？
3. `ws: true` 是否启用？
4. 后端服务器地址是否正确？

#### Q: 如何确认代理是否生效？

A: 查看 Vite 开发服务器控制台，应该看到：
```
[Vite Proxy] 路径重写: /dev-api/ws/webSocket/117 -> /ws/webSocket/117
[Vite Proxy] WebSocket 代理请求: /ws/webSocket/117?Authorization=...
```

### 6. 测试代理配置

创建一个测试脚本来验证代理：

```bash
# 测试 HTTP 代理（如果后端有 HTTP 接口）
curl http://localhost:8086/dev-api/some-endpoint

# 应该被代理到：http://192.168.3.20:8080/some-endpoint
```

## 当前配置状态

✅ **已完成的配置：**
- 添加了 `/dev-api` 代理配置
- 启用了 WebSocket 代理（`ws: true`）
- 配置了路径重写（去掉 `/dev-api` 前缀）
- 添加了代理日志输出

⚠️ **需要确认：**
- 应用实际运行端口（`8086` vs `3000`）
- 代理是否在主应用还是子应用配置
- 是否已重启开发服务器

## 下一步操作

1. **重启开发服务器**（如果子应用独立运行）
2. **检查主应用代理配置**（如果子应用通过主应用加载）
3. **查看控制台日志**，确认代理是否生效
4. **测试 WebSocket 连接**，查看 Network 标签中的详细信息
