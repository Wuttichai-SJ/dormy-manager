// ตาราง apartments — SQL ดิบล้วน ไม่มี ORM (ดู .claude/skills/dormy-manager)
//
// รับ `db` เป็นพารามิเตอร์ตัวแรกเสมอเหมือน db/users.js เพื่อให้ชุดทดสอบเปิดฐานข้อมูล
// ชั่วคราวของตัวเองได้
import { toCents } from '../money.js'

// วันครบกำหนดชำระเลือกได้ถึงวันที่ 28 เท่านั้น (ต้นแบบก็ทำแบบนี้) — ไม่ใช่ 31
// เพราะถ้าเจ้าของตั้งวันที่ 31 ไว้ เดือนกุมภาพันธ์กับเดือนที่มี 30 วันจะไม่มีวันนั้นอยู่จริง
// แล้วระบบต้องมาเดาว่าจะเลื่อนไปวันไหน ซึ่งเดาผิดทีเดียวคือคิดค่าปรับผิดทั้งหอ
export const MAX_DUE_DATE_DAY = 28

// ข้อความบรรทัดค่าเช่าบนใบแจ้งหนี้ของหอที่เพิ่งสร้าง — ไทยล้วน ไม่มีอังกฤษพ่วง
// เจ้าของหอแก้เป็นข้อความของตัวเองได้ที่หน้าตั้งค่าหอ
export const DEFAULT_RENT_ITEM_TEXT = 'ค่าเช่าห้อง'

// -----------------------------------------------------
// ตรวจข้อมูลก่อนเขียน
// -----------------------------------------------------
// คืนข้อผิดพลาดทั้งหมดพร้อมกัน ไม่ใช่ throw ตัวแรกที่เจอ (เหมือน validateUserInput)
export function validateApartmentInput({ nameTh, addressTh, dueDateDay, lateFeePerDay }) {
  const errors = []

  if (!String(nameTh ?? '').trim()) errors.push('กรุณากรอกชื่อหอพัก (ภาษาไทย)')
  else if (String(nameTh).trim().length > 255) errors.push('ชื่อหอพักยาวเกิน 255 ตัวอักษร')

  if (!String(addressTh ?? '').trim()) errors.push('กรุณากรอกที่อยู่ (ภาษาไทย)')

  const day = Number(dueDateDay)
  if (!Number.isInteger(day) || day < 1 || day > MAX_DUE_DATE_DAY) {
    errors.push(`วันสุดท้ายของการชำระเงินต้องเป็นวันที่ 1-${MAX_DUE_DATE_DAY}`)
  }

  // ค่าปรับเป็น 0 ได้ (หอที่ไม่คิดค่าปรับ) แต่ต้องกรอก ไม่ใช่เว้นว่าง
  try {
    toCents(lateFeePerDay, 'ค่าปรับชำระล่าช้าต่อวัน')
  } catch (err) {
    errors.push(err.message)
  }

  return errors
}

// แปลงค่าจากฟอร์มเป็นรูปที่พร้อมเขียนลงตาราง ใช้ร่วมกันทั้งตอนสร้างและตอนแก้ไข
// เก็บช่องที่ไม่บังคับเป็น NULL เมื่อเว้นว่าง ไม่เก็บสตริงว่าง จะได้แยกออกว่า
// "ยังไม่ได้กรอก" ต่างจาก "กรอกเป็นค่าว่างโดยตั้งใจ"
function toRow(input) {
  const optional = (value) => {
    const trimmed = String(value ?? '').trim()
    return trimmed === '' ? null : trimmed
  }

  return {
    nameTh: String(input.nameTh).trim(),
    nameEn: optional(input.nameEn),
    addressTh: String(input.addressTh).trim(),
    addressEn: optional(input.addressEn),
    phone: optional(input.phone),
    logoUrl: optional(input.logoUrl),
    dueDateDay: Number(input.dueDateDay),
    lateFeePerDayCents: toCents(input.lateFeePerDay, 'ค่าปรับชำระล่าช้าต่อวัน'),
    isAutoLateFeeEnabled: input.isAutoLateFeeEnabled ? 1 : 0,
    isVatEnabled: input.isVatEnabled ? 1 : 0
  }
}

// -----------------------------------------------------
// อ่าน
// -----------------------------------------------------
// นับห้องด้วย subquery แทน JOIN + GROUP BY เพราะหอที่ยังไม่มีชั้น/ห้องเลยต้องขึ้นในรายการ
// ด้วย (นับได้ 0) ถ้าใช้ JOIN ธรรมดาหอเปล่าจะหายไปทั้งแถว
const LIST_SQL = `
  SELECT
    a.*,
    (SELECT COUNT(*)
       FROM rooms r JOIN floors f ON f.floor_id = r.floor_id
      WHERE f.apartment_id = a.apartment_id) AS total_rooms,
    (SELECT COUNT(*)
       FROM rooms r JOIN floors f ON f.floor_id = r.floor_id
      WHERE f.apartment_id = a.apartment_id AND r.status = 'vacant') AS vacant_rooms
  FROM apartments a
  ORDER BY a.display_order ASC, a.apartment_id ASC
`

export function listApartments(db) {
  return db.prepare(LIST_SQL).all().map(toPublicApartment)
}

export function getApartmentById(db, apartmentId) {
  const row = db.prepare('SELECT * FROM apartments WHERE apartment_id = ?').get(apartmentId)
  return row ? toPublicApartment(row) : null
}

export function countApartments(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM apartments').get().n
}

// ปิดงานตั้งค่า — เรียกตอนเจ้าของหอกด "เสร็จสิ้น" ที่ขั้นสุดท้ายของตัวช่วยตั้งค่าเท่านั้น
// ก่อนหน้านั้นหอยังเข้าหน้าทำงาน (ที่มีเมนูข้าง) ไม่ได้ ดู 008_apartment_setup_completed.sql
//
// กดซ้ำได้ไม่เป็นไร แต่ไม่ทับเวลาเดิม เพราะอยากได้เวลาที่ "ตั้งค่าเสร็จครั้งแรก"
export function markSetupCompleted(db, apartmentId) {
  const result = db
    .prepare(
      `UPDATE apartments SET setup_completed_at = ?
        WHERE apartment_id = ? AND setup_completed_at IS NULL`
    )
    .run(new Date().toISOString(), apartmentId)

  if (result.changes === 0 && !getApartmentById(db, apartmentId)) {
    throw new Error('ไม่พบหอพักที่ต้องการ')
  }
  return getApartmentById(db, apartmentId)
}

// -----------------------------------------------------
// เขียน
// -----------------------------------------------------
export function insertApartment(db, input) {
  const row = toRow(input)
  const now = new Date().toISOString()

  // หอใหม่ไปต่อท้ายรายการเสมอ ไม่แทรกกลาง — เจ้าของค่อยลากจัดลำดับเองทีหลัง
  const nextOrder =
    (db.prepare('SELECT MAX(display_order) AS m FROM apartments').get().m ?? 0) + 1

  const result = db
    .prepare(
      `INSERT INTO apartments (
         logo_url, name_th, name_en, address_th, address_en, phone,
         late_fee_per_day_cents, is_auto_late_fee_enabled, due_date_day, is_vat_enabled,
         default_rent_item_text, display_order, created_at
       ) VALUES (
         @logoUrl, @nameTh, @nameEn, @addressTh, @addressEn, @phone,
         @lateFeePerDayCents, @isAutoLateFeeEnabled, @dueDateDay, @isVatEnabled,
         @rentItemText, @displayOrder, @now
       )`
    )
    // เขียนค่านี้เอง ไม่พึ่ง DEFAULT ของคอลัมน์ — DEFAULT ใน 001_init.sql ยังเป็น
    // 'ค่าเช่าห้อง/Rent' และ SQLite แก้ DEFAULT ของคอลัมน์ทีหลังไม่ได้ (ต้องสร้างตารางใหม่
    // ทั้งใบ ซึ่งไม่คุ้มเสี่ยงกับตารางที่มีข้อมูลจริง — ดู migration 016)
    //
    // ข้อความที่ผู้ใช้ตั้งเองจะถูกแก้ผ่าน updateApartment ตามปกติ
    .run({ ...row, rentItemText: DEFAULT_RENT_ITEM_TEXT, displayOrder: nextOrder, now })

  return getApartmentById(db, result.lastInsertRowid)
}

export function updateApartment(db, apartmentId, input) {
  const row = toRow(input)

  const result = db
    .prepare(
      `UPDATE apartments SET
         logo_url = @logoUrl,
         name_th = @nameTh,
         name_en = @nameEn,
         address_th = @addressTh,
         address_en = @addressEn,
         phone = @phone,
         late_fee_per_day_cents = @lateFeePerDayCents,
         is_auto_late_fee_enabled = @isAutoLateFeeEnabled,
         due_date_day = @dueDateDay,
         is_vat_enabled = @isVatEnabled,
         updated_at = @now
       WHERE apartment_id = @apartmentId`
    )
    .run({ ...row, apartmentId, now: new Date().toISOString() })

  if (result.changes === 0) throw new Error('ไม่พบหอพักที่ต้องการแก้ไข')
  return getApartmentById(db, apartmentId)
}

// จัดลำดับใหม่ทั้งชุดในทีเดียว (หน้าจอส่งลำดับ apartment_id ที่เรียงแล้วมาให้)
// ทำใน transaction เพราะถ้าเขียนสำเร็จครึ่งเดียว ลำดับจะซ้ำ/ข้ามและการ์ดสลับมั่ว
export function reorderApartments(db, orderedIds) {
  const stmt = db.prepare('UPDATE apartments SET display_order = ? WHERE apartment_id = ?')
  const run = db.transaction((ids) => {
    ids.forEach((id, index) => stmt.run(index + 1, id))
  })
  run(orderedIds)
  return listApartments(db)
}

// ลบได้เฉพาะหอที่ยังไม่มีอะไรผูกอยู่ — ห้ามลบหอที่มีชั้น/ห้อง/ผู้ใช้ที่ผูกสิทธิ์ไว้
// เพราะประวัติบิลและสัญญาทั้งหมดอ้างถึงห้องในหอนั้น ลบทิ้งแล้วรายงานย้อนหลังพัง
// (FK ช่วยกันได้ระดับหนึ่ง แต่ข้อความ error ของ SQLite ผู้ใช้อ่านไม่รู้เรื่อง)
export function deleteApartment(db, apartmentId) {
  const floors = db
    .prepare('SELECT COUNT(*) AS n FROM floors WHERE apartment_id = ?')
    .get(apartmentId).n
  if (floors > 0) {
    throw new Error('ลบไม่ได้ เพราะหอพักนี้มีชั้น/ห้องพักอยู่แล้ว กรุณาลบห้องและชั้นก่อน')
  }

  const run = db.transaction(() => {
    // ตารางลูกที่ไม่มีห้องมาเกี่ยวข้อง ลบพร้อมกันได้ในธุรกรรมเดียว
    //
    // ทุกตารางที่มี apartment_id ต้องอยู่ในรายการนี้ครบ ถ้าตกไปตารางเดียว FK จะบล็อก
    // การลบแล้วโยนข้อความดิบของ SQLite ("FOREIGN KEY constraint failed") ออกไปที่หน้าจอ
    // ซึ่งเจ้าของหออ่านไม่รู้เรื่องและดูเหมือนปุ่มลบเสีย — เคยหลุด apartment_utility_defaults
    // มาแล้วครั้งหนึ่ง เพิ่มตารางใหม่ที่ผูกกับหอเมื่อไหร่ ต้องกลับมาเพิ่มที่นี่ด้วย
    db.prepare('DELETE FROM apartment_utility_defaults WHERE apartment_id = ?').run(apartmentId)
    db.prepare('DELETE FROM apartment_services WHERE apartment_id = ?').run(apartmentId)
    db.prepare('DELETE FROM apartment_bank_accounts WHERE apartment_id = ?').run(apartmentId)
    db.prepare('DELETE FROM users_apartments WHERE apartment_id = ?').run(apartmentId)
    db.prepare('DELETE FROM document_counters WHERE apartment_id = ?').run(apartmentId)
    db.prepare('DELETE FROM invoice_deletions WHERE apartment_id = ?').run(apartmentId)
    // ใบจดมิเตอร์ที่ยังไม่มีห้องผูกอยู่เท่านั้นที่มาถึงตรงนี้ได้ (หอที่มีห้องถูกกันไปตั้งแต่ต้น)
    db.prepare(
      `DELETE FROM meter_readings
        WHERE meter_batch_id IN (SELECT batch_id FROM meter_batches WHERE apartment_id = ?)`
    ).run(apartmentId)
    db.prepare('DELETE FROM meter_batches WHERE apartment_id = ?').run(apartmentId)
    const result = db.prepare('DELETE FROM apartments WHERE apartment_id = ?').run(apartmentId)
    if (result.changes === 0) throw new Error('ไม่พบหอพักที่ต้องการลบ')
  })
  run()
  return { ok: true }
}

// -----------------------------------------------------
// รูปแบบที่ส่งออกไปให้หน้าจอ — แปลงชื่อคอลัมน์เป็น camelCase และ 0/1 เป็น boolean
// ที่เดียวที่ฝั่งหน้าจอต้องรู้จัก ไม่ต้องไปรู้ชื่อคอลัมน์ในตาราง
// -----------------------------------------------------
export function toPublicApartment(row) {
  if (!row) return null
  return {
    apartmentId: row.apartment_id,
    logoUrl: row.logo_url,
    nameTh: row.name_th,
    nameEn: row.name_en,
    addressTh: row.address_th,
    addressEn: row.address_en,
    phone: row.phone,
    lateFeePerDayCents: row.late_fee_per_day_cents,
    isAutoLateFeeEnabled: row.is_auto_late_fee_enabled === 1,
    dueDateDay: row.due_date_day,
    isVatEnabled: row.is_vat_enabled === 1,
    displayOrder: row.display_order,
    // null = ยังเดินตัวช่วยตั้งค่าไม่ครบ หน้าจอใช้ค่านี้ตัดสินว่าจะให้เข้าหน้าทำงานได้ไหม
    setupCompletedAt: row.setup_completed_at ?? null,
    isSetupComplete: Boolean(row.setup_completed_at),
    // มีเฉพาะตอนดึงจากรายการ (LIST_SQL) — หน้าฟอร์มไม่ต้องใช้
    totalRooms: row.total_rooms,
    vacantRooms: row.vacant_rooms,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
