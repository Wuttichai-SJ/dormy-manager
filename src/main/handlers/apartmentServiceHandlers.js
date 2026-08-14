// IPC ของค่าบริการหอพัก — เปลือกบางๆ ครอบ db/apartmentServices.js
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import {
  deleteService,
  insertService,
  listServices,
  updateService,
  validateServiceInput
} from '../db/apartmentServices.js'

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

function assertValid(payload) {
  const errors = validateServiceInput(payload)
  if (errors.length > 0) throw new Error(errors.join('\n'))
}

export function registerApartmentServiceHandlers() {
  handle('apartmentService:list', ({ apartmentId }) => listServices(getDatabase(), apartmentId))

  // ราคาค่าบริการเป็นของเจ้าของหอ (เมนูตั้งค่าทั้งเมนู — ผู้ใช้ตัดสินใจ 2026-08-14)
  // ช่อง list เปิดไว้ เพราะตัวช่วยทำสัญญาและการออกบิลต้องอ่านรายการค่าบริการ
  handle('apartmentService:create', ({ apartmentId, ...payload }) => {
    requireOwnerUserId()
    assertValid(payload)
    const service = insertService(getDatabase(), apartmentId, payload)
    logInfo(`เพิ่มค่าบริการ "${service.name}" (apartment_id ${apartmentId})`)
    return service
  })

  handle('apartmentService:update', ({ serviceId, ...payload }) => {
    requireOwnerUserId()
    assertValid(payload)
    const service = updateService(getDatabase(), serviceId, payload)
    logInfo(`แก้ไขค่าบริการ "${service.name}" (service_id ${serviceId})`)
    return service
  })

  handle('apartmentService:delete', ({ serviceId }) => {
    requireOwnerUserId()
    const result = deleteService(getDatabase(), serviceId)
    logInfo(`ลบค่าบริการ (service_id ${serviceId})`)
    return result
  })
}
