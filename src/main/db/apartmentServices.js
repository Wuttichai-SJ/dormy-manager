// ตาราง apartment_services — ค่าบริการเพิ่มเติมของหอ (ค่าอินเทอร์เน็ต ค่าที่จอดรถ ฯลฯ)
//
// รายการที่นี่คือ "แคตตาล็อกของหอ" ยังไม่ผูกกับห้องไหน การผูกเข้าห้องอยู่ที่ตาราง
// room_services และตอนทำสัญญาจะถูกคัดลอกราคาไปที่ contract_services อีกที
// เพื่อให้การขึ้นราคาค่าบริการภายหลังไม่ย้อนไปเปลี่ยนสัญญาที่เซ็นไปแล้ว
import { toCents } from '../money.js'

// ค่าบริการมี 2 แบบ ตามที่ต้นแบบแบ่งไว้:
//   flat  = เหมาจ่ายต่อเดือน (ค่าส่วนกลาง ค่าอินเทอร์เน็ต)
//   meter = แปรผันตามมิเตอร์ คิดเป็นราคาต่อหน่วย (เช่นมิเตอร์น้ำอุ่นแยกของห้อง)
// SQLite ไม่มี ENUM — เก็บเป็น 0/1 ในคอลัมน์ is_meter_based แล้วตรวจที่ JS
export function serviceKind(row) {
  return row.is_meter_based === 1 ? 'meter' : 'flat'
}

// -----------------------------------------------------
// ตรวจข้อมูลก่อนเขียน
// -----------------------------------------------------
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

// เช็คชื่อซ้ำก่อน เพื่อให้ได้ข้อความที่ผู้ใช้อ่านรู้เรื่อง แทน UNIQUE constraint
// ของ SQLite ที่ขึ้นว่า "UNIQUE constraint failed: apartment_services.name"
function assertNameAvailable(db, apartmentId, name, exceptServiceId = null) {
  const row = db
    .prepare(
      `SELECT service_id FROM apartment_services
        WHERE apartment_id = ? AND name = ? AND service_id IS NOT ?`
    )
    .get(apartmentId, name, exceptServiceId)

  if (row) throw new Error(`มีค่าบริการชื่อ "${name}" ในหอพักนี้อยู่แล้ว`)
}

// -----------------------------------------------------
// อ่าน
// -----------------------------------------------------
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

// -----------------------------------------------------
// เขียน
// -----------------------------------------------------
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

// ลบได้เฉพาะค่าบริการที่ยังไม่ถูกใช้งานที่ไหน
// ห้องที่ผูกไว้ (room_services) และสัญญาที่อ้างถึง (contract_services) ต้องเคลียร์ก่อน
// ไม่งั้นบิลที่เคยออกไปแล้วจะอธิบายไม่ได้ว่าบรรทัดนั้นมาจากค่าบริการอะไร
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

// -----------------------------------------------------
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
