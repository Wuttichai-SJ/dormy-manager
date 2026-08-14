// IPC ของโมดูลหอพัก — เปลือกบางๆ ครอบ db/apartments.js
// กฎเดียวกับ authHandlers: คืน { success, data | error } เท่านั้น ห้าม throw ข้ามสะพาน
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { requireOwnerUserId } from './authHandlers.js'
import {
  deleteApartment,
  getApartmentById,
  insertApartment,
  markSetupCompleted,
  listApartments,
  reorderApartments,
  updateApartment,
  validateApartmentInput
} from '../db/apartments.js'

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
  const errors = validateApartmentInput(payload)
  if (errors.length > 0) throw new Error(errors.join('\n'))
}

export function registerApartmentHandlers() {
  handle('apartment:list', () => listApartments(getDatabase()))

  handle('apartment:get', ({ apartmentId }) => {
    const apartment = getApartmentById(getDatabase(), apartmentId)
    if (!apartment) throw new Error('ไม่พบหอพักที่ต้องการ')
    return apartment
  })

  handle('apartment:create', (payload) => {
    assertValid(payload)
    const apartment = insertApartment(getDatabase(), payload)
    logInfo(`สร้างหอพัก "${apartment.nameTh}" (apartment_id ${apartment.apartmentId})`)
    return apartment
  })

  handle('apartment:update', ({ apartmentId, ...payload }) => {
    assertValid(payload)
    const apartment = updateApartment(getDatabase(), apartmentId, payload)
    logInfo(`แก้ไขหอพัก "${apartment.nameTh}" (apartment_id ${apartmentId})`)
    return apartment
  })

  handle('apartment:reorder', ({ orderedIds }) => {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new Error('ไม่ได้ระบุลำดับใหม่')
    }
    return reorderApartments(getDatabase(), orderedIds)
  })

  // เรียกตอนกด "เสร็จสิ้น" ที่ขั้นสุดท้ายของตัวช่วยตั้งค่า — ก่อนหน้านั้นหอยังเข้าหน้าทำงานไม่ได้
  handle('apartment:completeSetup', ({ apartmentId }) => {
    const result = markSetupCompleted(getDatabase(), apartmentId)
    logInfo(`ตั้งค่าหอพักเสร็จ (apartment_id ${apartmentId})`)
    return result
  })

  // **เจ้าของหอเท่านั้น** (ดู OWNER_ONLY_ACTIONS) — ลากผู้เช่า สัญญา บิล และใบเสร็จ
  // ของทั้งหอไปด้วยในคำสั่งเดียว ไม่มีปุ่มเรียกกลับ
  handle('apartment:delete', ({ apartmentId }) => {
    requireOwnerUserId()
    const result = deleteApartment(getDatabase(), apartmentId)
    logInfo(`ลบหอพัก (apartment_id ${apartmentId})`)
    return result
  })
}
