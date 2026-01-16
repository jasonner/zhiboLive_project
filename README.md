# 🎥 教师教学直播间

一个专注在线教学的互动直播间前端项目，支持作为 micro-app 微前端子应用运行。

## 技术栈

- Vue 3 + TypeScript
- Pinia (状态管理)
- Element Plus (UI组件库)
- WebRTC + WebSocket (实时通信)
- Fabric.js (白板功能)
- PDF.js (文档渲染)
- micro-app (微前端框架)

## 功能特性

- ✅ 课件管理（PPT、PDF、图片、音视频）
- ✅ 白板工具（画笔、图形、文字）
- ✅ 屏幕共享
- ✅ 实时聊天与答疑
- ✅ 学生举手功能
- ✅ 互动题（单选、多选、判断）
- ✅ 视频直播
- ✅ 课后回放

## 配置说明

### WebSocket 服务器地址配置

项目支持三种方式配置后端 WebSocket 地址（按优先级排序）：

1. **micro-app 主应用传递**（推荐）
   - 主应用通过 `data` 属性传递 `wsUrl` 参数
   ```javascript
   <micro-app 
     name="zhibo-live" 
     url="http://localhost:3000"
     data="{{ wsUrl: 'http://your-backend-server:port' }}"
   ></micro-app>
   ```

2. **环境变量配置**
   - 创建 `.env` 文件，设置 `VITE_WS_URL`
   ```bash
   VITE_WS_URL=http://your-backend-server:port
   ```

3. **默认值**（开发环境）
   - 如果以上都未配置，将使用 `http://localhost:3001`

### micro-app 集成

本项目已集成 micro-app，可以作为微前端子应用运行。

**主应用配置示例：**
```html
<micro-app 
  name="zhibo-live" 
  url="http://localhost:3000"
  data="{{ 
    wsUrl: 'http://your-backend-server:port',
    roomId: 'room-001',
    userId: 'user-001'
  }}"
></micro-app>
```

**主应用传递的数据字段：**
- `wsUrl` (可选): WebSocket 服务器地址，如果不提供将使用环境变量或默认值
- `roomId` (可选): 房间ID，如果不提供将使用默认值 `room-001`
- `userId` (可选): 用户ID，如果不提供将使用默认值（教师：`teacher-001`，学生：`student-{timestamp}`）

**子应用接收数据：**
- 通过 `src/utils/microApp.ts` 工具函数获取主应用传递的数据
- 数据会自动更新到 `window.__MICRO_APP_ENVIRONMENT__.data`

## 开发

```bash
npm install
npm run dev
```

**注意：** 项目不再需要单独启动 node 服务，WebSocket 连接将直接调用后端接口。

## 构建

```bash
npm run build
```

构建后的文件在 `dist` 目录，可以直接部署或作为 micro-app 子应用使用。















