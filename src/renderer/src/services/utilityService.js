// ตัวห่อ IPC ของการคิดค่าน้ำ/ค่าไฟ
// ช่องทั้งหมดอยู่ที่ src/main/handlers/utilityHandlers.js
import { invoke } from './ipc.js'

export function getUtilityDefaults(apartmentId) {
  return invoke('utility:get', { apartmentId })
}

export function saveUtilityDefaults(apartmentId, { water, electric }) {
  return invoke('utility:save', { apartmentId, water, electric })
}
