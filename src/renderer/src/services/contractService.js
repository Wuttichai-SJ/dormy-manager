// ตัวห่อ IPC ของสัญญาเช่าและรายการห้อง
// ช่องทั้งหมดอยู่ที่ src/main/handlers/contractHandlers.js
import { invoke } from './ipc.js'

// รายการห้องของหอ พร้อมผู้เช่าที่อยู่จริงในแต่ละห้อง — ใช้ในหน้า "ห้องพัก"
export function listRoomsForApartment(apartmentId, filters = {}) {
  return invoke('room:listForApartment', { apartmentId, ...filters })
}

// สัญญาที่ยังใช้งานอยู่ + ประวัติสัญญาทั้งหมดของห้องนั้น
export function getContractsForRoom(roomId) {
  return invoke('contract:forRoom', { roomId })
}

export function getContract(contractId) {
  return invoke('contract:get', { contractId })
}

export function createContract(payload) {
  return invoke('contract:create', payload)
}
