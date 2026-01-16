/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WS_URL?: string
  readonly VITE_API_URL?: string
  readonly VITE_BACKEND_URL?: string // 后端服务器地址（用于 Vite 代理）
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}















