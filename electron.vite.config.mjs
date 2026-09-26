import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import rendererConfig from './vite.config.mjs'

// main/preload ห้ามใช้ require() — rollup bundle เฉพาะ import
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: rendererConfig
})
