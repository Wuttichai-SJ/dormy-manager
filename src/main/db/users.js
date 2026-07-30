// ตาราง users — SQL ดิบล้วน ไม่มี ORM (ดู .claude/skills/dormy-manager)
//
// ทุกฟังก์ชันรับ `db` เป็นพารามิเตอร์ตัวแรก ไม่ได้ import ตัว singleton มาใช้ตรงๆ
// เพื่อให้ชุดทดสอบชี้ไปที่ฐานข้อมูลชั่วคราวของตัวเองได้ ส่วน handler ในแอปจริงเป็นฝ่าย
// ส่ง getDatabase() เข้ามา — SQL ยังอยู่รวมที่ไฟล์นี้ที่เดียวเหมือนเดิม

// -----------------------------------------------------
// การตรวจข้อมูลก่อนเขียนลงฟิลด์
// -----------------------------------------------------
export const PASSWORD_MIN_LENGTH = 8

// เก็บเบอร์โทรเป็น "ตัวเลขล้วน" เสมอ เพื่อให้ 081-234-5678 กับ 0812345678 คือคนเดียวกัน
// ทั้งตอนสมัครและตอน login (ถ้าไม่ normalize ผู้ใช้จะสมัครด้วยขีดแล้ว login แบบไม่มีขีดไม่ได้)
export function normalizePhone(phone) {
  return String(phone ?? '').replace(/[^\d]/g, '')
}

// อีเมลเป็นฟิลด์ที่ไม่บังคับ: ไม่กรอก = NULL เท่านั้น ห้ามเป็นสตริงว่าง
// เพราะ unique index ยอมให้ NULL ซ้ำกันได้ แต่สตริงว่างซ้ำกันไม่ได้ (ดู 002_*.sql)
export function normalizeEmail(email) {
  const trimmed = String(email ?? '').trim().toLowerCase()
  return trimmed === '' ? null : trimmed
}

// คืนรายการข้อผิดพลาดทั้งหมดพร้อมกัน ไม่ใช่ throw ตัวแรกที่เจอ
// เพื่อให้หน้าจอไฮไลต์ทุกช่องที่ผิดในครั้งเดียว ไม่ต้องให้ผู้ใช้กดบันทึกซ้ำทีละรอบ
export function validateUserInput({ fullName, phone, email, password }) {
  const errors = []

  if (!String(fullName ?? '').trim()) errors.push('กรุณากรอกชื่อ-นามสกุล')
  else if (String(fullName).trim().length > 255) errors.push('ชื่อ-นามสกุลยาวเกิน 255 ตัวอักษร')

  const digits = normalizePhone(phone)
  if (!digits) errors.push('กรุณากรอกเบอร์โทรศัพท์')
  else if (digits.length < 9 || digits.length > 15) errors.push('เบอร์โทรศัพท์ต้องมี 9-15 หลัก')

  const mail = normalizeEmail(email)
  // ตรวจแบบหลวมๆ โดยตั้งใจ: ต้องมี @ และมีอะไรอยู่สองข้าง เท่านั้น
  // regex อีเมลแบบเข้มมักปฏิเสธอีเมลที่ใช้งานได้จริง และแอปนี้ไม่ได้ส่งเมลอยู่แล้ว
  if (mail !== null && !/^[^@\s]+@[^@\s]+$/.test(mail)) errors.push('รูปแบบอีเมลไม่ถูกต้อง')

  if (!password) errors.push('กรุณากรอกรหัสผ่าน')
  else if (String(password).length < PASSWORD_MIN_LENGTH)
    errors.push(`รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`)

  return errors
}

// -----------------------------------------------------
// คำสั่ง SQL
// -----------------------------------------------------
export function countUsers(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n
}

export function getUserById(db, userId) {
  return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId)
}

// ค้นหาจากช่องเดียวที่รับได้ทั้งอีเมลและเบอร์โทร (ตามหน้า login ของต้นแบบ)
export function findUserByIdentifier(db, identifier) {
  const raw = String(identifier ?? '').trim()
  if (!raw) return undefined

  if (raw.includes('@')) {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(raw))
  }
  const digits = normalizePhone(raw)
  if (!digits) return undefined
  return db.prepare('SELECT * FROM users WHERE phone = ?').get(digits)
}

// เขียนแถวผู้ใช้ใหม่ ผู้เรียกต้องส่ง hash มาแล้วเท่านั้น (passwordHash / recoveryCodeHash)
// ฟังก์ชันนี้ไม่รู้จักและไม่รับรหัสผ่านตัวจริง เพื่อไม่ให้มีทางเผลอเขียน plaintext ลงตาราง
export function insertUser(db, { fullName, phone, email, passwordHash, recoveryCodeHash }) {
  const now = new Date().toISOString()
  const result = db
    .prepare(
      `INSERT INTO users (full_name, phone, password, email, recovery_code_hash, is_active, created_at, updated_at)
       VALUES (@fullName, @phone, @passwordHash, @email, @recoveryCodeHash, 1, @now, @now)`
    )
    .run({
      fullName: String(fullName).trim(),
      phone: normalizePhone(phone),
      email: normalizeEmail(email),
      passwordHash,
      recoveryCodeHash: recoveryCodeHash ?? null,
      now
    })
  return getUserById(db, result.lastInsertRowid)
}

export function updatePassword(db, userId, passwordHash) {
  db.prepare('UPDATE users SET password = ?, updated_at = ? WHERE user_id = ?').run(
    passwordHash,
    new Date().toISOString(),
    userId
  )
}

export function updateRecoveryCodeHash(db, userId, recoveryCodeHash) {
  db.prepare('UPDATE users SET recovery_code_hash = ?, updated_at = ? WHERE user_id = ?').run(
    recoveryCodeHash,
    new Date().toISOString(),
    userId
  )
}

// เปลี่ยนรหัสผ่านและออกรหัสสำรองใหม่ต้องเกิดขึ้นพร้อมกันหรือไม่เกิดเลย
// ถ้าเขียนรหัสผ่านใหม่สำเร็จแต่รหัสสำรองพลาด ผู้ใช้จะเหลือรหัสสำรองใบเก่าที่หน้าจอ
// เพิ่งบอกไปว่า "ใช้ไม่ได้แล้ว" = ล็อกตัวเองออกจากระบบถาวร
export function replacePasswordAndRecoveryCode(db, userId, passwordHash, recoveryCodeHash) {
  const run = db.transaction(() => {
    updatePassword(db, userId, passwordHash)
    updateRecoveryCodeHash(db, userId, recoveryCodeHash)
  })
  run()
  return getUserById(db, userId)
}

// รูปแบบข้อมูลผู้ใช้ที่ปล่อยออกไปให้ฝั่งหน้าจอได้ — ตัด hash ทั้งสองตัวออกเสมอ
export function toPublicUser(row) {
  if (!row) return null
  return {
    userId: row.user_id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    isActive: row.is_active === 1,
    createdAt: row.created_at
  }
}
