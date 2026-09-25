// IPC ของโมดูลหอพัก — เปลือกบางๆ ครอบ db/apartments.js
// กฎเดียวกับ authHandlers: คืน { success, data | error } เท่านั้น ห้าม throw ข้ามสะพาน
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

// ช่องที่ห่อด้วยตัวนี้ต้องเข้าสู่ระบบก่อน — เหตุผลเต็ม (ภัยจาก DevTools ตอนหน้าจอค้างที่
// ล็อกอิน และช่องไหนห้ามใส่การ์ด) อยู่เหนือ requireSessionUserId() ใน authHandlers.js
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

  // สร้างหอใหม่ = เปิดกิจการเพิ่ม ไม่ใช่งานประจำวัน · และถ้าพนักงานสร้างหอได้แต่แก้ไม่ได้
  // (apartment:update ถูกล็อก) จะได้หอที่สร้างค้างไว้แล้วเดินต่อไม่ได้
  handle('apartment:create', (payload) => {
    requireOwnerUserId()
    assertValid(payload)
    const apartment = insertApartment(getDatabase(), payload)
    logInfo(`สร้างหอพัก "${apartment.nameTh}" (apartment_id ${apartment.apartmentId})`)
    return apartment
  })

  // ข้อมูลหอพักมีสวิตช์ VAT อัตราค่าปรับ วันครบกำหนด และชื่อ/ที่อยู่/เบอร์ที่พิมพ์บนบิล
  // ทั้งหมดเป็นกติกาของหอ = เรื่องของเจ้าของ (ช่อง get/list เปิดไว้ ทุกหน้าจอต้องอ่าน)
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

  // เรียกตอนกด "เสร็จสิ้น" ที่ขั้นสุดท้ายของตัวช่วยตั้งค่า — ก่อนหน้านั้นหอยังเข้าหน้าทำงานไม่ได้
  handleSession('apartment:completeSetup', ({ apartmentId }) => {
    const result = markSetupCompleted(getDatabase(), apartmentId)
    logInfo(`ตั้งค่าหอพักเสร็จ (apartment_id ${apartmentId})`)
    return result
  })

  // นโยบายคืนเงินประกัน — ค่าตั้งต้นที่จะถูกสำเนาลง "สัญญาใบใหม่" เท่านั้น
  // (สัญญาที่เซ็นไปแล้วยังใช้กฎที่ตกลงกันวันนั้น ดู 004) · อ่านได้ทุกคน เพราะหน้าทำสัญญา
  // ต้องรู้ว่ากติกาปัจจุบันคืออะไร
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

  // **เจ้าของหอเท่านั้น** (ดู OWNER_ONLY_ACTIONS) — ลากผู้เช่า สัญญา บิล และใบเสร็จ
  // ของทั้งหอไปด้วยในคำสั่งเดียว ไม่มีปุ่มเรียกกลับ
  handle('apartment:delete', ({ apartmentId }) => {
    requireOwnerUserId()
    const result = deleteApartment(getDatabase(), apartmentId)
    logInfo(`ลบหอพัก (apartment_id ${apartmentId})`)
    return result
  })
}
