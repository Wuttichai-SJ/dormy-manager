// IPC ของการคิดค่าน้ำ/ค่าไฟระดับหอ — เปลือกบางๆ ครอบ db/utilityDefaults.js
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import {
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

  handle('utility:save', ({ apartmentId, water, electric }) => {
    const errors = validateUtilityInput({ water, electric })
    if (errors.length > 0) throw new Error(errors.join('\n'))

    const saved = saveUtilityDefaults(getDatabase(), apartmentId, { water, electric })
    logInfo(`บันทึกวิธีคิดค่าน้ำ/ค่าไฟ (apartment_id ${apartmentId})`)
    return saved
  })
}
