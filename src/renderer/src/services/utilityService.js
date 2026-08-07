// ตัวห่อ IPC ของการคิดค่าน้ำ/ค่าไฟ
// ช่องทั้งหมดอยู่ที่ src/main/handlers/utilityHandlers.js
import { invoke } from './ipc.js'

export function getUtilityDefaults(apartmentId) {
  return invoke('utility:get', { apartmentId })
}

export function saveUtilityDefaults(apartmentId, { water, electric }) {
  return invoke('utility:save', { apartmentId, water, electric })
}

// ทับราคาของห้องทั้งหมดด้วยราคาปัจจุบันของหอ — ปกติราคาถูกคัดลอกลงห้องตอนสร้างห้อง
// ครั้งเดียว ตัวนี้ไว้ใช้ตอนที่ห้องถูกสร้างไปก่อนจะตั้งราคา หรืออยากรีเซ็ตราคารายห้องทิ้ง
export function applyUtilityDefaultsToRooms(apartmentId) {
  return invoke('utility:applyToRooms', { apartmentId })
}
