// ตัวห่อ IPC ของการจดมิเตอร์
// ช่องทั้งหมดอยู่ที่ src/main/handlers/meterHandlers.js
import { invoke } from './ipc.js'

export function listMeterBatches(apartmentId) {
  return invoke('meter:listBatches', { apartmentId })
}

export function createMeterBatch(apartmentId, readingDate) {
  return invoke('meter:createBatch', { apartmentId, readingDate })
}

// side = 'water' | 'electric' — หน้าจอกรอกทีละฝั่งตามต้นแบบ
export function getMeterSheet(batchId, side) {
  return invoke('meter:getSheet', { batchId, side })
}

// rows = ทั้งตารางของฝั่งนั้น ไม่ใช่ทีละแถว — ถ้าแถวไหนผิด ทั้งใบจะไม่ถูกบันทึกเลย
export function saveMeterReadings(batchId, side, rows) {
  return invoke('meter:saveReadings', { batchId, side, rows })
}

export function deleteMeterBatch(batchId) {
  return invoke('meter:deleteBatch', { batchId })
}
