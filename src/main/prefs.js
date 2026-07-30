// ค่าที่จำไว้ระหว่างเปิดแอปแต่ละครั้ง เก็บเป็น JSON ไฟล์เล็กๆ ใน userData
// ห้ามเก็บอะไรที่เป็นความลับลงที่นี่ — ไฟล์นี้เป็น plaintext ที่ใครเปิดเครื่องได้ก็อ่านได้
//
// "จดจำฉัน" ในแอปนี้ = จำแค่ "ชื่อผู้ใช้ที่กรอกล่าสุด" เพื่อเติมช่องแรกให้อัตโนมัติ
// จงใจไม่ทำ auto-login: แอปนี้เปิดบนเครื่องที่วางอยู่ในสำนักงานหอพัก ถ้าเปิดมาแล้ว
// เข้าระบบให้เลย รหัสผ่านก็ไม่มีความหมายอะไรอีก
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { logError } from './logger.js'

const DEFAULTS = { lastIdentifier: '' }

function prefsPath() {
  return path.join(app.getPath('userData'), 'prefs.json')
}

export function readPrefs() {
  try {
    if (!fs.existsSync(prefsPath())) return { ...DEFAULTS }
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(prefsPath(), 'utf-8')) }
  } catch (err) {
    // ไฟล์พังไม่ใช่เหตุให้แอปเปิดไม่ได้ — ถอยไปใช้ค่าเริ่มต้นแต่ต้องมีร่องรอยใน log
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
