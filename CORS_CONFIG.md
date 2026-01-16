# CORS 跨域配置说明

## 问题描述

当主应用和子应用运行在不同端口时（例如主应用在 `8086`，子应用在 `8076`），主应用加载子应用时会遇到 CORS 跨域问题。

## 解决方案

### 方案一：在子应用中配置 CORS（推荐）

已在 `vite.config.ts` 中配置了 CORS 支持：

```typescript
server: {
  cors: {
    origin: true, // 允许所有来源（开发环境）
    credentials: true, // 允许携带凭证
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  }
}
```

#### 开发环境配置

使用 `origin: true` 允许所有来源，适合开发环境：

```typescript
cors: {
  origin: true, // 允许所有来源
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}
```

#### 生产环境配置（推荐）

指定具体的主应用地址，更安全：

```typescript
cors: {
  origin: [
    'http://localhost:8086',           // 本地开发
    'http://192.168.3.13:8086',        // 内网地址
    'https://your-main-app-domain.com' // 生产环境主应用地址
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}
```

### 方案二：在主应用中配置代理

如果主应用使用 Vite，可以在主应用的 `vite.config.ts` 中配置代理：

```typescript
server: {
  proxy: {
    '/zhibo-live': {
      target: 'http://localhost:8076', // 子应用地址
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/zhibo-live/, '')
    }
  }
}
```

然后在主应用中加载子应用时使用相对路径：

```html
<micro-app 
  name="zhibo-live" 
  url="/zhibo-live"  <!-- 使用代理路径，而不是完整URL -->
  data="{{ ... }}"
></micro-app>
```

### 方案三：使用 Nginx 反向代理

如果使用 Nginx，可以配置反向代理：

```nginx
server {
    listen 8086;
    
    # 主应用
    location / {
        proxy_pass http://localhost:8080;
    }
    
    # 子应用代理
    location /zhibo-live {
        proxy_pass http://localhost:8076;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # WebSocket 支持
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## 验证步骤

1. **重启子应用开发服务器**：
   ```bash
   npm run dev
   ```

2. **检查响应头**：
   - 打开浏览器开发者工具
   - 切换到 Network 标签
   - 加载子应用资源
   - 查看响应头中是否包含：
     - `Access-Control-Allow-Origin: *` 或具体的主应用地址
     - `Access-Control-Allow-Credentials: true`
     - `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`

3. **测试加载**：
   - 在主应用中加载子应用
   - 检查控制台是否还有 CORS 错误

## 常见问题

### Q1: 仍然出现 CORS 错误？

**A:** 检查以下几点：
1. 确保已重启子应用开发服务器
2. 检查主应用的地址是否在 `origin` 列表中（如果使用了具体地址）
3. 检查浏览器控制台的完整错误信息

### Q2: 生产环境如何配置？

**A:** 生产环境建议：
1. 使用具体的 `origin` 列表，而不是 `true`
2. 确保主应用和子应用使用相同的域名（通过 Nginx 反向代理）
3. 或者使用相对路径加载子应用

### Q3: 需要支持 WebSocket 吗？

**A:** WebSocket 不受 CORS 限制，但需要确保：
1. 子应用的 Vite 代理配置正确（已在 `vite.config.ts` 中配置）
2. 主应用如果需要代理 WebSocket，也需要配置相应的代理

## 相关文件

- `vite.config.ts` - Vite 配置文件，包含 CORS 配置
- `PROXY_CONFIG.md` - WebSocket 代理配置说明
- `MAIN_APP_PROXY_CONFIG.md` - 主应用代理配置说明

