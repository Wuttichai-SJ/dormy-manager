// IPC ของหน้าจัดการผู้ใช้ — เปลือกบางๆ ครอบ auth.js/db/users.js
//
// ทุกช่องยกเว้น `user:changeOwnPassword` เป็นของเจ้าของหอเท่านั้น ด่านอยู่ที่
// requireOwnerUserId() ซึ่งอ่านบทบาทจากฐานข้อมูลสดทุกครั้ง — การซ่อนปุ่มฝั่งหน้าจอ
// เป็นแค่การจัดหน้าจอ ไม่ได้กันอะไร เพราะเปิด DevTools แล้วยิงช่องนี้ตรงๆ ได้
//
// ห้ามส่ง hash หรือรหัสผ่านกลับออกไปในทุกกรณี (ใช้ toPublicUser ทุกครั้ง)
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { requireOwnerUserId, requireSessionUserId } from './authHandlers.js'
import {
  changeOwnPassword,
  createUser,
  resetUserPassword,
  setUserActiveState,
  updateUser
} from '../auth.js'
import { listUsers } from '../db/users.js'

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { success: true, data: await fn(payload ?? {}) }
    } catch (err) {
      logError(`${channel} ล้มเหลว`, err)
      return { success: false, error: err.message, fields: err.fields }
    }
  })
}

export function registerUserHandlers() {
  handle('user:list', () => {
    requireOwnerUserId()
    return { users: listUsers(getDatabase()) }
  })

  // รหัสสำรองตัวจริงออกจาก main process ครั้งเดียวตรงนี้ (เฉพาะบัญชีเจ้าของ)
  // หน้าจอต้องแสดงให้จดทันที เพราะไม่มีทางเรียกดูอีกแล้ว
  handle('user:create', (payload) => {
    requireOwnerUserId()
    const result = createUser(getDatabase(), {
      fullName: payload.fullName,
      phone: payload.phone,
      email: payload.email,
      password: payload.password,
      role: payload.role
    })
    logInfo(`สร้างบัญชีผู้ใช้ ${result.user.role} (user_id ${result.user.userId})`)
    return result
  })

  handle('user:update', (payload) => {
    requireOwnerUserId()
    const result = updateUser(getDatabase(), payload.userId, {
      fullName: payload.fullName,
      phone: payload.phone,
      email: payload.email,
      role: payload.role
    })
    logInfo(
      `แก้ข้อมูลผู้ใช้ (user_id ${result.user.userId}) บทบาท ${result.user.role}` +
        (result.recoveryCode ? ' · ออกรหัสสำรองใหม่เพราะเลื่อนเป็นเจ้าของ' : '')
    )
    return result
  })

  handle('user:setActive', ({ userId, isActive }) => {
    const actor = requireOwnerUserId()
    // ปิดบัญชีตัวเองไม่ได้ — กดพลาดแล้วออกจากระบบไม่ได้กลับเข้ามาอีก
    // (ถึงจะเหลือเจ้าของคนอื่นอยู่ ก็ยังเป็นการล็อกตัวเองออกโดยไม่ตั้งใจ)
    if (userId === actor && !isActive) {
      throw new Error('ปิดการใช้งานบัญชีของตัวเองไม่ได้')
    }
    const user = setUserActiveState(getDatabase(), { userId, isActive: Boolean(isActive) })
    logInfo(`${isActive ? 'เปิด' : 'ปิด'}การใช้งานบัญชี (user_id ${userId})`)
    return { user }
  })

  // ทางกู้คืนของพนักงาน: พนักงานไม่มีรหัสสำรอง เจ้าของจึงเป็นคนตั้งรหัสผ่านใหม่ให้
  // actorUserId มาจากเซสชันฝั่ง main เสมอ ห้ามรับจากหน้าจอ — ไม่งั้นด่าน "ตั้งให้ตัวเองไม่ได้"
  // ใน resetUserPassword จะถูกข้ามด้วยการส่ง actorUserId ปลอมมาจาก DevTools
  handle('user:resetPassword', ({ userId, newPassword }) => {
    const actor = requireOwnerUserId()
    const user = resetUserPassword(getDatabase(), { userId, newPassword, actorUserId: actor })
    logInfo(`เจ้าของตั้งรหัสผ่านใหม่ให้บัญชี (user_id ${userId})`)
    return { user }
  })

  // ช่องเดียวของกลุ่มนี้ที่พนักงานเรียกได้ — และเรียกได้เฉพาะกับบัญชีตัวเอง
  // userId มาจากเซสชันฝั่ง main ไม่ได้รับจากหน้าจอ จึงเปลี่ยนรหัสผ่านของคนอื่นไม่ได้
  handle('user:changeOwnPassword', ({ currentPassword, newPassword }) => {
    const userId = requireSessionUserId()
    const user = changeOwnPassword(getDatabase(), { userId, currentPassword, newPassword })
    logInfo(`เปลี่ยนรหัสผ่านของตัวเอง (user_id ${userId})`)
    return { user }
  })
}
