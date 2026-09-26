// คำสั่งที่แก้ข้อมูลคืนผังห้องทั้งหมดของหอ
import { invoke } from './ipc.js'

export function listFloors(apartmentId) {
  return invoke('room:listFloors', { apartmentId })
}

export function generateFloorPlan(apartmentId, floors) {
  return invoke('room:generatePlan', { apartmentId, floors })
}

// numberPrefix '12' → ห้อง 1201, 1202 · ไม่ส่ง = ใช้ลำดับที่ของชั้น
export function addFloor(apartmentId, { floorName, roomCount, buildingName, numberPrefix } = {}) {
  return invoke('room:addFloor', { apartmentId, floorName, roomCount, buildingName, numberPrefix })
}

// ไม่ส่ง = ไม่แตะ · ส่งค่าว่าง = ล้างค่า
export function updateFloor(floorId, changes) {
  return invoke('room:updateFloor', { floorId, ...changes })
}

export function deleteFloor(floorId) {
  return invoke('room:deleteFloor', { floorId })
}

export function addRoom(floorId, { roomNumber, roomTypeName }) {
  return invoke('room:addRoom', { floorId, roomNumber, roomTypeName })
}

export function updateRoom(roomId, payload) {
  return invoke('room:updateRoom', { roomId, ...payload })
}

export function deleteRoom(roomId) {
  return invoke('room:deleteRoom', { roomId })
}

export function setRoomRates(roomIds, { monthlyRent, dailyRent }) {
  return invoke('room:setRates', { roomIds, monthlyRent, dailyRent })
}

export function setRoomStatus(roomIds, status) {
  return invoke('room:setStatus', { roomIds, status })
}

export function attachServices(roomIds, serviceIds) {
  return invoke('room:attachServices', { roomIds, serviceIds })
}

export function detachServices(roomIds, serviceIds) {
  return invoke('room:detachServices', { roomIds, serviceIds })
}
