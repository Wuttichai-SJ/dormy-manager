// ทุกช่องเฉพาะเจ้าของหอ ยกเว้น user:changeOwnPassword · ห้ามส่ง hash ออกไป
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

  // รหัสสำรองออกจาก main ครั้งเดียวตรงนี้
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
    if (userId === actor && !isActive) {
      throw new Error('ปิดการใช้งานบัญชีของตัวเองไม่ได้')
    }
    const user = setUserActiveState(getDatabase(), { userId, isActive: Boolean(isActive) })
    logInfo(`${isActive ? 'เปิด' : 'ปิด'}การใช้งานบัญชี (user_id ${userId})`)
    return { user }
  })

  // actorUserId มาจากเซสชันเสมอ
  handle('user:resetPassword', ({ userId, newPassword }) => {
    const actor = requireOwnerUserId()
    const user = resetUserPassword(getDatabase(), { userId, newPassword, actorUserId: actor })
    logInfo(`เจ้าของตั้งรหัสผ่านใหม่ให้บัญชี (user_id ${userId})`)
    return { user }
  })

  // เปลี่ยนได้เฉพาะรหัสผ่านตัวเอง (userId จากเซสชัน)
  handle('user:changeOwnPassword', ({ currentPassword, newPassword }) => {
    const userId = requireSessionUserId()
    const user = changeOwnPassword(getDatabase(), { userId, currentPassword, newPassword })
    logInfo(`เปลี่ยนรหัสผ่านของตัวเอง (user_id ${userId})`)
    return { user }
  })
}
