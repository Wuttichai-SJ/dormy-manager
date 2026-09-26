// main process บน Windows ไม่มี console ให้เห็น จึงเขียน log ลงไฟล์เสมอ
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
  }
  if (level === 'ERROR') console.error(line.trim())
  else console.log(line.trim())
}

export const logInfo = (message) => write('INFO', message)
export const logError = (message, err) => write('ERROR', message, err)
