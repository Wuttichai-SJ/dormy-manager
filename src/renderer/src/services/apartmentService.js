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
