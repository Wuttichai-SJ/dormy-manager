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

// ค่าตั้งต้นของสัญญาใหม่เท่านั้น
export function getDepositPolicy(apartmentId) {
  return invoke('apartment:getDepositPolicy', { apartmentId })
}

// minStayMonths ว่าง = ใช้ระยะสัญญาของแต่ละใบ
export function saveDepositPolicy(apartmentId, { policy, noticeDays, minStayMonths }) {
  return invoke('apartment:saveDepositPolicy', {
    apartmentId,
    policy,
    noticeDays,
    minStayMonths
  })
}
