# 开发指南

## 项目结构

```
zhibo_live/
├── src/
│   ├── components/          # 组件目录
│   │   ├── TopNavBar.vue   # 顶部导航栏
│   │   ├── ToolBar.vue     # 工具栏
│   │   ├── DocumentList.vue # 课件列表
│   │   ├── Whiteboard.vue  # 白板组件
│   │   ├── LiveVideo.vue   # 视频组件
│   │   ├── DocumentViewer.vue # 文档查看器
│   │   ├── ChatPanel.vue   # 聊天面板
│   │   ├── RaiseHand.vue   # 举手组件
│   │   └── QuizPanel.vue   # 互动题组件
│   ├── pages/              # 页面目录
│   │   ├── TeacherRoom.vue # 教师直播间
│   │   ├── StudentRoom.vue # 学生直播间
│   │   └── Summary.vue     # 直播总结页
│   ├── store/              # 状态管理
│   │   └── liveStore.ts    # 直播状态管理
│   ├── utils/              # 工具函数
│   │   ├── rtc.ts         # WebRTC 工具
│   │   └── signal.ts      # WebSocket 信令
│   ├── styles/             # 样式文件
│   │   ├── main.scss      # 主样式
│   │   └── variables.scss # 变量定义
│   └── router/             # 路由配置
│       └── index.ts
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000

### 3. 构建生产版本

```bash
npm run build
```

## 功能说明

### 教师端功能

1. **媒体控制**
   - 摄像头开关
   - 麦克风开关
   - 屏幕共享

2. **白板工具**
   - 画笔、橡皮、图形工具
   - 文字输入
   - 清空白板

3. **课件管理**
   - 上传课件（PPT、PDF、图片、音视频）
   - 切换课件展示

4. **互动管理**
   - 聊天管理（全体可发言/只看老师/全体禁言）
   - 学生举手审批
   - 创建互动题

### 学生端功能

1. **观看直播**
   - 观看老师视频
   - 查看课件内容
   - 观看白板绘制

2. **互动参与**
   - 发送聊天消息
   - 举手申请
   - 参与互动题

## 技术栈

- **Vue 3** - 前端框架
- **TypeScript** - 类型支持
- **Pinia** - 状态管理
- **Element Plus** - UI 组件库
- **WebRTC** - 实时音视频通信
- **WebSocket** - 信令服务
- **Fabric.js** - 白板绘制
- **PDF.js** - PDF 文档渲染

## 后端集成

项目需要配合后端 WebSocket 服务器使用。默认连接地址为 `http://localhost:3001`。

### WebSocket 事件

主要事件包括：
- `room:join` - 加入房间
- `room:leave` - 离开房间
- `chat:message` - 聊天消息
- `raise-hand:request` - 举手请求
- `quiz:create` - 创建互动题
- `whiteboard:draw` - 白板绘制
- `screen:start` - 开始屏幕共享

详细事件定义请参考 `src/utils/signal.ts`。

## 注意事项

1. **浏览器权限**
   - 需要允许摄像头和麦克风权限
   - 屏幕共享需要 HTTPS 环境（生产环境）

2. **WebRTC 服务器**
   - 需要配置 STUN/TURN 服务器
   - 默认使用 Google 公共 STUN 服务器

3. **文件上传**
   - 课件上传目前使用本地 URL
   - 生产环境需要上传到服务器

## 开发建议

1. 使用 TypeScript 严格模式
2. 遵循 Vue 3 Composition API 最佳实践
3. 组件保持单一职责
4. 状态管理使用 Pinia
5. 样式使用 SCSS 变量统一管理

