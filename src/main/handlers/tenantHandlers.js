// IPC ของโมดูลผู้เช่า — เปลือกบางๆ ครอบ db/tenants.js
// กฎเดียวกับ handler อื่น: คืน { success, data | error } เท่านั้น ห้าม throw ข้ามสะพาน
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { requireSessionUserId } from './authHandlers.js'
import {
  deleteTenant,
  getTenantById,
  insertTenant,
  listTenants,
  listTenantsByApartment,
  updateTenant,
  validateTenantInput
} from '../db/tenants.js'

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { success: true, data: await fn(payload ?? {}) }
    } catch (err) {
      logError(`${channel} ล้มเหลว`, err)
      return { success: false, error: err.message, fields: err.fields }
    }
  })
}

// ช่องที่ห่อด้วยตัวนี้ต้องเข้าสู่ระบบก่อน — เหตุผลเต็ม (ภัยจาก DevTools ตอนหน้าจอค้างที่
// ล็อกอิน และช่องไหนห้ามใส่การ์ด) อยู่เหนือ requireSessionUserId() ใน authHandlers.js
function handleSession(channel, fn) {
  handle(channel, (payload) => {
    requireSessionUserId()
    return fn(payload)
  })
}

// ตรวจก่อนแตะฐานข้อมูลเสมอ และรวมข้อผิดพลาดทุกข้อเป็นข้อความเดียว
// เพื่อให้ผู้ใช้แก้ทีเดียวจบ ไม่ใช่กดบันทึกแล้วโดนไล่บอกทีละข้อ
function assertValid(payload) {
  const errors = validateTenantInput(payload)
  if (errors.length > 0) throw new Error(errors.join('\n'))
}

export function registerTenantHandlers() {
  // ค้นทั้งระบบ — ใช้ตอนสร้างสัญญา เพราะผู้เช่าอาจเคยอยู่หออื่นมาก่อน
  handleSession('tenant:list', ({ search }) => listTenants(getDatabase(), { search }))

  // เฉพาะผู้เช่าที่มีสัญญาผูกกับห้องในหอนี้ — ใช้ในหน้า "ผู้เช่า" ของหอ
  handleSession('tenant:listByApartment', ({ apartmentId }) =>
    listTenantsByApartment(getDatabase(), apartmentId)
  )

  handleSession('tenant:get', ({ tenantId }) => {
    const tenant = getTenantById(getDatabase(), tenantId)
    if (!tenant) throw new Error('ไม่พบผู้เช่าที่ต้องการ')
    return tenant
  })

  handleSession('tenant:create', (payload) => {
    assertValid(payload)
    const tenant = insertTenant(getDatabase(), payload)
    logInfo(`เพิ่มผู้เช่า "${tenant.fullName}" (tenant_id ${tenant.tenantId})`)
    return tenant
  })

  handleSession('tenant:update', ({ tenantId, ...payload }) => {
    assertValid(payload)
    const tenant = updateTenant(getDatabase(), tenantId, payload)
    logInfo(`แก้ไขผู้เช่า "${tenant.fullName}" (tenant_id ${tenantId})`)
    return tenant
  })

  handleSession('tenant:delete', ({ tenantId }) => {
    const result = deleteTenant(getDatabase(), tenantId)
    logInfo(`ลบผู้เช่า (tenant_id ${tenantId})`)
    return result
  })
}
