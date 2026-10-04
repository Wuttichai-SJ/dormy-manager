// ค่าตั้งของ renderer — ใช้ทั้ง npm run dev:web และ electron.vite.config.mjs
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { readFileSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

export default defineConfig({
  root: 'src/renderer',
  // เลขรุ่นจาก package.json ฝังลง renderer ตอน build — ใช้ผ่าน APP_VERSION ใน constants.js
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    rollupOptions: {
      input: { index: resolve(__dirname, 'src/renderer/index.html') }
    }
  },
  plugins: [react()]
})
