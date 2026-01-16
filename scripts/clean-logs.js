/**
 * 清理日志脚本 - 将 console.log/warn/info 替换为 logger，保留 console.error
 * 使用方法: node scripts/clean-logs.js
 */

const fs = require('fs')
const path = require('path')

const filesToClean = [
  'src/pages/StudentRoom.vue',
  'src/utils/signal.ts',
  'src/utils/rtc.ts',
  'src/components/LiveVideo.vue',
  'src/pages/TeacherRoom.vue'
]

function cleanLogs(filePath) {
  const fullPath = path.join(process.cwd(), filePath)
  if (!fs.existsSync(fullPath)) {
    console.log(`文件不存在: ${filePath}`)
    return
  }

  let content = fs.readFileSync(fullPath, 'utf-8')
  let modified = false

  // 检查是否已导入 logger
  if (!content.includes("import { logger }")) {
    // 查找最后一个 import 语句
    const importMatch = content.match(/(import[^;]+;[\s\n]*)+/g)
    if (importMatch) {
      const lastImport = importMatch[importMatch.length - 1]
      const loggerImport = "import { logger } from '@/utils/logger'\n"
      if (!content.includes(loggerImport)) {
        content = content.replace(lastImport, lastImport + loggerImport)
        modified = true
      }
    }
  }

  // 替换 console.log -> logger.log
  if (content.includes('console.log')) {
    content = content.replace(/console\.log\(/g, 'logger.log(')
    modified = true
  }

  // 替换 console.warn -> logger.warn
  if (content.includes('console.warn')) {
    content = content.replace(/console\.warn\(/g, 'logger.warn(')
    modified = true
  }

  // 替换 console.info -> logger.info
  if (content.includes('console.info')) {
    content = content.replace(/console\.info\(/g, 'logger.info(')
    modified = true
  }

  // 替换 console.debug -> logger.debug
  if (content.includes('console.debug')) {
    content = content.replace(/console\.debug\(/g, 'logger.debug(')
    modified = true
  }

  // console.error 保持不变（始终输出）

  if (modified) {
    fs.writeFileSync(fullPath, content, 'utf-8')
    console.log(`✅ 已清理: ${filePath}`)
  } else {
    console.log(`⏭️  跳过: ${filePath} (无需修改)`)
  }
}

console.log('开始清理日志...\n')
filesToClean.forEach(cleanLogs)
console.log('\n清理完成！')
