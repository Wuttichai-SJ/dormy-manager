// IPC ของระบบเข้าสู่ระบบ — เป็นเพียงเปลือกบางๆ ครอบ auth.js/db/users.js
// กฎเดียวกันทุกช่อง: คืน { success: true, data } หรือ { success: false, error } เท่านั้น
// ห้าม throw ข้ามสะพานไปฝั่งหน้าจอ เพราะ Electron จะแปลงเป็น error ที่อ่านไม่ออก
// และห้ามส่ง hash หรือรหัสผ่านกลับออกไปในทุกกรณี (ใช้ toPublicUser ทุกครั้ง)
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { readPrefs, writePrefs } from '../prefs.js'
import {
  isInitialized,
  login,
  regenerateRecoveryCode,
  resetPasswordWithTicket,
  setupFirstUser,
  verifyRecoveryCode
} from '../auth.js'

// เซสชันอยู่ในหน่วยความจำของ main process เท่านั้น ปิดแอป = ต้อง login ใหม่
// เก็บไว้ฝั่ง main ไม่ใช่ฝั่ง renderer เพราะ renderer แก้ค่าตัวเองได้จาก DevTools
let session = null

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { success: true, data: await fn(payload ?? {}) }
    } catch (err) {
      // log ไว้เพื่อไล่ปัญหาย้อนหลังได้ แต่ข้อความที่ส่งกลับหน้าจอคือข้อความที่เขียนให้ผู้ใช้อ่าน
      logError(`IPC ${channel} ล้มเหลว`, err)
      return { success: false, error: err.message }
    }
  })
}

function requireSession() {
  if (!session) throw new Error('ยังไม่ได้เข้าสู่ระบบ')
  return session
}

export function registerAuthHandlers() {
  // สถานะตอนเปิดแอป: ระบบนี้ยังไม่มีบัญชีเลยหรือยัง / กำลัง login อยู่ไหม
  handle('auth:status', () => ({
    initialized: isInitialized(getDatabase()),
    session,
    lastIdentifier: readPrefs().lastIdentifier
  }))

  // สร้างผู้ดูแลคนแรก แล้วเข้าสู่ระบบให้เลย (ผู้ใช้เพิ่งตั้งรหัสผ่านด้วยมือตัวเอง)
  // data.recoveryCode คือครั้งเดียวที่รหัสสำรองตัวจริงออกจาก main process
  handle('auth:setup', (payload) => {
    const { user, recoveryCode } = setupFirstUser(getDatabase(), payload)
    session = user
    logInfo(`สร้างบัญชีผู้ดูแลคนแรก (user_id ${user.userId})`)
    return { user, recoveryCode }
  })

  handle('auth:login', ({ identifier, password, remember }) => {
    const user = login(getDatabase(), { identifier, password })
    session = user
    // จำเฉพาะชื่อผู้ใช้ที่กรอก ไม่เคยเก็บรหัสผ่าน (ดู prefs.js)
    writePrefs({ lastIdentifier: remember ? String(identifier ?? '').trim() : '' })
    logInfo(`เข้าสู่ระบบ (user_id ${user.userId})`)
    return { user }
  })

  handle('auth:logout', () => {
    if (session) logInfo(`ออกจากระบบ (user_id ${session.userId})`)
    session = null
    return { ok: true }
  })

  // ขั้นที่ 1 ของการลืมรหัสผ่าน: ตรวจรหัสสำรอง ได้ตั๋วชั่วคราวมาถือไว้ 10 นาที
  handle('auth:recovery:verify', ({ identifier, recoveryCode }) => {
    const { ticket, user } = verifyRecoveryCode(getDatabase(), { identifier, recoveryCode })
    logInfo(`ตรวจรหัสสำรองผ่าน (user_id ${user.userId})`)
    return { ticket, fullName: user.fullName }
  })

  // ขั้นที่ 2: ตั้งรหัสผ่านใหม่ → ได้รหัสสำรองใบใหม่กลับไป ใบเก่าใช้ไม่ได้แล้วทันที
  handle('auth:recovery:reset', ({ ticket, newPassword }) => {
    const { user, recoveryCode } = resetPasswordWithTicket(getDatabase(), { ticket, newPassword })
    logInfo(`ตั้งรหัสผ่านใหม่ด้วยรหัสสำรอง + ออกรหัสสำรองใบใหม่ (user_id ${user.userId})`)
    return { user, recoveryCode }
  })

  // ออกรหัสสำรองใบใหม่ระหว่างที่ยัง login อยู่ (ต้องยืนยันรหัสผ่านอีกครั้ง)
  handle('auth:recovery:regenerate', ({ password }) => {
    const current = requireSession()
    const { recoveryCode } = regenerateRecoveryCode(getDatabase(), {
      userId: current.userId,
      password
    })
    logInfo(`ออกรหัสสำรองใบใหม่จากหน้าตั้งค่า (user_id ${current.userId})`)
    return { recoveryCode }
  })
}
