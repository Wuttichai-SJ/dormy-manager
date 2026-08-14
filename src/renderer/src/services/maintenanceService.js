// ตัวห่อ IPC ของงานแจ้งซ่อม — ช่องทั้งหมดอยู่ที่ src/main/handlers/maintenanceHandlers.js
//
// พนักงานเรียกได้ทุกช่อง (แจ้งซ่อมเป็นงานประจำวัน ไม่ใช่การตั้งค่าหอ)
import { invoke } from './ipc.js'

// status: 'open' = ยังต้องตามต่อ (รอดำเนินการ + นัดแล้ว) · หรือระบุสถานะเดียวตรงๆ
export function listMaintenance(apartmentId, { status, search, dateFrom, dateTo } = {}) {
  return invoke('maintenance:list', { apartmentId, status, search, dateFrom, dateTo })
}

export function getMaintenance(maintenanceId) {
  return invoke('maintenance:get', { maintenanceId })
}

// ไม่ส่งวันนัดมา = ยังไม่ได้นัดช่าง (สถานะจะเป็น "รอดำเนินการ" ให้เอง)
export function createMaintenance({ roomId, reportedDate, description, appointmentDate }) {
  return invoke('maintenance:create', { roomId, reportedDate, description, appointmentDate })
}

// ส่ง appointmentDate = null เพื่อยกเลิกการนัด
export function updateMaintenance({ maintenanceId, reportedDate, description, appointmentDate }) {
  return invoke('maintenance:update', {
    maintenanceId,
    reportedDate,
    description,
    appointmentDate
  })
}

// ปิดงาน · repairCost เว้นว่างได้ = ยังไม่รู้ค่าซ่อม (ไม่ใช่ 0)
export function completeMaintenance({ maintenanceId, repairedDate, repairCost, repairDetails }) {
  return invoke('maintenance:complete', {
    maintenanceId,
    repairedDate,
    repairCost,
    repairDetails
  })
}

export function cancelMaintenance(maintenanceId, reason) {
  return invoke('maintenance:cancel', { maintenanceId, reason })
}

export function reopenMaintenance(maintenanceId) {
  return invoke('maintenance:reopen', { maintenanceId })
}

// ลบจริง — สำหรับใบที่คีย์ผิดห้อง/คีย์ซ้ำเท่านั้น งานที่ไม่ต้องซ่อมแล้วให้ใช้ "ยกเลิก"
export function deleteMaintenance(maintenanceId) {
  return invoke('maintenance:delete', { maintenanceId })
}

// เปิดกล่องเลือกไฟล์ฝั่ง main แล้วอ่านไบต์ที่นั่น — ไบต์ไม่ข้าม IPC
export function addMaintenanceImage(maintenanceId) {
  return invoke('maintenance:addImage', { maintenanceId })
}

export function removeMaintenanceImage(maintenanceId, imageId) {
  return invoke('maintenance:removeImage', { maintenanceId, imageId })
}

export function getMaintenanceImage(imageId) {
  return invoke('maintenance:imageDataUrl', { imageId })
}
