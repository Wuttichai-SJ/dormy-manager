// ตัวห่อ IPC ของผู้เช่า
// ช่องทั้งหมดอยู่ที่ src/main/handlers/tenantHandlers.js
import { invoke } from './ipc.js'

// ค้นทั้งระบบ (ข้ามหอ) — ใช้ตอนสร้างสัญญา ผู้เช่าอาจเคยอยู่หออื่นมาก่อน
export function listTenants(search) {
  return invoke('tenant:list', { search })
}

// เฉพาะผู้เช่าที่มีสัญญาในหอนี้ — ใช้ในหน้า "ผู้เช่า" ของหอ
export function listTenantsByApartment(apartmentId) {
  return invoke('tenant:listByApartment', { apartmentId })
}

export function getTenant(tenantId) {
  return invoke('tenant:get', { tenantId })
}

export function createTenant(payload) {
  return invoke('tenant:create', payload)
}

export function updateTenant(tenantId, payload) {
  return invoke('tenant:update', { tenantId, ...payload })
}

export function deleteTenant(tenantId) {
  return invoke('tenant:delete', { tenantId })
}
