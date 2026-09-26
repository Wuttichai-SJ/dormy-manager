import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { throwIfErrors } from '../fieldError.js'
import { requireOwnerUserId, requireSessionUserId } from './authHandlers.js'
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
      return { success: false, error: err.message, fields: err.fields }
    }
  })
}

function handleSession(channel, fn) {
  handle(channel, (payload) => {
    requireSessionUserId()
    return fn(payload)
  })
}

export function registerUtilityHandlers() {
  handleSession('utility:get', ({ apartmentId }) => getUtilityDefaults(getDatabase(), apartmentId))

  // แก้ราคาเฉพาะเจ้าของหอ · get เปิดไว้ให้ออกบิลอ่าน
  handle('utility:save', ({ apartmentId, water, electric }) => {
    requireOwnerUserId()
    throwIfErrors(validateUtilityInput({ water, electric }))

    const saved = saveUtilityDefaults(getDatabase(), apartmentId, { water, electric })
    logInfo(`บันทึกวิธีคิดค่าน้ำ/ค่าไฟ (apartment_id ${apartmentId})`)
    return saved
  })

  handle('utility:applyToRooms', ({ apartmentId }) => {
    requireOwnerUserId()
    const result = applyDefaultsToRooms(getDatabase(), apartmentId)
    logInfo(`นำค่าน้ำ/ค่าไฟของหอ ${apartmentId} ไปใช้กับ ${result.updatedRooms} ห้อง`)
    return result
  })
}
