// IPC ของการคิดค่าน้ำ/ค่าไฟระดับหอ — เปลือกบางๆ ครอบ db/utilityDefaults.js
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { requireOwnerUserId } from './authHandlers.js'
import {
  applyDefaultsToRooms,
  getUtilityDefaults,
  saveUtilityDefaults,
  validateUtilityInput
} from '../db/utilityDefaults.js'

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { success: true, data: await fn(payload ?? {}) }
    } catch (err) {
      logError(`IPC ${channel} ล้มเหลว`, err)
      return { success: false, error: err.message }
    }
  })
}

export function registerUtilityHandlers() {
  handle('utility:get', ({ apartmentId }) => getUtilityDefaults(getDatabase(), apartmentId))

  // ราคาน้ำ-ไฟเป็นของเจ้าของหอ · ช่อง get เปิดไว้ (หน้าจอกับการออกบิลต้องอ่าน)
  handle('utility:save', ({ apartmentId, water, electric }) => {
    requireOwnerUserId()
    const errors = validateUtilityInput({ water, electric })
    if (errors.length > 0) throw new Error(errors.join('\n'))

    const saved = saveUtilityDefaults(getDatabase(), apartmentId, { water, electric })
    logInfo(`บันทึกวิธีคิดค่าน้ำ/ค่าไฟ (apartment_id ${apartmentId})`)
    return saved
  })

  // ทับราคาของห้องทั้งหมดด้วยราคาปัจจุบันของหอ — ผู้ใช้ต้องกดสั่งเอง
  handle('utility:applyToRooms', ({ apartmentId }) => {
    requireOwnerUserId()
    const result = applyDefaultsToRooms(getDatabase(), apartmentId)
    logInfo(`นำค่าน้ำ/ค่าไฟของหอ ${apartmentId} ไปใช้กับ ${result.updatedRooms} ห้อง`)
    return result
  })
}
