// แคตตาล็อกค่าบริการของหอ — ราคาถูกคัดลอกไป contract_services ตอนทำสัญญา
import { toCents } from '../money.js'

// is_meter_based: 0 = เหมาจ่าย, 1 = คิดตามหน่วยมิเตอร์
export function serviceKind(row) {
  return row.is_meter_based === 1 ? 'meter' : 'flat'
}

export function validateServiceInput({ name, price }) {
  const errors = []

  const trimmed = String(name ?? '').trim()
  if (!trimmed) errors.push('กรุณากรอกชื่อค่าบริการ')
  else if (trimmed.length > 255) errors.push('ชื่อค่าบริการยาวเกิน 255 ตัวอักษร')

  try {
    toCents(price, 'ราคา')
  } catch (err) {
    errors.push(err.message)
  }

  return errors
}

function assertNameAvailable(db, apartmentId, name, exceptServiceId = null) {
  const row = db
    .prepare(
      `SELECT service_id FROM apartment_services
        WHERE apartment_id = ? AND name = ? AND service_id IS NOT ?`
    )
    .get(apartmentId, name, exceptServiceId)

  if (row) throw new Error(`มีค่าบริการชื่อ "${name}" ในหอพักนี้อยู่แล้ว`)
}

export function listServices(db, apartmentId) {
  return db
    .prepare(
      `SELECT * FROM apartment_services
        WHERE apartment_id = ?
        ORDER BY name COLLATE NOCASE ASC`
    )
    .all(apartmentId)
    .map(toPublicService)
}

export function getServiceById(db, serviceId) {
  const row = db.prepare('SELECT * FROM apartment_services WHERE service_id = ?').get(serviceId)
  return row ? toPublicService(row) : null
}

export function insertService(db, apartmentId, input) {
  const name = String(input.name).trim()
  assertNameAvailable(db, apartmentId, name)

  const result = db
    .prepare(
      `INSERT INTO apartment_services
         (apartment_id, name, price_cents, is_vat_enabled, is_meter_based, created_at)
       VALUES (@apartmentId, @name, @priceCents, @isVatEnabled, @isMeterBased, @now)`
    )
    .run({
      apartmentId,
      name,
      priceCents: toCents(input.price, 'ราคา'),
      isVatEnabled: input.isVatEnabled ? 1 : 0,
      isMeterBased: input.isMeterBased ? 1 : 0,
      now: new Date().toISOString()
    })

  return getServiceById(db, result.lastInsertRowid)
}

export function updateService(db, serviceId, input) {
  const existing = db
    .prepare('SELECT apartment_id FROM apartment_services WHERE service_id = ?')
    .get(serviceId)
  if (!existing) throw new Error('ไม่พบค่าบริการที่ต้องการแก้ไข')

  const name = String(input.name).trim()
  assertNameAvailable(db, existing.apartment_id, name, serviceId)

  db.prepare(
    `UPDATE apartment_services SET
       name = @name,
       price_cents = @priceCents,
       is_vat_enabled = @isVatEnabled,
       is_meter_based = @isMeterBased,
       updated_at = @now
     WHERE service_id = @serviceId`
  ).run({
    serviceId,
    name,
    priceCents: toCents(input.price, 'ราคา'),
    isVatEnabled: input.isVatEnabled ? 1 : 0,
    isMeterBased: input.isMeterBased ? 1 : 0,
    now: new Date().toISOString()
  })

  return getServiceById(db, serviceId)
}

// ลบได้เฉพาะที่ยังไม่ถูกผูกกับห้องหรือสัญญา
export function deleteService(db, serviceId) {
  const roomLinks = db
    .prepare('SELECT COUNT(*) AS n FROM room_services WHERE apartment_service_id = ?')
    .get(serviceId).n
  if (roomLinks > 0) {
    throw new Error(
      `ลบไม่ได้ เพราะค่าบริการนี้ถูกผูกกับห้องพักอยู่ ${roomLinks} ห้อง กรุณานำออกจากห้องก่อน`
    )
  }

  const contractLinks = db
    .prepare('SELECT COUNT(*) AS n FROM contract_services WHERE apartment_service_id = ?')
    .get(serviceId).n
  if (contractLinks > 0) {
    throw new Error('ลบไม่ได้ เพราะค่าบริการนี้ถูกใช้ในสัญญาเช่าแล้ว')
  }

  const result = db.prepare('DELETE FROM apartment_services WHERE service_id = ?').run(serviceId)
  if (result.changes === 0) throw new Error('ไม่พบค่าบริการที่ต้องการลบ')
  return { ok: true }
}

export function toPublicService(row) {
  if (!row) return null
  return {
    serviceId: row.service_id,
    apartmentId: row.apartment_id,
    name: row.name,
    priceCents: row.price_cents,
    isVatEnabled: row.is_vat_enabled === 1,
    isMeterBased: row.is_meter_based === 1,
    kind: serviceKind(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
