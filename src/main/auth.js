// ระบบเข้าสู่ระบบ + รหัสสำรอง (backup password) สำหรับกู้คืนรหัสผ่าน
//
// ทั้งหมดทำงานแบบออฟไลน์ 100% ไม่มี OTP ไม่มี SMS ไม่มีอีเมล — เครื่องนี้อาจไม่มี
// อินเทอร์เน็ตเลยตลอดอายุการใช้งาน ต้นแบบ (app.yeeraf.com) ใช้ OTP หลังกรอกรหัสผ่าน
// ตรงนั้นเราแทนด้วย "รหัสสำรอง" ที่ออกให้ครั้งเดียวตอนสร้างบัญชี และใช้เฉพาะเวลาลืมรหัสผ่าน
//
// ข้อแลกเปลี่ยนที่ยอมรับแล้ว: ถ้าลืมรหัสผ่าน "และ" รหัสสำรองหายพร้อมกัน บัญชีนั้นกู้ไม่ได้
// เลยโดยการออกแบบ (ไม่มีเซิร์ฟเวอร์กลางให้ร้องขอ) — หน้าจอต้องเตือนเรื่องนี้ตอนแสดงรหัสครั้งแรก
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import {
  PASSWORD_MIN_LENGTH,
  countUsers,
  findUserByIdentifier,
  getUserById,
  insertUser,
  replacePasswordAndRecoveryCode,
  toPublicUser,
  updateRecoveryCodeHash,
  validateUserInput
} from './db/users.js'

const BCRYPT_COST = 10

// ตัวอักษรที่ใช้สร้างรหัสสำรอง — ตัด 0 O 1 I L ออกทั้งหมด เพราะรหัสนี้ผู้ใช้ต้อง
// "จดลงกระดาษแล้วพิมพ์กลับเข้ามาอีกทีในวันที่ลืมรหัสผ่าน" ตัวอักษรที่หน้าตาเหมือนกัน
// คือสาเหตุอันดับหนึ่งที่จะกรอกไม่ผ่านทั้งที่จดไว้ถูก
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 16 // 16 ตัวจาก 31 ตัวเลือก ≈ 79 บิต เดาสุ่มไม่ได้ในทางปฏิบัติ
const CODE_GROUP = 4 // แสดงเป็น XXXX-XXXX-XXXX-XXXX

// ตั๋วชั่วคราวที่ออกให้หลังตรวจรหัสสำรองผ่าน เก็บในหน่วยความจำของ main process เท่านั้น
// (ไม่เขียนลงฐานข้อมูล ไม่ส่งรหัสสำรองตัวจริงไปกลับให้หน้าจอถือไว้)
// ปิดแอป = ตั๋วหายทั้งหมด ซึ่งเป็นพฤติกรรมที่ต้องการ
const resetTickets = new Map()
const TICKET_TTL_MS = 10 * 60 * 1000

// -----------------------------------------------------
// รหัสสำรอง: สร้าง / จัดรูป / เทียบ
// -----------------------------------------------------
export function generateRecoveryCode() {
  // ใช้ crypto.randomInt (CSPRNG) ไม่ใช่ Math.random ซึ่งเดาลำดับต่อไปได้
  let raw = ''
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    raw += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
  }
  return raw.match(new RegExp(`.{1,${CODE_GROUP}}`, 'g')).join('-')
}

// ผู้ใช้จะพิมพ์มาแบบมีขีด ไม่มีขีด เว้นวรรค หรือพิมพ์เล็กก็ได้ — ปรับให้เป็นรูปเดียวก่อนเทียบ
// จงใจไม่ "เดาแทน" ตัวอักษรที่คล้ายกัน (O→0, I→1) เพราะตัวเหล่านั้นไม่มีในรหัสอยู่แล้ว
// การเดาแทนจะกลายเป็นการยอมรับรหัสผิดเงียบๆ
export function normalizeRecoveryCode(input) {
  const cleaned = String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  if (cleaned.length === 0) return ''
  return cleaned.match(new RegExp(`.{1,${CODE_GROUP}}`, 'g')).join('-')
}

export function hashSecret(secret) {
  return bcrypt.hashSync(String(secret), BCRYPT_COST)
}

export function verifySecret(secret, hash) {
  if (!hash) return false
  return bcrypt.compareSync(String(secret), hash)
}

// -----------------------------------------------------
// สถานะระบบ + สร้างบัญชีแรก
// -----------------------------------------------------
export function isInitialized(db) {
  return countUsers(db) > 0
}

// สร้างผู้ดูแลคนแรกของเครื่องนี้ (หน้า "ลงทะเบียน" ของต้นแบบ = first-run setup ของเรา)
// ระบบมาถึงมือผู้ใช้แบบไม่มีบัญชีใดๆ อยู่เลย บัญชีแรกจึงเกิดที่นี่ที่เดียว
export function setupFirstUser(db, { fullName, phone, email, password }) {
  if (isInitialized(db)) {
    throw new Error('ระบบมีบัญชีผู้ใช้อยู่แล้ว ไม่สามารถสร้างบัญชีแรกซ้ำได้')
  }

  const errors = validateUserInput({ fullName, phone, email, password })
  if (errors.length > 0) throw new Error(errors.join('\n'))

  const recoveryCode = generateRecoveryCode()
  const user = insertUser(db, {
    fullName,
    phone,
    email,
    passwordHash: hashSecret(password),
    recoveryCodeHash: hashSecret(recoveryCode)
  })

  // คืนรหัสสำรองตัวจริงออกไปครั้งนี้ครั้งเดียวเท่านั้น หลังจากนี้ในฐานข้อมูลมีแต่ hash
  return { user: toPublicUser(user), recoveryCode }
}

// -----------------------------------------------------
// เข้าสู่ระบบ
// -----------------------------------------------------
export function login(db, { identifier, password }) {
  const row = findUserByIdentifier(db, identifier)

  // ข้อความเดียวกันทุกกรณี ไม่บอกว่า "ไม่มีบัญชีนี้" หรือ "รหัสผ่านผิด" แยกกัน
  // ไม่งั้นหน้า login จะกลายเป็นเครื่องมือไล่เช็คว่าเบอร์ไหนมีบัญชีอยู่ในระบบ
  const failed = new Error('อีเมล/เบอร์โทรศัพท์ หรือรหัสผ่านไม่ถูกต้อง')

  if (!row) throw failed
  if (!verifySecret(password, row.password)) throw failed
  if (row.is_active !== 1) throw new Error('บัญชีนี้ถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ')

  return toPublicUser(row)
}

// -----------------------------------------------------
// ลืมรหัสผ่าน: ตรวจรหัสสำรอง → ตั้งรหัสใหม่ → ออกรหัสสำรองใบใหม่ทันที
// -----------------------------------------------------
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
    throw new Error(`รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`)
  }

  // rotate-on-use: รหัสสำรองใบเก่าต้องใช้ไม่ได้ทันทีที่รหัสใหม่ถูกเขียนลงไป
  // ทุกบัญชีจึงมีรหัสสำรองที่ใช้ได้อยู่ "หนึ่งใบเสมอ" ไม่มีใบเก่าค้างอยู่ในระบบ
  const nextCode = generateRecoveryCode()
  const user = replacePasswordAndRecoveryCode(
    db,
    entry.userId,
    hashSecret(newPassword),
    hashSecret(nextCode)
  )
  resetTickets.delete(ticket)

  return { user: toPublicUser(user), recoveryCode: nextCode }
}

// ออกรหัสสำรองใบใหม่ตอนที่ยัง login อยู่ (เผื่อผู้ใช้คิดว่ากระดาษที่จดไว้หลุดไปถึงคนอื่น)
// ต้องยืนยันรหัสผ่านก่อน ไม่งั้นใครเดินมาที่เครื่องที่เปิดค้างไว้ก็กดออกรหัสใหม่ได้เลย
export function regenerateRecoveryCode(db, { userId, password }) {
  const row = getUserById(db, userId)
  if (!row) throw new Error('ไม่พบบัญชีผู้ใช้')
  if (!verifySecret(password, row.password)) throw new Error('รหัสผ่านไม่ถูกต้อง')

  const nextCode = generateRecoveryCode()
  updateRecoveryCodeHash(db, userId, hashSecret(nextCode))
  return { recoveryCode: nextCode }
}

// เผื่อชุดทดสอบ/การปิดแอป: ล้างตั๋วที่ค้างอยู่ทั้งหมด
export function clearResetTickets() {
  resetTickets.clear()
}
