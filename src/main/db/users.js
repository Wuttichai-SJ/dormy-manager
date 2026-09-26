import { FieldError } from '../fieldError.js'

export const PASSWORD_MIN_LENGTH = 8

// ต้องตรงกับ constants.js ฝั่งหน้าจอ
export const USER_ROLES = ['owner', 'staff']

export const USER_ROLE_LABELS = {
  owner: 'เจ้าของหอ',
  staff: 'พนักงาน'
}

export const OWNER_ONLY_ACTIONS = [
  'แก้ไขบัญชีธนาคารและข้อความแจ้งชำระเงิน',
  'เปลี่ยน QR Code รับเงิน',
  'ลบใบแจ้งหนี้',
  'ยกเลิกใบเสร็จรับเงิน',
  'ลบหอพัก',
  'กู้คืนและลบไฟล์สำรองข้อมูล',
  'จัดการผู้ใช้งานระบบ'
]

// เบอร์โทรเก็บเป็นตัวเลขล้วน
export function normalizePhone(phone) {
  return String(phone ?? '').replace(/[^\d]/g, '')
}

// อีเมลว่าง = NULL (unique index ยอมให้ NULL ซ้ำ)
export function normalizeEmail(email) {
  const trimmed = String(email ?? '').trim().toLowerCase()
  return trimmed === '' ? null : trimmed
}

export function validateUserFields({ fullName, phone, email, password }, { requirePassword = true } = {}) {
  const errors = {}

  if (!String(fullName ?? '').trim()) errors.fullName = 'กรุณากรอกชื่อ-นามสกุล'
  else if (String(fullName).trim().length > 255) errors.fullName = 'ชื่อ-นามสกุลยาวเกิน 255 ตัวอักษร'

  const digits = normalizePhone(phone)
  if (!digits) errors.phone = 'กรุณากรอกเบอร์โทรศัพท์'
  else if (digits.length < 9 || digits.length > 15) errors.phone = 'เบอร์โทรศัพท์ต้องมี 9-15 หลัก'

  const mail = normalizeEmail(email)
  if (mail !== null && !/^[^@\s]+@[^@\s]+$/.test(mail)) errors.email = 'รูปแบบอีเมลไม่ถูกต้อง'

  if (requirePassword || password !== undefined) {
    if (!password) errors.password = 'กรุณากรอกรหัสผ่าน'
    else if (String(password).length < PASSWORD_MIN_LENGTH)
      errors.password = `รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`
  }

  return errors
}

export function validateUserInput(input, options) {
  return Object.values(validateUserFields(input, options))
}

export function validateRole(role) {
  if (!USER_ROLES.includes(role)) throw new Error(`บทบาทไม่ถูกต้อง: ${role}`)
  return role
}

export function assertIdentifiersFree(db, { phone, email, excludeUserId = null }) {
  const digits = normalizePhone(phone)
  const mail = normalizeEmail(email)

  const clash = (row) => row && row.user_id !== excludeUserId

  if (digits && clash(db.prepare('SELECT user_id FROM users WHERE phone = ?').get(digits))) {
    throw new FieldError({ phone: 'เบอร์โทรศัพท์นี้ถูกใช้กับบัญชีอื่นแล้ว' })
  }
  if (mail && clash(db.prepare('SELECT user_id FROM users WHERE email = ?').get(mail))) {
    throw new FieldError({ email: 'อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว' })
  }
}

export function countUsers(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n
}

export function getUserById(db, userId) {
  return db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId)
}

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

// รับเฉพาะ hash — ไม่รับรหัสผ่านตัวจริง
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
      role: validateRole(role ?? 'staff'),
      now
    })
  return getUserById(db, result.lastInsertRowid)
}

export function listUsers(db) {
  return db
    .prepare(
      `SELECT * FROM users
        ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, user_id`
    )
    .all()
    .map(toPublicUser)
}

// ต้องเหลือเจ้าของที่ใช้งานได้อย่างน้อยหนึ่งบัญชีเสมอ
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
    throw new FieldError({
      role:
        'ต้องมีเจ้าของหอที่ใช้งานอยู่อย่างน้อยหนึ่งบัญชี — ' +
        'ถ้าเปลี่ยนบัญชีนี้จะไม่เหลือใครที่จัดการผู้ใช้ได้อีกเลย'
    })
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

// ปิดบัญชี ไม่ลบ — เอกสารเก่าอ้าง created_by
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

// เปลี่ยนรหัสผ่านกับรหัสสำรองต้องสำเร็จพร้อมกัน
export function replacePasswordAndRecoveryCode(db, userId, passwordHash, recoveryCodeHash) {
  const run = db.transaction(() => {
    updatePassword(db, userId, passwordHash)
    updateRecoveryCodeHash(db, userId, recoveryCodeHash)
  })
  run()
  return getUserById(db, userId)
}

export function toPublicUser(row) {
  if (!row) return null
  return {
    userId: row.user_id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    roleLabel: USER_ROLE_LABELS[row.role] ?? row.role,
    // ใช้ซ่อนปุ่มเท่านั้น — สิทธิ์จริงตรวจที่ main
    isOwner: row.role === 'owner',
    hasRecoveryCode: Boolean(row.recovery_code_hash),
    isActive: row.is_active === 1,
    createdAt: row.created_at
  }
}
