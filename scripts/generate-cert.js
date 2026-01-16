/**
 * 生成自签名 HTTPS 证书（用于开发环境）
 * 需要安装 mkcert: https://github.com/FiloSottile/mkcert
 * 或者使用 openssl
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const certPath = path.resolve(__dirname, '../localhost.pem')
const keyPath = path.resolve(__dirname, '../localhost-key.pem')

console.log('🔐 生成 HTTPS 自签名证书...')

try {
  // 方法1: 使用 openssl（大多数系统都有）
  console.log('使用 openssl 生成证书...')
  
  // 生成私钥
  execSync(`openssl genrsa -out "${keyPath}" 2048`, { stdio: 'inherit' })
  
  // 生成证书
  execSync(
    `openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 365 -subj "/C=CN/ST=State/L=City/O=Organization/CN=localhost"`,
    { stdio: 'inherit' }
  )
  
  console.log('✅ 证书生成成功！')
  console.log(`   证书文件: ${certPath}`)
  console.log(`   私钥文件: ${keyPath}`)
  console.log('\n⚠️  这是自签名证书，浏览器会显示"不安全"警告，这是正常的。')
  console.log('   点击"高级" -> "继续访问"即可。')
} catch (error) {
  console.error('❌ 证书生成失败:', error.message)
  console.log('\n💡 替代方案：')
  console.log('   1. 安装 mkcert: https://github.com/FiloSottile/mkcert')
  console.log('   2. 运行: mkcert localhost 192.168.x.x (你的IP)')
  console.log('   3. 或者使用: npm run dev:https (Vite 会自动生成临时证书)')
  process.exit(1)
}
















