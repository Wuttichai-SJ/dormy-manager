// Electron บน Windows เป็น GUI subsystem — console.log/error ของ main process
// "ไม่" ไปโผล่ใน terminal ที่รัน npm run dev เลย แปลว่าถ้าแอปพังฝั่ง main
// เราจะไม่เห็นอะไรทั้งสิ้น (แอปดับเงียบ) ทุกอย่างจึงต้องเขียนลงไฟล์ด้วยเสมอ
//
// ตอนส่งมอบจริงยิ่งจำเป็น: เจ้าของหอไม่มีทางเปิด DevTools อ่าน error ให้เรา
// เวลามีปัญหาให้สั่งเขาส่งไฟล์ log มาให้ดู
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

let cachedPath = null

export function getLogPath() {
  if (cachedPath) return cachedPath
  const dir = path.join(app.getPath('userData'), 'logs')
  fs.mkdirSync(dir, { recursive: true })
  cachedPath = path.join(dir, 'main.log')
  return cachedPath
}

function write(level, message, err) {
  const detail = err ? `\n${err && err.stack ? err.stack : err}` : ''
  const line = `[${new Date().toISOString()}] [${level}] ${message}${detail}\n`
  try {
    fs.appendFileSync(getLogPath(), line)
  } catch {
    // เขียน log ไม่ได้ก็ต้องไม่ทำให้แอปล่มซ้ำซ้อน — กลืนไปเงียบๆ ที่นี่ที่เดียว
  }
  // เผื่อกรณีรันผ่าน terminal ที่มองเห็น stdout ได้ (เช่น ELECTRON_RUN_AS_NODE)
  if (level === 'ERROR') console.error(line.trim())
  else console.log(line.trim())
}

export const logInfo = (message) => write('INFO', message)
export const logError = (message, err) => write('ERROR', message, err)
