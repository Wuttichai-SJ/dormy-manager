import { invoke } from './ipc.js'

// status 'open' = รอดำเนินการ + นัดแล้ว
export function listMaintenance(apartmentId, { status, search, dateFrom, dateTo } = {}) {
  return invoke('maintenance:list', { apartmentId, status, search, dateFrom, dateTo })
}

export function getMaintenance(maintenanceId) {
  return invoke('maintenance:get', { maintenanceId })
}

export function createMaintenance({ roomId, reportedDate, description, appointmentDate }) {
  return invoke('maintenance:create', { roomId, reportedDate, description, appointmentDate })
}

// appointmentDate = null คือยกเลิกนัด
export function updateMaintenance({ maintenanceId, reportedDate, description, appointmentDate }) {
  return invoke('maintenance:update', {
    maintenanceId,
    reportedDate,
    description,
    appointmentDate
  })
}

// repairCost ว่าง = ยังไม่รู้ค่าซ่อม (ไม่ใช่ 0)
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

export function deleteMaintenance(maintenanceId) {
  return invoke('maintenance:delete', { maintenanceId })
}

export function addMaintenanceImage(maintenanceId) {
  return invoke('maintenance:addImage', { maintenanceId })
}

export function removeMaintenanceImage(maintenanceId, imageId) {
  return invoke('maintenance:removeImage', { maintenanceId, imageId })
}

export function getMaintenanceImage(imageId) {
  return invoke('maintenance:imageDataUrl', { imageId })
}
