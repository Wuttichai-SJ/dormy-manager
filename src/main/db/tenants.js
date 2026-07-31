// ตาราง tenants — SQL ดิบล้วน ไม่มี ORM (ดู .claude/skills/dormy-manager)
//
// ผู้เช่าเป็นข้อมูล "กลาง" ไม่ผูกกับหอใดหอหนึ่ง (ไม่มีคอลัมน์ apartment_id)
// ความสัมพันธ์กับหอเกิดผ่านสัญญาเท่านั้น: tenants → contracts → rooms → floors → apartments
//
// ทำไมถึงออกแบบแบบนี้: เจ้าของมี 3 หอ และผู้เช่าคนเดียวกันย้ายข้ามหอได้จริง
// ถ้าแยกผู้เช่าตามหอ คนเดิมจะกลายเป็นคนละระเบียน แล้วประวัติการเช่าขาดตอน
// ตามหนี้เก่าข้ามหอไม่ได้ และเลขบัตรประชาชนจะซ้ำข้ามหอโดยระบบไม่รู้ตัว

// ------------------------------------------------------------------
// ตรวจข้อมูลก่อนเขียน
// ------------------------------------------------------------------
// คืนข้อผิดพลาดทั้งหมดพร้อมกัน ไม่ใช่ throw ตัวแรกที่เจอ (แบบเดียวกับ db/apartments.js)
export function validateTenantInput({ firstName, lastName, phone, idCardNo }) {
  const errors = []

  if (!String(firstName ?? '').trim()) errors.push('กรุณากรอกชื่อผู้เช่า')
  if (!String(lastName ?? '').trim()) errors.push('กรุณากรอกนามสกุลผู้เช่า')

  const digits = onlyDigits(phone)
  if (!digits) errors.push('กรุณากรอกเบอร์โทรศัพท์')
  else if (digits.length < 9 || digits.length > 10) {
    errors.push('เบอร์โทรศัพท์ต้องมี 9-10 หลัก')
  }

  // เลขบัตรประชาชนไม่บังคับ (ดู 009_tenants_optional_id_card.sql) แต่ถ้ากรอกมาต้องครบ 13 หลัก
  const idCard = onlyDigits(idCardNo)
  if (idCard && idCard.length !== 13) errors.push('เลขบัตรประชาชนต้องมี 13 หลัก')

  return errors
}

// เก็บเบอร์/เลขบัตรเป็นตัวเลขล้วนเสมอ — คนกรอกใส่ขีดบ้างเว้นวรรคบ้าง ถ้าเก็บตามที่พิมพ์
// เลขเดียวกันจะกลายเป็นคนละค่าแล้ว UNIQUE กันซ้ำไม่ได้ และค้นหาก็ไม่เจอ
function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '')
}

function toRow(input) {
  const optional = (value) => {
    const trimmed = String(value ?? '').trim()
    return trimmed === '' ? null : trimmed
  }

  return {
    firstName: String(input.firstName).trim(),
    lastName: String(input.lastName).trim(),
    phone: onlyDigits(input.phone),
    // ว่าง = NULL ไม่ใช่สตริงว่าง ไม่งั้น UNIQUE จะมองว่าคนที่ไม่กรอกทุกคน "ซ้ำกัน"
    idCardNo: onlyDigits(input.idCardNo) || null,
    address: optional(input.address),
    emergencyContactName: optional(input.emergencyContactName),
    emergencyRelation: optional(input.emergencyRelation),
    emergencyPhone: onlyDigits(input.emergencyPhone) || null,
    note: optional(input.note)
  }
}

// UNIQUE ของ SQLite ให้ข้อความที่คนอ่านไม่รู้เรื่อง ("UNIQUE constraint failed:
// tenants.phone") จึงเช็คเองก่อนเพื่อบอกได้ว่าชนกับใคร
function assertNotDuplicate(db, row, exceptTenantId = null) {
  const clash = db
    .prepare(
      `SELECT tenant_id, first_name, last_name, phone, id_card_no
         FROM tenants
        WHERE (phone = @phone OR (@idCardNo IS NOT NULL AND id_card_no = @idCardNo))
          AND tenant_id IS NOT @exceptTenantId
        LIMIT 1`
    )
    .get({ phone: row.phone, idCardNo: row.idCardNo, exceptTenantId })

  if (!clash) return

  const name = `${clash.first_name} ${clash.last_name}`
  if (clash.phone === row.phone) {
    throw new Error(`เบอร์ ${row.phone} ถูกใช้กับผู้เช่า "${name}" อยู่แล้ว`)
  }
  throw new Error(`เลขบัตรประชาชนนี้ถูกใช้กับผู้เช่า "${name}" อยู่แล้ว`)
}

// ------------------------------------------------------------------
// อ่าน
// ------------------------------------------------------------------
// นับสัญญาที่ยัง active มาด้วย เพื่อให้หน้าจอบอกได้ทันทีว่าใครกำลังเช่าอยู่/ใครย้ายออกแล้ว
// โดยไม่ต้องยิงคำถามเพิ่มรายคน
const LIST_SQL = `
  SELECT
    t.*,
    (SELECT COUNT(*) FROM contracts c
      WHERE c.tenant_id = t.tenant_id AND c.status = 'active') AS active_contracts
  FROM tenants t
`

export function listTenants(db, { search } = {}) {
  const keyword = String(search ?? '').trim()

  if (!keyword) {
    return db.prepare(`${LIST_SQL} ORDER BY t.first_name, t.last_name`).all().map(toPublicTenant)
  }

  // ค้นได้ทั้งชื่อ นามสกุล เบอร์ และเลขบัตร — เจ้าหน้าที่จำได้อย่างเดียวว่าอะไรก็ค้นเจอ
  // เบอร์/เลขบัตรที่พิมพ์มาต้องตัดขีดออกก่อน เพราะในฐานข้อมูลเก็บเป็นตัวเลขล้วน
  const digits = onlyDigits(keyword)
  return db
    .prepare(
      `${LIST_SQL}
       WHERE t.first_name LIKE @like
          OR t.last_name LIKE @like
          OR (@digits <> '' AND t.phone LIKE @digitsLike)
          OR (@digits <> '' AND t.id_card_no LIKE @digitsLike)
       ORDER BY t.first_name, t.last_name`
    )
    .all({ like: `%${keyword}%`, digits, digitsLike: `%${digits}%` })
    .map(toPublicTenant)
}

// ผู้เช่าของหอหนึ่ง = คนที่มีสัญญาผูกกับห้องในหอนั้น (จะยังอยู่หรือย้ายออกแล้วก็ตาม)
// หน้า "ผู้เช่า" ในหอใช้ตัวนี้ ส่วนตอนสร้างสัญญาใช้ listTenants เพื่อค้นทั้งระบบ
export function listTenantsByApartment(db, apartmentId) {
  return db
    .prepare(
      `${LIST_SQL}
       WHERE EXISTS (
         SELECT 1 FROM contracts c
           JOIN rooms r ON r.room_id = c.room_id
           JOIN floors f ON f.floor_id = r.floor_id
          WHERE c.tenant_id = t.tenant_id AND f.apartment_id = ?
       )
       ORDER BY t.first_name, t.last_name`
    )
    .all(apartmentId)
    .map(toPublicTenant)
}

export function getTenantById(db, tenantId) {
  const row = db.prepare(`${LIST_SQL} WHERE t.tenant_id = ?`).get(tenantId)
  return row ? toPublicTenant(row) : null
}

// ------------------------------------------------------------------
// เขียน
// ------------------------------------------------------------------
export function insertTenant(db, input) {
  const row = toRow(input)
  assertNotDuplicate(db, row)

  const result = db
    .prepare(
      `INSERT INTO tenants (
         first_name, last_name, phone, id_card_no, address,
         emergency_contact_name, emergency_relation, emergency_phone, note, created_at
       ) VALUES (
         @firstName, @lastName, @phone, @idCardNo, @address,
         @emergencyContactName, @emergencyRelation, @emergencyPhone, @note, @now
       )`
    )
    .run({ ...row, now: new Date().toISOString() })

  return getTenantById(db, result.lastInsertRowid)
}

export function updateTenant(db, tenantId, input) {
  const row = toRow(input)
  assertNotDuplicate(db, row, tenantId)

  const result = db
    .prepare(
      `UPDATE tenants SET
         first_name = @firstName,
         last_name = @lastName,
         phone = @phone,
         id_card_no = @idCardNo,
         address = @address,
         emergency_contact_name = @emergencyContactName,
         emergency_relation = @emergencyRelation,
         emergency_phone = @emergencyPhone,
         note = @note,
         updated_at = @now
       WHERE tenant_id = @tenantId`
    )
    .run({ ...row, tenantId, now: new Date().toISOString() })

  if (result.changes === 0) throw new Error('ไม่พบผู้เช่าที่ต้องการแก้ไข')
  return getTenantById(db, tenantId)
}

// ลบได้เฉพาะผู้เช่าที่ไม่เคยมีสัญญาเลย (กรอกผิดคนแล้วอยากลบทิ้ง)
// คนที่เคยเช่าจริงห้ามลบ เพราะบิลและใบเสร็จย้อนหลังอ้างถึงสัญญาที่อ้างถึงคนนี้
export function deleteTenant(db, tenantId) {
  const contracts = db
    .prepare('SELECT COUNT(*) AS n FROM contracts WHERE tenant_id = ?')
    .get(tenantId).n
  if (contracts > 0) {
    throw new Error('ลบไม่ได้ เพราะผู้เช่ารายนี้มีประวัติสัญญาเช่าอยู่ในระบบ')
  }

  const result = db.prepare('DELETE FROM tenants WHERE tenant_id = ?').run(tenantId)
  if (result.changes === 0) throw new Error('ไม่พบผู้เช่าที่ต้องการลบ')
  return { ok: true }
}

// ------------------------------------------------------------------
// รูปแบบที่ส่งออกไปให้หน้าจอ — camelCase ที่เดียว หน้าจอไม่ต้องรู้ชื่อคอลัมน์
// ------------------------------------------------------------------
export function toPublicTenant(row) {
  if (!row) return null
  return {
    tenantId: row.tenant_id,
    firstName: row.first_name,
    lastName: row.last_name,
    fullName: `${row.first_name} ${row.last_name}`,
    phone: row.phone,
    idCardNo: row.id_card_no,
    address: row.address,
    emergencyContactName: row.emergency_contact_name,
    emergencyRelation: row.emergency_relation,
    emergencyPhone: row.emergency_phone,
    note: row.note,
    // มีเฉพาะตอนดึงผ่าน LIST_SQL — บอกว่าตอนนี้กำลังเช่าอยู่กี่ห้อง
    activeContracts: row.active_contracts ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
