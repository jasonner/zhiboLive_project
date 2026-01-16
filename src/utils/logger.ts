/**
 * 日志工具 - 生产环境自动关闭调试日志
 */
const isDevelopment = import.meta.env.DEV

class Logger {
  private enabled = isDevelopment

  log(...args: any[]) {
    if (this.enabled) {
      console.log(...args)
    }
  }

  warn(...args: any[]) {
    if (this.enabled) {
      console.warn(...args)
    }
  }

  error(...args: any[]) {
    // 错误日志始终输出
    console.error(...args)
  }

  info(...args: any[]) {
    if (this.enabled) {
      console.info(...args)
    }
  }

  debug(...args: any[]) {
    if (this.enabled) {
      console.debug(...args)
    }
  }
}

export const logger = new Logger()
