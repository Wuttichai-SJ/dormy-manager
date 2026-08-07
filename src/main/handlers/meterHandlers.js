// IPC ของโมดูลจดมิเตอร์ — เปลือกบางๆ ครอบ db/meterReadings.js
// กฎเดียวกับ handler อื่น: คืน { success, data | error } เท่านั้น ห้าม throw ข้ามสะพาน
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
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
      return { success: false, error: err.message }
    }
  })
}

export function registerMeterHandlers() {
  handle('meter:listBatches', ({ apartmentId }) => listBatches(getDatabase(), apartmentId))

  handle('meter:createBatch', ({ apartmentId, readingDate }) => {
    const batch = createBatch(getDatabase(), apartmentId, readingDate)
    logInfo(`สร้างใบจดมิเตอร์ ${readingDate} ของหอ ${apartmentId} (batch_id ${batch.batchId})`)
    return batch
  })

  handle('meter:getSheet', ({ batchId, side }) => getBatchSheet(getDatabase(), batchId, side))

  // rows = ทั้งตารางของฝั่งนั้น บันทึกทีเดียวทั้งใบตามหน้าจอต้นแบบ
  handle('meter:saveReadings', ({ batchId, side, rows }) => {
    const sheet = saveBatchReadings(getDatabase(), batchId, side, rows)
    logInfo(`บันทึกเลขมิเตอร์ฝั่ง ${side} ของใบจด ${batchId} จำนวน ${rows?.length ?? 0} ห้อง`)
    return sheet
  })

  handle('meter:deleteBatch', ({ batchId }) => {
    const result = deleteBatch(getDatabase(), batchId)
    logInfo(`ลบใบจดมิเตอร์ ${batchId}`)
    return result
  })
}
