// จำแค่ชื่อผู้ใช้ล่าสุด (ไม่ auto-login) · ไฟล์ plaintext ห้ามเก็บความลับ
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { logError } from './logger.js'

const DEFAULTS = { lastIdentifier: '' }

// dev ใช้คนละไฟล์กับตัวจริง (userData โฟลเดอร์เดียวกัน)
function prefsPath() {
  const fileName = app.isPackaged ? 'prefs.json' : 'prefs-dev.json'
  return path.join(app.getPath('userData'), fileName)
}

export function readPrefs() {
  try {
    if (!fs.existsSync(prefsPath())) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(prefsPath(), 'utf-8')) }
  } catch (err) {
    logError('อ่าน prefs.json ไม่สำเร็จ ใช้ค่าเริ่มต้นแทน', err)
    return { ...DEFAULTS }
  }
}

export function writePrefs(patch) {
  try {
    const next = { ...readPrefs(), ...patch }
    fs.writeFileSync(prefsPath(), JSON.stringify(next, null, 2), 'utf-8')
    return next
  } catch (err) {
    logError('เขียน prefs.json ไม่สำเร็จ', err)
    return readPrefs()
  }
}
