// ออฟไลน์ล้วน — ลืมรหัสผ่านใช้รหัสสำรองแทน OTP
import crypto from 'crypto' // ตัวสุ่มข้อมูล
import bcrypt from 'bcryptjs' // hash ข้อมูล
import {
  PASSWORD_MIN_LENGTH,
  assertIdentifiersFree,
  assertOwnerRemains,
  countUsers,
  findUserByIdentifier,
  getUserById,
  insertUser,
  replacePasswordAndRecoveryCode,
  setUserActive,
  toPublicUser,
  updatePassword,
  updateRecoveryCodeHash,
  updateUserProfile,
  validateRole,
  validateUserFields
} from './db/users.js'
import { FieldError, throwIfFieldErrors } from './fieldError.js'

const BCRYPT_COST = 10

// ตัด 0 O 1 I L ที่หน้าตาคล้ายกันออก
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 16
const CODE_GROUP = 4

// ตั๋วชั่วคราวอยู่ในหน่วยความจำ main เท่านั้น
const resetTickets = new Map()
const TICKET_TTL_MS = 10 * 60 * 1000 // 10 นาที = 600,000 milisecond

export function generateRecoveryCode() {
  // ต้องใช้ CSPRNG
  let raw = ''
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    raw += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)] // สุ่ม code_alphabet
  }
  return raw.match(new RegExp(`.{1,${CODE_GROUP}}`, 'g')).join('-') // หั่นข้อความทีละ 4 ตัว เชื่อมกับ -
  // .match return เป็น Array ตามเงื่อนไข RegEx
}

export function normalizeRecoveryCode(input) { // จัดรูปแบบ code ให้เป็น มาตรฐาน
  const cleaned = String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  if (cleaned.length === 0) return ''
  return cleaned.match(new RegExp(`.{1,${CODE_GROUP}}`, 'g')).join('-')
}

export function hashSecret(secret) { // hash pasaword
  return bcrypt.hashSync(String(secret), BCRYPT_COST)
}

export function verifySecret(secret, hash) { // เทียบรหัสกรอกกับ hash ว่าตรงไหม
  if (!hash) return false
  return bcrypt.compareSync(String(secret), hash)
}

export function isInitialized(db) { // CHECK ว่า db มี user แล้วยัง
  return countUsers(db) > 0
}

// สร้าง owner คนแรก
export function setupFirstUser(db, { fullName, phone, email, password }) {
  if (isInitialized(db)) {
    throw new Error('ระบบมีบัญชีผู้ใช้อยู่แล้ว ไม่สามารถสร้างบัญชีแรกซ้ำได้')
  }

  throwIfFieldErrors(validateUserFields({ fullName, phone, email, password }))

  const recoveryCode = generateRecoveryCode() // สร้าง recoverycode 16 ตัว
  const user = insertUser(db, { // เก็บข้อมูลลง Database
    fullName,
    phone,
    email,
    passwordHash: hashSecret(password),
    recoveryCodeHash: hashSecret(recoveryCode),
    role: 'owner'
  })

  // รหัสสำรองตัวจริงออกไปครั้งเดียว — ฐานข้อมูลเก็บแค่ hash
  return { user: toPublicUser(user), recoveryCode }
}

// function สร้างพนักงานช่วย
export function createUser(db, { fullName, phone, email, password, role }) {
  throwIfFieldErrors(validateUserFields({ fullName, phone, email, password })) // check ข้อมูล
  validateRole(role) // check role
  assertIdentifiersFree(db, { phone, email }) // check phone mail ว่าซ้ำไหม

  // เจ้าของได้รหัสสำรอง พนักงานไม่ได้ (เจ้าของรีเซ็ตให้)
  const recoveryCode = role === 'owner' ? generateRecoveryCode() : null

  const user = insertUser(db, {
    fullName,
    phone,
    email,
    passwordHash: hashSecret(password),
    recoveryCodeHash: recoveryCode ? hashSecret(recoveryCode) : null,
    role
  })
  return { user: toPublicUser(user), recoveryCode }
}

// update user พนักงาน
export function updateUser(db, userId, { fullName, phone, email, role }) {
  const current = getUserById(db, userId)
  if (!current) throw new Error('ไม่พบบัญชีผู้ใช้')

  throwIfFieldErrors(validateUserFields({ fullName, phone, email }, { requirePassword: false }))
  validateRole(role)
  assertIdentifiersFree(db, { phone, email, excludeUserId: userId })
  assertOwnerRemains(db, userId, { role })

  const updated = updateUserProfile(db, userId, { fullName, phone, email, role })

  // เลื่อนเป็นเจ้าของต้องออกรหัสสำรองให้ด้วย
  let recoveryCode = null
  if (role === 'owner' && !current.recovery_code_hash) {
    recoveryCode = generateRecoveryCode()
    updateRecoveryCodeHash(db, userId, hashSecret(recoveryCode))
  }

  return { user: toPublicUser(getUserById(db, updated.user_id)), recoveryCode }
}

// เปิด / ปิด บัญชี
export function setUserActiveState(db, { userId, isActive }) {
  assertOwnerRemains(db, userId, { isActive })
  return toPublicUser(setUserActive(db, userId, isActive))
}

// ตั้งรหัสผ่านให้บัญชีอื่นเท่านั้น — ตัวเองต้องผ่าน changeOwnPassword (ยืนยันรหัสเดิม)
export function resetUserPassword(db, { userId, newPassword, actorUserId }) {
  const row = getUserById(db, userId)
  if (!row) throw new Error('ไม่พบบัญชีผู้ใช้')
  // บังคับส่ง actorUserId เสมอ
  if (actorUserId == null) throw new Error('ไม่ทราบว่าใครเป็นผู้ตั้งรหัสผ่านใหม่')
  if (Number(actorUserId) === Number(userId)) {
    throw new Error(
      'เปลี่ยนรหัสผ่านของตัวเองทางนี้ไม่ได้ — ไปที่ ตั้งค่า › บัญชีผู้ใช้และความปลอดภัย ' +
        '(ถ้าจำรหัสเดิมไม่ได้ ให้ออกจากระบบแล้วใช้รหัสสำรองกู้คืน)'
    )
  }
  if (!newPassword || String(newPassword).length < PASSWORD_MIN_LENGTH) {
    throw new FieldError({ newPassword: `รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร` })
  }

  updatePassword(db, userId, hashSecret(newPassword))
  return toPublicUser(getUserById(db, userId))
}

// user เปลี่ยน password ตัวเอง
export function changeOwnPassword(db, { userId, currentPassword, newPassword }) {
  const row = getUserById(db, userId)
  if (!row) throw new Error('ไม่พบบัญชีผู้ใช้')
  if (!verifySecret(currentPassword, row.password)) {
    throw new FieldError({ currentPassword: 'รหัสผ่านเดิมไม่ถูกต้อง' })
  }
  if (!newPassword || String(newPassword).length < PASSWORD_MIN_LENGTH) {
    throw new FieldError({ newPassword: `รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร` })
  }

  updatePassword(db, userId, hashSecret(newPassword))
  return toPublicUser(getUserById(db, userId))
}

export function login(db, { identifier, password }) {
  const row = findUserByIdentifier(db, identifier)

  // ข้อความเดียวทุกกรณี — ไม่บอกว่ามีบัญชีหรือไม่
  const failed = new Error('อีเมล/เบอร์โทรศัพท์ หรือรหัสผ่านไม่ถูกต้อง')

  if (!row) throw failed
  if (!verifySecret(password, row.password)) throw failed
  if (row.is_active !== 1) throw new Error('บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ')

  return toPublicUser(row)
}

export function verifyRecoveryCode(db, { identifier, recoveryCode }) {
  const row = findUserByIdentifier(db, identifier)
  const failed = new Error('อีเมล/เบอร์โทรศัพท์ หรือรหัสสำรองไม่ถูกต้อง')

  if (!row) throw failed
  if (!verifySecret(normalizeRecoveryCode(recoveryCode), row.recovery_code_hash)) throw failed

  const ticket = crypto.randomBytes(32).toString('hex')
  resetTickets.set(ticket, { userId: row.user_id, expiresAt: Date.now() + TICKET_TTL_MS })
  return { ticket, user: toPublicUser(row) }
}

export function resetPasswordWithTicket(db, { ticket, newPassword }) {
  const entry = resetTickets.get(ticket)
  if (!entry || entry.expiresAt < Date.now()) {
    resetTickets.delete(ticket)
    throw new Error('หมดเวลาตั้งรหัสผ่านใหม่ กรุณากรอกรหัสสำรองอีกครั้ง')
  }
  if (!newPassword || String(newPassword).length < PASSWORD_MIN_LENGTH) {
    throw new FieldError({ newPassword: `รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร` })
  }

  // รหัสสำรองใบเก่าใช้ไม่ได้ทันที
  const nextCode = generateRecoveryCode()
  const user = replacePasswordAndRecoveryCode(
    db,
    entry.userId,
    hashSecret(newPassword),
    hashSecret(nextCode)
  )
  // ใช้เสร็จลบ ticket ทิ้ง
  resetTickets.delete(ticket)

  return { user: toPublicUser(user), recoveryCode: nextCode }
}

// ต้องยืนยันรหัสผ่านก่อนออกรหัสสำรองใหม่ ----- User ยังจำ Password ได้ แต่ต้องการออก Recovery Code ใหม่
export function regenerateRecoveryCode(db, { userId, password }) {
  const row = getUserById(db, userId)
  if (!row) throw new Error('ไม่พบบัญชีผู้ใช้')
  if (!verifySecret(password, row.password)) throw new Error('รหัสผ่านไม่ถูกต้อง')

  const nextCode = generateRecoveryCode()
  updateRecoveryCodeHash(db, userId, hashSecret(nextCode))
  return { recoveryCode: nextCode }
}
