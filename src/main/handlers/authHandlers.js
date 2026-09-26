// ห้ามส่ง hash หรือรหัสผ่านออกไป (ใช้ toPublicUser)
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { readPrefs, writePrefs } from '../prefs.js'
import { getUserById } from '../db/users.js'
import {
  isInitialized,
  login,
  regenerateRecoveryCode,
  resetPasswordWithTicket,
  setupFirstUser,
  verifyRecoveryCode
} from '../auth.js'

// เซสชันอยู่ใน main เท่านั้น ปิดแอป = ต้องล็อกอินใหม่
let session = null

export function clearSession() {
  session = null
}

// ทุกช่อง handleSession() ต้องล็อกอินก่อน — ยกเว้น auth:* และ app:ping
export function requireSessionUserId() {
  if (!session) throw new Error('ยังไม่ได้เข้าสู่ระบบ')
  return session.userId
}

// อ่านบทบาทจากฐานข้อมูลสดทุกครั้ง ไม่เชื่อเซสชัน
export function requireOwnerUserId() {
  const userId = requireSessionUserId()
  const row = getUserById(getDatabase(), userId)
  if (!row || row.is_active !== 1) {
    throw new Error('บัญชีนี้ถูกปิดการใช้งานแล้ว กรุณาเข้าสู่ระบบใหม่')
  }
  if (row.role !== 'owner') {
    throw new Error('เฉพาะเจ้าของหอเท่านั้นที่ทำรายการนี้ได้')
  }
  return userId
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { success: true, data: await fn(payload ?? {}) }
    } catch (err) {
      logError(`IPC ${channel} ล้มเหลว`, err)
      return { success: false, error: err.message, fields: err.fields }
    }
  })
}

function requireSession() {
  if (!session) throw new Error('ยังไม่ได้เข้าสู่ระบบ')
  return session
}

export function registerAuthHandlers() {
  handle('auth:status', () => ({
    initialized: isInitialized(getDatabase()),
    session,
    lastIdentifier: readPrefs().lastIdentifier
  }))

  handle('auth:setup', (payload) => {
    const { user, recoveryCode } = setupFirstUser(getDatabase(), payload)
    session = user
    logInfo(`สร้างบัญชีผู้ดูแลคนแรก (user_id ${user.userId})`)
    return { user, recoveryCode }
  })

  handle('auth:login', ({ identifier, password, remember }) => {
    const user = login(getDatabase(), { identifier, password })
    session = user
    writePrefs({ lastIdentifier: remember ? String(identifier ?? '').trim() : '' })
    logInfo(`เข้าสู่ระบบ (user_id ${user.userId})`)
    return { user }
  })

  handle('auth:logout', () => {
    if (session) logInfo(`ออกจากระบบ (user_id ${session.userId})`)
    session = null
    return { ok: true }
  })

  handle('auth:recovery:verify', ({ identifier, recoveryCode }) => {
    const { ticket, user } = verifyRecoveryCode(getDatabase(), { identifier, recoveryCode })
    logInfo(`ตรวจรหัสสำรองผ่าน (user_id ${user.userId})`)
    return { ticket, fullName: user.fullName }
  })

  handle('auth:recovery:reset', ({ ticket, newPassword }) => {
    const { user, recoveryCode } = resetPasswordWithTicket(getDatabase(), { ticket, newPassword })
    logInfo(`ตั้งรหัสผ่านใหม่ด้วยรหัสสำรอง + ออกรหัสสำรองใบใหม่ (user_id ${user.userId})`)
    return { user, recoveryCode }
  })

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
