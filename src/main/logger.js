// main process บน Windows ไม่มี console ให้เห็น จึงเขียน log ลงไฟล์เสมอ
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

let cachedPath = null // ตัวแปรจำตำแหน่ง log file

// function สำหรับหา path ที่จะเก็บ
export function getLogPath() {
  if (cachedPath) return cachedPath
  const dir = path.join(app.getPath('userData'), 'logs') // เอา logs มาต่อท้าย file path ของ userData
  fs.mkdirSync(dir, { recursive: true }) // ตัวแปร dir นำมาสร้าง folder logs
  cachedPath = path.join(dir, 'main.log') //กำหนดชื่อไฟล์ log --> main.log
  return cachedPath
}

// funcytion เชียน log
function write(level, message, err) {
  // detail การแสดง errro ------------- .stack คือ trace error ว่ามันเกิด error ที่ไหน
  const detail = err ? `\n${err && err.stack ? err.stack : err}` : '' 
  // สร้าง log 1 บรรทัด ที่แสดง 
  const line = `[${new Date().toISOString()}] [${level}] ${message}${detail}\n`
  try {
    fs.appendFileSync(getLogPath(), line) // หาไฟล์ path log จากนั้น เอาข้อความ line ใส่ลงไป
  } catch {
  }
  if (level === 'ERROR') console.error(line.trim()) // แสดงบน console ตอนพัฒนา
  else console.log(line.trim())
}

// ตัวที่นำไปใช้
export const logInfo = (message) => write('INFO', message)
export const logError = (message, err) => write('ERROR', message, err)
