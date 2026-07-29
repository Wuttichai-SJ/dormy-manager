import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import rendererConfig from './vite.config.mjs'

// externalizeDepsPlugin keeps native/runtime deps (better-sqlite3, bcrypt) OUT of the
// bundle so they load from node_modules against the correct Electron ABI at runtime.
//
// NOTE: main/ และ preload/ ถูก bundle ด้วย rollup ซึ่งไล่ตามเฉพาะ `import` เท่านั้น
// ห้ามเขียน require() ในโค้ดสองส่วนนั้น ไม่งั้นไฟล์ที่ถูก require จะไม่ถูก bundle
// แล้วแอปจะตายตอนบูตด้วย "Cannot find module"
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  // ใช้ค่าเดียวกับ `npm run dev:web` (ดู vite.config.mjs)
  renderer: rendererConfig
})
