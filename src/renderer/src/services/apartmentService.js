// ตัวห่อ IPC ของโมดูลหอพัก — คอมโพเนนต์ห้ามเรียก window.electron.invoke เอง
// ช่องทั้งหมดอยู่ที่ src/main/handlers/apartmentHandlers.js
import { invoke } from './ipc.js'

export function listApartments() {
  return invoke('apartment:list')
}

export function getApartment(apartmentId) {
  return invoke('apartment:get', { apartmentId })
}

export function createApartment(payload) {
  return invoke('apartment:create', payload)
}

export function updateApartment(apartmentId, payload) {
  return invoke('apartment:update', { apartmentId, ...payload })
}

export function reorderApartments(orderedIds) {
  return invoke('apartment:reorder', { orderedIds })
}

export function deleteApartment(apartmentId) {
  return invoke('apartment:delete', { apartmentId })
}

export function completeApartmentSetup(apartmentId) {
  return invoke('apartment:completeSetup', { apartmentId })
}

// นโยบายคืนเงินประกัน — ค่าตั้งต้นที่จะถูกสำเนาลง "สัญญาใบใหม่" เท่านั้น
// สัญญาที่เซ็นไปแล้วยังใช้กฎที่ตกลงกันในวันนั้น (สำเนาไว้ที่ตัวสัญญาตั้งแต่ migration 004)
export function getDepositPolicy(apartmentId) {
  return invoke('apartment:getDepositPolicy', { apartmentId })
}

// minStayMonths เว้นว่าง (null) = ใช้ระยะสัญญาของแต่ละใบเป็นเกณฑ์
export function saveDepositPolicy(apartmentId, { policy, noticeDays, minStayMonths }) {
  return invoke('apartment:saveDepositPolicy', {
    apartmentId,
    policy,
    noticeDays,
    minStayMonths
  })
}
