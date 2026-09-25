// IPC ของระบบเข้าสู่ระบบ — เป็นเพียงเปลือกบางๆ ครอบ auth.js/db/users.js
// กฎเดียวกันทุกช่อง: คืน { success: true, data } หรือ { success: false, error } เท่านั้น
// ห้าม throw ข้ามสะพานไปฝั่งหน้าจอ เพราะ Electron จะแปลงเป็น error ที่อ่านไม่ออก
// และห้ามส่ง hash หรือรหัสผ่านกลับออกไปในทุกกรณี (ใช้ toPublicUser ทุกครั้ง)
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

// เซสชันอยู่ในหน่วยความจำของ main process เท่านั้น ปิดแอป = ต้อง login ใหม่
// เก็บไว้ฝั่ง main ไม่ใช่ฝั่ง renderer เพราะ renderer แก้ค่าตัวเองได้จาก DevTools
let session = null

// ล้างเซสชันโดยไม่ผ่าน IPC — ใช้ตอนกู้คืนข้อมูล
//
// ไฟล์สำรองที่กู้มาอาจมีชุดผู้ใช้คนละชุดกับที่ล็อกอินค้างอยู่ (คนละรหัสผ่าน หรือ user_id
// เดียวกันแต่เป็นคนละคน) ถ้าไม่ล้าง จะกลายเป็นเข้าถึงข้อมูลในฐานะคนที่ฐานข้อมูลใหม่ไม่รู้จัก
export function clearSession() {
  session = null
}

// ผู้ใช้ที่กำลังล็อกอินอยู่ — ใบเสร็จทุกใบต้องรู้ว่าใครเป็นคนรับเงิน
//
// อ่านจากเซสชันฝั่ง main เท่านั้น ห้ามให้หน้าจอส่ง userId มาเอง ไม่งั้นใครก็ออกใบเสร็จ
// ในนามคนอื่นได้จาก DevTools แล้วรายงาน "ผู้รับเงิน" จะเชื่อถือไม่ได้ทั้งระบบ
//
// -----------------------------------------------------------------------------
// 🔴 **เหตุผลฉบับเต็มของการ์ด `handleSession()` ที่กระจายอยู่ในไฟล์ handlers ทุกไฟล์**
// (ไฟล์เหล่านั้นชี้กลับมาอ่านที่นี่ ถ้าจะแก้เหตุผล แก้ที่นี่ที่เดียว)
// -----------------------------------------------------------------------------
// ทุกช่องที่ห่อด้วย handleSession() "ต้องเข้าสู่ระบบก่อน" — หน้าล็อกอินที่ค้างอยู่บนจอ
// ไม่ใช่กำแพง เพราะใครก็ตามที่เดินมาที่เครื่องเปิด DevTools แล้วยิง
// window.electron.invoke(...) ตรงเข้าช่องนั้นได้ทันทีโดยไม่ต้องรู้รหัสผ่าน
//
// ระบบนี้จงใจไม่ทำ auto-login (ดู prefs.js) — การ์ดนี้คือสิ่งที่ทำให้เจตนานั้นเป็นจริง
// ไม่ใช่แค่หน้าจอที่ซ่อนปุ่มไว้ เพราะการซ่อนปุ่มฝั่งหน้าจอกันการยิง IPC ตรงไม่ได้เลย
//
// handleSession() กับ handleOwner() (ต้นฉบับอยู่ใน roomHandlers.js) ต่างกันแค่ระดับ:
// ตัวหลังต้องเป็นเจ้าของหอ ตัวแรกขอแค่ล็อกอินแล้วก็พอ · ช่องที่เป็นของเจ้าของอยู่แล้ว
// คงเรียก requireOwnerUserId() ไว้เหมือนเดิม ห้ามลดระดับลงมา
//
// ช่องที่ **ห้าม** ใส่การ์ด: ทุกช่อง auth:* ในไฟล์นี้ (ต้องทำงานได้ก่อนมีเซสชัน ไม่งั้น
// แอปเปิดไม่ได้เลย) และ app:ping ใน index.js ที่คืนแค่คำว่า pong
export function requireSessionUserId() {
  if (!session) throw new Error('ยังไม่ได้เข้าสู่ระบบ')
  return session.userId
}

// ผู้ทำรายการที่ต้องเป็น "เจ้าของหอ" เท่านั้น (ลบบิล / ยกเลิกใบเสร็จ / ลบหอ /
// กู้คืนข้อมูล / จัดการผู้ใช้ — ดู OWNER_ONLY_ACTIONS ใน db/users.js)
//
// 🔴 **อ่านบทบาทจากฐานข้อมูลสดทุกครั้ง ไม่ใช่จากเซสชันที่จับไว้ตอนล็อกอิน**
// เจ้าของอาจลดบทบาทหรือปิดบัญชีของคนที่กำลังเปิดแอปค้างอยู่ ถ้าเชื่อเซสชัน คนนั้นจะยัง
// ลบบิลได้ต่อไปจนกว่าจะปิดแอป — และการซ่อนปุ่มฝั่งหน้าจอกันไม่ได้เลย เพราะยิง IPC ตรงได้
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
      // log ไว้เพื่อไล่ปัญหาย้อนหลังได้ แต่ข้อความที่ส่งกลับหน้าจอคือข้อความที่เขียนให้ผู้ใช้อ่าน
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
