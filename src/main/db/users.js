// ตาราง users — SQL ดิบล้วน ไม่มี ORM (ดู .claude/skills/dormy-manager)
//
// ทุกฟังก์ชันรับ `db` เป็นพารามิเตอร์ตัวแรก ไม่ได้ import ตัว singleton มาใช้ตรงๆ
// เพื่อให้ชุดทดสอบชี้ไปที่ฐานข้อมูลชั่วคราวของตัวเองได้ ส่วน handler ในแอปจริงเป็นฝ่าย
// ส่ง getDatabase() เข้ามา — SQL ยังอยู่รวมที่ไฟล์นี้ที่เดียวเหมือนเดิม

// -----------------------------------------------------
// การตรวจข้อมูลก่อนเขียนลงฟิลด์
// -----------------------------------------------------
export const PASSWORD_MIN_LENGTH = 8

// สองบทบาทตายตัว ไม่ใช่เมทริกซ์สิทธิ์ (ดู migration 027)
// ค่าเหล่านี้ต้องตรงกับ constants.js ฝั่งหน้าจอ — main เป็นฝ่ายตรวจเสมอ
export const USER_ROLES = ['owner', 'staff']

export const USER_ROLE_LABELS = {
  owner: 'เจ้าของหอ',
  staff: 'พนักงาน'
}

// สิ่งที่พนักงานทำไม่ได้ — เขียนไว้ที่เดียวเพื่อให้หน้าจออธิบายตรงกับที่ main บังคับจริง
export const OWNER_ONLY_ACTIONS = [
  'ลบใบแจ้งหนี้',
  'ยกเลิกใบเสร็จรับเงิน',
  'ลบหอพัก',
  'กู้คืนและลบไฟล์สำรองข้อมูล',
  'จัดการผู้ใช้งานระบบ'
]

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
//
// requirePassword = false ใช้ตอน "แก้ข้อมูลผู้ใช้" ซึ่งไม่ได้เปลี่ยนรหัสผ่านไปด้วย
// (การเปลี่ยนรหัสผ่านเป็นคนละคำสั่ง เพราะต้องยืนยันตัวตนคนละแบบ)
export function validateUserInput({ fullName, phone, email, password }, { requirePassword = true } = {}) {
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

  if (requirePassword || password !== undefined) {
    if (!password) errors.push('กรุณากรอกรหัสผ่าน')
    else if (String(password).length < PASSWORD_MIN_LENGTH)
      errors.push(`รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`)
  }

  return errors
}

// บทบาทต้องเป็นค่าที่รู้จักเท่านั้น — เก็บเป็น TEXT ใน SQLite จึงไม่มีอะไรกันค่าแปลกๆ
// ให้นอกจากการตรวจตรงนี้ (กติกาเดียวกับ ENUM ทุกตัวในโปรเจกต์)
export function validateRole(role) {
  if (!USER_ROLES.includes(role)) throw new Error(`บทบาทไม่ถูกต้อง: ${role}`)
  return role
}

// เบอร์โทรกับอีเมลใช้เข้าสู่ระบบ จึงต้องไม่ซ้ำกับใคร (unique index มาตั้งแต่ 002)
//
// ตรวจเองก่อนเขียน เพราะข้อความจาก SQLite คือ "UNIQUE constraint failed: users.phone"
// ซึ่งคนกรอกอ่านไม่ออกว่าต้องแก้อะไร · excludeUserId ไว้ให้ตอนแก้ข้อมูลของตัวเอง
export function assertIdentifiersFree(db, { phone, email, excludeUserId = null }) {
  const digits = normalizePhone(phone)
  const mail = normalizeEmail(email)

  const clash = (row) => row && row.user_id !== excludeUserId

  if (digits && clash(db.prepare('SELECT user_id FROM users WHERE phone = ?').get(digits))) {
    throw new Error('เบอร์โทรศัพท์นี้ถูกใช้กับบัญชีอื่นแล้ว')
  }
  if (mail && clash(db.prepare('SELECT user_id FROM users WHERE email = ?').get(mail))) {
    throw new Error('อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว')
  }
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
export function insertUser(db, { fullName, phone, email, passwordHash, recoveryCodeHash, role }) {
  const now = new Date().toISOString()
  const result = db
    .prepare(
      `INSERT INTO users (full_name, phone, password, email, recovery_code_hash, role, is_active, created_at, updated_at)
       VALUES (@fullName, @phone, @passwordHash, @email, @recoveryCodeHash, @role, 1, @now, @now)`
    )
    .run({
      fullName: String(fullName).trim(),
      phone: normalizePhone(phone),
      email: normalizeEmail(email),
      passwordHash,
      recoveryCodeHash: recoveryCodeHash ?? null,
      // ไม่ส่งบทบาทมา = พนักงาน ซึ่งเป็นสิทธิ์ต่ำสุด (กติกาเดียวกับ DEFAULT ของ 027)
      role: validateRole(role ?? 'staff'),
      now
    })
  return getUserById(db, result.lastInsertRowid)
}

// -----------------------------------------------------
// หน้าจัดการผู้ใช้
// -----------------------------------------------------
// เจ้าของขึ้นก่อน แล้วค่อยพนักงาน · ในกลุ่มเดียวกันเรียงตามลำดับที่สร้าง
export function listUsers(db) {
  return db
    .prepare(
      `SELECT * FROM users
        ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, user_id`
    )
    .all()
    .map(toPublicUser)
}

// 🔴 ต้องเหลือเจ้าของที่ยังใช้งานได้อย่างน้อยหนึ่งบัญชีเสมอ
//
// เผลอลดตัวเองเป็นพนักงาน หรือปิดบัญชีเจ้าของคนสุดท้าย = ไม่มีใครในระบบกดจัดการผู้ใช้
// ได้อีกเลย ล็อกตัวเองออกจากสิทธิ์เจ้าของถาวรโดยไม่มีทางแก้จากในแอป
function countActiveOwners(db, { excludeUserId = null } = {}) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM users
        WHERE role = 'owner' AND is_active = 1 AND user_id <> COALESCE(@excludeUserId, -1)`
    )
    .get({ excludeUserId }).n
}

export function assertOwnerRemains(db, userId, { role, isActive } = {}) {
  const target = getUserById(db, userId)
  if (!target) throw new Error('ไม่พบบัญชีผู้ใช้')

  const stillOwner = (role ?? target.role) === 'owner'
  const stillActive = isActive ?? target.is_active === 1
  if (stillOwner && stillActive) return

  if (countActiveOwners(db, { excludeUserId: userId }) === 0) {
    throw new Error(
      'ต้องมีเจ้าของหอที่ใช้งานอยู่อย่างน้อยหนึ่งบัญชี — ' +
        'ถ้าเปลี่ยนบัญชีนี้จะไม่เหลือใครที่จัดการผู้ใช้ได้อีกเลย'
    )
  }
}

export function updateUserProfile(db, userId, { fullName, phone, email, role }) {
  db.prepare(
    `UPDATE users SET full_name = @fullName, phone = @phone, email = @email,
                      role = @role, updated_at = @now
      WHERE user_id = @userId`
  ).run({
    userId,
    fullName: String(fullName).trim(),
    phone: normalizePhone(phone),
    email: normalizeEmail(email),
    role: validateRole(role),
    now: new Date().toISOString()
  })
  return getUserById(db, userId)
}

// ปิดบัญชี ไม่ใช่ลบทิ้ง — ใบเสร็จทุกใบอ้าง created_by ไว้ ถ้าลบแถวผู้ใช้ คอลัมน์
// "ผู้รับเงิน" ของเอกสารเก่าจะกลายเป็นช่องว่างย้อนหลังทั้งระบบ
export function setUserActive(db, userId, isActive) {
  db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE user_id = ?').run(
    isActive ? 1 : 0,
    new Date().toISOString(),
    userId
  )
  return getUserById(db, userId)
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
    role: row.role,
    roleLabel: USER_ROLE_LABELS[row.role] ?? row.role,
    // หน้าจอใช้ธงนี้ซ่อนปุ่มที่พนักงานกดไม่ได้ — **เป็นแค่การจัดหน้าจอ ไม่ใช่การกันสิทธิ์**
    // ตัวกันจริงอยู่ที่ requireOwnerUserId() ฝั่ง main ทุกช่อง (หน้าจอแก้ค่าตัวเองได้จาก DevTools)
    isOwner: row.role === 'owner',
    // บัญชีที่ยังไม่เคยมีรหัสสำรอง = พนักงาน ซึ่งกู้รหัสผ่านเองไม่ได้โดยการออกแบบ
    // ต้องให้เจ้าของรีเซ็ตให้ (ดู .claude/skills/dormy-manager หัวข้อ Password Recovery)
    hasRecoveryCode: Boolean(row.recovery_code_hash),
    isActive: row.is_active === 1,
    createdAt: row.created_at
  }
}
