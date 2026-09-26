import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { requireOwnerUserId, requireSessionUserId } from './authHandlers.js'
import {
  deleteApartment,
  getApartmentById,
  getDepositPolicy,
  saveDepositPolicy,
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

function assertValid(payload) {
  const errors = validateApartmentInput(payload)
  if (errors.length > 0) throw new Error(errors.join('\n'))
}

export function registerApartmentHandlers() {
  handleSession('apartment:list', () => listApartments(getDatabase()))

  handleSession('apartment:get', ({ apartmentId }) => {
    const apartment = getApartmentById(getDatabase(), apartmentId)
    if (!apartment) throw new Error('ไม่พบหอพักที่ต้องการ')
    return apartment
  })

  handle('apartment:create', (payload) => {
    requireOwnerUserId()
    assertValid(payload)
    const apartment = insertApartment(getDatabase(), payload)
    logInfo(`สร้างหอพัก "${apartment.nameTh}" (apartment_id ${apartment.apartmentId})`)
    return apartment
  })

  // แก้ข้อมูลหอเฉพาะเจ้าของหอ · get/list เปิดไว้
  handle('apartment:update', ({ apartmentId, ...payload }) => {
    requireOwnerUserId()
    assertValid(payload)
    const apartment = updateApartment(getDatabase(), apartmentId, payload)
    logInfo(`แก้ไขหอพัก "${apartment.nameTh}" (apartment_id ${apartmentId})`)
    return apartment
  })

  handleSession('apartment:reorder', ({ orderedIds }) => {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new Error('ไม่ได้ระบุลำดับใหม่')
    }
    return reorderApartments(getDatabase(), orderedIds)
  })

  handleSession('apartment:completeSetup', ({ apartmentId }) => {
    const result = markSetupCompleted(getDatabase(), apartmentId)
    logInfo(`ตั้งค่าหอพักเสร็จ (apartment_id ${apartmentId})`)
    return result
  })

  // ค่าตั้งต้นของสัญญาใหม่เท่านั้น — สัญญาเดิมใช้กฎที่ตรึงไว้
  handleSession('apartment:getDepositPolicy', ({ apartmentId }) =>
    getDepositPolicy(getDatabase(), apartmentId)
  )

  handle('apartment:saveDepositPolicy', ({ apartmentId, policy, noticeDays, minStayMonths }) => {
    requireOwnerUserId()
    const saved = saveDepositPolicy(getDatabase(), apartmentId, {
      policy,
      noticeDays,
      minStayMonths
    })
    logInfo(
      `บันทึกนโยบายเงินประกัน (apartment_id ${apartmentId}): ${saved.policy} · ` +
        `แจ้งล่วงหน้า ${saved.noticeDays} วัน · ` +
        `ขั้นต่ำ ${saved.minStayMonths === null ? 'ตามระยะสัญญา' : `${saved.minStayMonths} เดือน`}`
    )
    return saved
  })

  // เฉพาะเจ้าของหอ — ลบทุกอย่างของหอ ย้อนกลับไม่ได้
  handle('apartment:delete', ({ apartmentId }) => {
    requireOwnerUserId()
    const result = deleteApartment(getDatabase(), apartmentId)
    logInfo(`ลบหอพัก (apartment_id ${apartmentId})`)
    return result
  })
}
