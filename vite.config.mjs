// ค่าตั้งของ "หน้าจอ" (renderer) ล้วนๆ ใช้ 2 ที่:
//   1. `npm run dev:web` — vite อ่านไฟล์นี้ตรงๆ เปิดแค่หน้าเว็บในเบราว์เซอร์ ไม่มี Electron
//   2. electron.vite.config.mjs import ไปใช้เป็นส่วน renderer ของแอปจริง
// จงใจนิยามไว้ที่เดียว ไม่งั้นสองโหมดจะตั้งค่าคนละชุดแล้วเพี้ยนไม่ตรงกัน
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: 'src/renderer',
  build: {
    rollupOptions: {
      input: { index: resolve(__dirname, 'src/renderer/index.html') }
    }
  },
  plugins: [react()]
})
