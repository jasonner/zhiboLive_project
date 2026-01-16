# 配置文件执行检查

## 问题

`vite.config.ts` 中的 `console.log` 没有打印，说明配置文件可能没有被执行。

## 可能的原因

### 情况 1：应用通过主应用加载（最可能）

如果应用运行在 `localhost:8086`（而不是 Vite 默认的 `3000`），很可能是：

- **主应用在 `8086` 端口运行**
- **子应用通过 micro-app 框架加载**
- **子应用的 `vite.config.ts` 不会被执行**（因为主应用有自己的服务器）

**解决方案：**
- 代理需要在**主应用**配置，而不是子应用
- 子应用的 `vite.config.ts` 只在构建时或独立运行时生效

### 情况 2：应用独立运行但端口被修改

如果子应用独立运行但端口是 `8086`：

**检查方法：**
1. 查看启动命令的输出
2. 应该看到 Vite 的启动信息：
   ```
   VITE v4.x.x  ready in xxx ms
   ➜  Local:   http://localhost:8086/
   ```

**如果看到这个输出，说明配置文件应该被执行了**

### 情况 3：配置文件有语法错误

虽然 TypeScript 检查显示有类型错误，但这些不会阻止执行。真正的语法错误会阻止文件加载。

## 验证步骤

### 步骤 1：确认应用运行方式

**检查启动命令：**
- 如果通过 `npm run dev` 启动 → 应该看到 Vite 日志
- 如果通过主应用加载 → 不会看到 Vite 日志

**检查浏览器地址栏：**
- `http://localhost:3000` → 子应用独立运行
- `http://localhost:8086` → 可能是主应用

### 步骤 2：测试配置文件是否执行

我已经在 `vite.config.ts` 中添加了更明显的日志输出。请：

1. **完全停止当前服务器**（Ctrl+C）
2. **重新启动**：
   ```bash
   npm run dev
   ```
3. **查看控制台输出**，应该看到：
   ```
   ==================================================
   🚀 Vite 配置文件正在加载...
   🔗 后端服务器地址: http://192.168.3.20:8080
   📝 当前工作目录: ...
   🌐 Node 环境变量 VITE_BACKEND_URL: ...
   ==================================================
   ```

### 步骤 3：如果还是没有日志

**说明应用不是通过 Vite 独立运行的**，需要：

1. **在主应用配置代理**
   - 主应用需要配置 `/dev-api` 的代理
   - 代理目标：`http://192.168.3.20:8080`

2. **主应用代理配置示例**

   **如果主应用使用 Nginx：**
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

   **如果主应用使用 Node.js/Express：**
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

   **如果主应用使用 Vite：**
   ```typescript
   // 主应用的 vite.config.ts
   proxy: {
     '/dev-api': {
       target: 'http://192.168.3.20:8080',
       changeOrigin: true,
       ws: true,
       rewrite: (path) => path.replace(/^\/dev-api/, '')
     }
   }
   ```

## 快速判断

**请回答以下问题：**

1. 应用是通过 `npm run dev` 启动的吗？
   - ✅ 是 → 应该看到 Vite 日志
   - ❌ 否 → 代理需要在主应用配置

2. 浏览器地址栏显示的是什么？
   - `localhost:3000` → 子应用独立运行
   - `localhost:8086` → 可能是主应用

3. 启动时看到了什么日志？
   - 看到 `VITE v4.x.x ready` → Vite 正在运行
   - 只看到应用内容，没有 Vite 日志 → 通过主应用加载

## 下一步

根据你的回答：
- **如果是独立运行但没有日志** → 检查是否有其他配置文件或启动方式
- **如果是通过主应用加载** → 需要在主应用配置代理
