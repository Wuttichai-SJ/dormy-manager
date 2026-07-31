// IPC ของโมดูลผู้เช่า — เปลือกบางๆ ครอบ db/tenants.js
// กฎเดียวกับ handler อื่น: คืน { success, data | error } เท่านั้น ห้าม throw ข้ามสะพาน
import { ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
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
      return { success: false, error: err.message }
    }
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
  handle('tenant:list', ({ search }) => listTenants(getDatabase(), { search }))

  // เฉพาะผู้เช่าที่มีสัญญาผูกกับห้องในหอนี้ — ใช้ในหน้า "ผู้เช่า" ของหอ
  handle('tenant:listByApartment', ({ apartmentId }) =>
    listTenantsByApartment(getDatabase(), apartmentId)
  )

  handle('tenant:get', ({ tenantId }) => {
    const tenant = getTenantById(getDatabase(), tenantId)
    if (!tenant) throw new Error('ไม่พบผู้เช่าที่ต้องการ')
    return tenant
  })

  handle('tenant:create', (payload) => {
    assertValid(payload)
    const tenant = insertTenant(getDatabase(), payload)
    logInfo(`เพิ่มผู้เช่า "${tenant.fullName}" (tenant_id ${tenant.tenantId})`)
    return tenant
  })

  handle('tenant:update', ({ tenantId, ...payload }) => {
    assertValid(payload)
    const tenant = updateTenant(getDatabase(), tenantId, payload)
    logInfo(`แก้ไขผู้เช่า "${tenant.fullName}" (tenant_id ${tenantId})`)
    return tenant
  })

  handle('tenant:delete', ({ tenantId }) => {
    const result = deleteTenant(getDatabase(), tenantId)
    logInfo(`ลบผู้เช่า (tenant_id ${tenantId})`)
    return result
  })
}
