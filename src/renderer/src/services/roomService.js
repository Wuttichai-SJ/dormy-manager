// ตัวห่อ IPC ของผังห้อง (ชั้น + ห้อง)
// ช่องทั้งหมดอยู่ที่ src/main/handlers/roomHandlers.js
//
// ทุกคำสั่งที่แก้ข้อมูลคืน "ผังห้องทั้งหมดของหอ" กลับมา ไม่ใช่คืนเฉพาะแถวที่แก้
// เพราะการเพิ่ม/ลบชั้นกระทบลำดับและเลขห้องของทั้งผัง หน้าจอจะได้ไม่ต้องเดาว่า
// ต้องอัปเดตตรงไหนบ้าง แค่เอาที่ได้มาแทนของเดิมทั้งก้อน
import { invoke } from './ipc.js'

export function listFloors(apartmentId) {
  return invoke('room:listFloors', { apartmentId })
}

export function generateFloorPlan(apartmentId, floors) {
  return invoke('room:generatePlan', { apartmentId, floors })
}

export function addFloor(apartmentId, { floorName, roomCount }) {
  return invoke('room:addFloor', { apartmentId, floorName, roomCount })
}

export function renameFloor(floorId, floorName) {
  return invoke('room:renameFloor', { floorId, floorName })
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
