// สคริปต์ทดสอบระบบเข้าสู่ระบบแบบ end-to-end บนฐานข้อมูลชั่วคราว
// รันด้วย: npm run test:auth
//
// ทำไมต้องรันผ่าน electron แทน node เปล่าๆ: better-sqlite3 ในโปรเจกต์นี้เป็นไฟล์ prebuilt
// ที่คอมไพล์มาสำหรับ ABI ของ Electron (ดู .npmrc) node ปกติจึงโหลด .node ไฟล์นี้ไม่ได้
// สคริปต์เลยตรวจตัวเองแล้วเรียก electron ในโหมด ELECTRON_RUN_AS_NODE ให้อัตโนมัติ
//
// ทดสอบเฉพาะชั้น auth.js / db/users.js / migrate.js ซึ่งไม่ import electron
// จึงไม่ต้องเปิดหน้าต่างหรือรอ app.whenReady()
import { spawnSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(here, '..')

if (!process.versions.electron) {
  const electronBin = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
  const target = fs.existsSync(electronBin) ? electronBin : 'electron'
  const child = spawnSync(target, [fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  process.exit(child.status ?? 1)
}

const { default: Database } = await import('better-sqlite3')
const { runMigrations } = await import('../src/main/db/migrate.js')
const users = await import('../src/main/db/users.js')
const auth = await import('../src/main/auth.js')

// -----------------------------------------------------
// ตัวช่วยเล็กๆ แทนการลง test framework (นโยบาย dependency: เพิ่มให้น้อยที่สุด)
// -----------------------------------------------------
let passed = 0
const failures = []

function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (err) {
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}\n         ${err.message}`)
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

function throws(fn, expectedPart, message) {
  try {
    fn()
  } catch (err) {
    assert(
      err.message.includes(expectedPart),
      `${message} — ได้ error คนละอันกับที่คาด: ${err.message}`
    )
    return
  }
  throw new Error(`${message} — ไม่ throw เลยทั้งที่ควร throw`)
}

// -----------------------------------------------------
// เปิดฐานข้อมูลชั่วคราว แล้วรัน migration ชุดเดียวกับแอปจริง
// -----------------------------------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dormy-auth-'))
const dbPath = path.join(tmpDir, 'test.sqlite')
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
runMigrations(db, path.join(projectRoot, 'src/main/migrations'))

console.log(`\nฐานข้อมูลทดสอบ: ${dbPath}\n`)

console.log('migrations')
check('รัน migration ครบทุกไฟล์', () => {
  const applied = db
    .prepare('SELECT name FROM _migrations ORDER BY name')
    .all()
    .map((r) => r.name)
  assert(applied.includes('001_init.sql'), '001_init.sql ไม่ถูก apply')
  assert(applied.includes('002_users_unique_identifier.sql'), '002 ไม่ถูก apply')
})

check('รันซ้ำแล้วไม่ apply ทับ (idempotent)', () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM _migrations').get().n
  runMigrations(db, path.join(projectRoot, 'src/main/migrations'))
  const after = db.prepare('SELECT COUNT(*) AS n FROM _migrations').get().n
  assert(before === after, `จำนวน migration เปลี่ยนจาก ${before} เป็น ${after}`)
})

console.log('\nสร้างบัญชีแรก')
assert(auth.isInitialized(db) === false, 'ฐานข้อมูลใหม่ต้องยังไม่มีผู้ใช้')

const FIRST = {
  fullName: 'สมชาย เจ้าของหอ',
  phone: '081-234-5678',
  email: 'Owner@Example.com',
  password: 'dormy-secret-1'
}
const { user: owner, recoveryCode } = auth.setupFirstUser(db, FIRST)

check('คืนรหัสสำรองรูปแบบ XXXX-XXXX-XXXX-XXXX', () => {
  assert(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(recoveryCode), `รูปแบบผิด: ${recoveryCode}`)
  assert(!/[01OIL]/.test(recoveryCode), `มีตัวอักษรที่สับสนง่าย: ${recoveryCode}`)
})

check('เก็บเบอร์โทรเป็นตัวเลขล้วน และอีเมลเป็นตัวพิมพ์เล็ก', () => {
  const row = users.getUserById(db, owner.userId)
  assert(row.phone === '0812345678', `เบอร์ที่เก็บคือ ${row.phone}`)
  assert(row.email === 'owner@example.com', `อีเมลที่เก็บคือ ${row.email}`)
})

check('ไม่เก็บรหัสผ่าน/รหัสสำรองเป็น plaintext', () => {
  const row = users.getUserById(db, owner.userId)
  assert(row.password !== FIRST.password, 'รหัสผ่านถูกเก็บเป็น plaintext!')
  assert(row.password.startsWith('$2'), 'รหัสผ่านไม่ใช่ bcrypt hash')
  assert(row.recovery_code_hash !== recoveryCode, 'รหัสสำรองถูกเก็บเป็น plaintext!')
  assert(row.recovery_code_hash.startsWith('$2'), 'รหัสสำรองไม่ใช่ bcrypt hash')
})

check('ข้อมูลที่ส่งออกไปหน้าจอไม่มี hash ติดไปด้วย', () => {
  assert(!('password' in owner), 'toPublicUser ปล่อย password ออกไป')
  assert(!('recovery_code_hash' in owner), 'toPublicUser ปล่อย recovery_code_hash ออกไป')
})

check('สร้างบัญชีแรกซ้ำไม่ได้', () => {
  throws(
    () => auth.setupFirstUser(db, { ...FIRST, phone: '0899999999', email: 'x@y.com' }),
    'มีบัญชีผู้ใช้อยู่แล้ว',
    'ควรปฏิเสธการสร้างบัญชีแรกซ้ำ'
  )
})

check('ตรวจข้อมูลไม่ผ่านต้องรายงานครบทุกข้อในครั้งเดียว', () => {
  const errors = users.validateUserInput({ fullName: '', phone: '', email: 'ไม่ใช่อีเมล', password: '123' })
  assert(errors.length === 4, `คาด 4 ข้อ ได้ ${errors.length} ข้อ: ${errors.join(' | ')}`)
})

check('เบอร์โทรซ้ำถูกกันด้วย unique index (002)', () => {
  throws(
    () =>
      users.insertUser(db, {
        fullName: 'คนที่สอง',
        phone: '0812345678',
        email: null,
        passwordHash: auth.hashSecret('whatever-123'),
        recoveryCodeHash: null
      }),
    'UNIQUE',
    'ควรกันเบอร์โทรซ้ำ'
  )
})

check('อีเมลว่าง (NULL) ซ้ำกันได้หลายคน', () => {
  const a = users.insertUser(db, {
    fullName: 'พนักงาน ก',
    phone: '0810000001',
    email: '',
    passwordHash: auth.hashSecret('staff-pass-1'),
    recoveryCodeHash: null
  })
  const b = users.insertUser(db, {
    fullName: 'พนักงาน ข',
    phone: '0810000002',
    email: '',
    passwordHash: auth.hashSecret('staff-pass-2'),
    recoveryCodeHash: null
  })
  assert(a.email === null && b.email === null, 'อีเมลว่างต้องถูกเก็บเป็น NULL ไม่ใช่สตริงว่าง')
})

console.log('\nเข้าสู่ระบบ')
check('เข้าด้วยเบอร์โทรแบบมีขีดได้', () => {
  const u = auth.login(db, { identifier: '081-234-5678', password: FIRST.password })
  assert(u.userId === owner.userId, 'ได้ผู้ใช้คนละคน')
})

check('เข้าด้วยเบอร์โทรแบบไม่มีขีดได้', () => {
  auth.login(db, { identifier: '0812345678', password: FIRST.password })
})

check('เข้าด้วยอีเมลพิมพ์ใหญ่/มีช่องว่างได้', () => {
  auth.login(db, { identifier: '  OWNER@example.com ', password: FIRST.password })
})

check('รหัสผ่านผิดเข้าไม่ได้', () => {
  throws(
    () => auth.login(db, { identifier: '0812345678', password: 'wrong-password' }),
    'ไม่ถูกต้อง',
    'ควรปฏิเสธรหัสผ่านผิด'
  )
})

check('ไม่บอกต่างกันระหว่าง "ไม่มีบัญชีนี้" กับ "รหัสผ่านผิด"', () => {
  let noUser = ''
  let badPass = ''
  try {
    auth.login(db, { identifier: '0899999999', password: 'x' })
  } catch (err) {
    noUser = err.message
  }
  try {
    auth.login(db, { identifier: '0812345678', password: 'x' })
  } catch (err) {
    badPass = err.message
  }
  assert(noUser === badPass, `ข้อความต่างกัน: "${noUser}" vs "${badPass}"`)
})

check('บัญชีที่ถูกปิดใช้งานเข้าไม่ได้', () => {
  db.prepare('UPDATE users SET is_active = 0 WHERE phone = ?').run('0810000001')
  throws(
    () => auth.login(db, { identifier: '0810000001', password: 'staff-pass-1' }),
    'ถูกปิดการใช้งาน',
    'ควรปฏิเสธบัญชีที่ปิดใช้งาน'
  )
})

console.log('\nลืมรหัสผ่าน / รหัสสำรอง')
check('รหัสสำรองผิดใช้ไม่ได้', () => {
  throws(
    () => auth.verifyRecoveryCode(db, { identifier: '0812345678', recoveryCode: 'AAAA-BBBB-CCCC-DDDD' }),
    'ไม่ถูกต้อง',
    'ควรปฏิเสธรหัสสำรองผิด'
  )
})

// รหัสสำรอง "ใบที่ใช้ได้อยู่ตอนนี้" — ทุกครั้งที่ตั้งรหัสผ่านใหม่สำเร็จ ใบนี้จะถูกแทนที่
// ตัวแปรนี้จึงต้องอัปเดตทุกรอบ เหมือนที่ผู้ใช้จริงต้องฉีกกระดาษใบเก่าทิ้งแล้วจดใบใหม่
let currentCode = recoveryCode

check('รหัสสำรองพิมพ์เล็ก/ไม่มีขีดก็ใช้ได้ แล้วตั้งรหัสผ่านใหม่ได้', () => {
  const messy = currentCode.replace(/-/g, '').toLowerCase()
  const { ticket } = auth.verifyRecoveryCode(db, { identifier: '0812345678', recoveryCode: messy })
  assert(Boolean(ticket), 'ไม่ได้ ticket กลับมา')

  const result = auth.resetPasswordWithTicket(db, { ticket, newPassword: 'brand-new-pass-2' })
  assert(result.recoveryCode !== currentCode, 'รหัสสำรองใบใหม่ซ้ำกับใบเก่า')
  currentCode = result.recoveryCode
  auth.login(db, { identifier: '0812345678', password: 'brand-new-pass-2' })
})

check('รหัสผ่านเก่าใช้ไม่ได้แล้ว', () => {
  throws(
    () => auth.login(db, { identifier: '0812345678', password: FIRST.password }),
    'ไม่ถูกต้อง',
    'รหัสผ่านเก่ายังใช้ได้อยู่'
  )
})

check('รหัสสำรองใบเก่าใช้ไม่ได้แล้ว (rotate-on-use)', () => {
  throws(
    () => auth.verifyRecoveryCode(db, { identifier: '0812345678', recoveryCode }),
    'ไม่ถูกต้อง',
    'รหัสสำรองใบเก่ายังใช้ได้อยู่ — rotate-on-use พัง'
  )
})

check('ticket ใช้ซ้ำไม่ได้', () => {
  const { ticket } = auth.verifyRecoveryCode(db, {
    identifier: '0812345678',
    recoveryCode: currentCode
  })
  const result = auth.resetPasswordWithTicket(db, { ticket, newPassword: 'third-password-3' })
  currentCode = result.recoveryCode
  throws(
    () => auth.resetPasswordWithTicket(db, { ticket, newPassword: 'fourth-password-4' }),
    'หมดเวลา',
    'ticket ถูกใช้ซ้ำได้'
  )
})

check('ticket ปลอมใช้ไม่ได้', () => {
  throws(
    () => auth.resetPasswordWithTicket(db, { ticket: 'ticket-มั่วๆ', newPassword: 'xxxxxxxx' }),
    'หมดเวลา',
    'ticket ปลอมผ่านได้'
  )
})

check('รหัสผ่านใหม่สั้นเกินไปถูกปฏิเสธ (และรหัสสำรองต้องยังไม่ถูกหมุนทิ้ง)', () => {
  const codeBefore = users.getUserById(db, owner.userId).recovery_code_hash
  const { ticket } = auth.verifyRecoveryCode(db, {
    identifier: '0812345678',
    recoveryCode: currentCode
  })
  throws(
    () => auth.resetPasswordWithTicket(db, { ticket, newPassword: 'sh0rt' }),
    'อย่างน้อย',
    'ควรปฏิเสธรหัสผ่านสั้นเกินไป'
  )
  const codeAfter = users.getUserById(db, owner.userId).recovery_code_hash
  assert(codeBefore === codeAfter, 'รหัสสำรองถูกเปลี่ยนทั้งที่ตั้งรหัสผ่านใหม่ไม่สำเร็จ')
})

console.log('\nออกรหัสสำรองใบใหม่จากหน้าตั้งค่า')
check('รหัสผ่านผิดออกใบใหม่ไม่ได้', () => {
  throws(
    () => auth.regenerateRecoveryCode(db, { userId: owner.userId, password: 'not-my-password' }),
    'รหัสผ่านไม่ถูกต้อง',
    'ควรบังคับยืนยันรหัสผ่านก่อน'
  )
})

check('รหัสผ่านถูกต้องได้ใบใหม่ และใบใหม่ใช้กู้คืนได้จริง', () => {
  const { recoveryCode: fresh } = auth.regenerateRecoveryCode(db, {
    userId: owner.userId,
    password: 'third-password-3'
  })
  const { ticket } = auth.verifyRecoveryCode(db, {
    identifier: '0812345678',
    recoveryCode: fresh
  })
  assert(Boolean(ticket), 'ใบใหม่ใช้กู้คืนไม่ได้')
})

// -----------------------------------------------------
db.close()
fs.rmSync(tmpDir, { recursive: true, force: true })

console.log(`\n${passed} ผ่าน / ${failures.length} ไม่ผ่าน`)
if (failures.length > 0) {
  console.log('\nรายการที่ไม่ผ่าน:')
  for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
  process.exit(1)
}
console.log('ระบบเข้าสู่ระบบทำงานครบทุกเส้นทาง\n')
