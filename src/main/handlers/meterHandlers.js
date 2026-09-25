// IPC ของโมดูลจดมิเตอร์ — เปลือกบางๆ ครอบ db/meterReadings.js
// กฎเดียวกับ handler อื่น: คืน { success, data | error } เท่านั้น ห้าม throw ข้ามสะพาน
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { requireSessionUserId } from './authHandlers.js'
import {
  createBatch,
  deleteBatch,
  getBatchSheet,
  listBatches,
  saveBatchReadings
} from '../db/meterReadings.js'

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

// ช่องที่ห่อด้วยตัวนี้ต้องเข้าสู่ระบบก่อน — เหตุผลเต็ม (ภัยจาก DevTools ตอนหน้าจอค้างที่
// ล็อกอิน และช่องไหนห้ามใส่การ์ด) อยู่เหนือ requireSessionUserId() ใน authHandlers.js
function handleSession(channel, fn) {
  handle(channel, (payload) => {
    requireSessionUserId()
    return fn(payload)
  })
}

export function registerMeterHandlers() {
  handleSession('meter:listBatches', ({ apartmentId }) => listBatches(getDatabase(), apartmentId))

  handleSession('meter:createBatch', ({ apartmentId, readingDate }) => {
    const batch = createBatch(getDatabase(), apartmentId, readingDate)
    logInfo(`สร้างใบจดมิเตอร์ ${readingDate} ของหอ ${apartmentId} (batch_id ${batch.batchId})`)
    return batch
  })

  handleSession('meter:getSheet', ({ batchId, side }) => getBatchSheet(getDatabase(), batchId, side))

  // rows = ทั้งตารางของฝั่งนั้น บันทึกทีเดียวทั้งใบตามหน้าจอต้นแบบ
  handleSession('meter:saveReadings', ({ batchId, side, rows }) => {
    const sheet = saveBatchReadings(getDatabase(), batchId, side, rows)
    logInfo(`บันทึกเลขมิเตอร์ฝั่ง ${side} ของใบจด ${batchId} จำนวน ${rows?.length ?? 0} ห้อง`)
    return sheet
  })

  handleSession('meter:deleteBatch', ({ batchId }) => {
    const result = deleteBatch(getDatabase(), batchId)
    logInfo(`ลบใบจดมิเตอร์ ${batchId}`)
    return result
  })
}
