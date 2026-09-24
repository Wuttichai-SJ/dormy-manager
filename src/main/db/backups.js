// สำรองและกู้คืนฐานข้อมูล
//
// ทั้งระบบอยู่ในไฟล์ SQLite ไฟล์เดียว ถ้าไฟล์นั้นเสียหรือหาย = ข้อมูลหอพักหายทั้งหมด
// ไม่มีเซิร์ฟเวอร์ ไม่มีคลาวด์ให้ดึงกลับ (ตามข้อกำหนด offline-first) การสำรองจึงเป็น
// ตาข่ายนิรภัยชั้นเดียวที่มี — ต้องมีก่อนเริ่มกรอกข้อมูลหอจริง ไม่ใช่ทำท้ายโปรเจกต์
//
// *** ห้ามคัดลอกไฟล์ .sqlite ด้วย fs.copyFile ตรงๆ ***
// ฐานข้อมูลเปิดอยู่ในโหมด WAL — ข้อมูลที่เพิ่งเขียนอาจยังอยู่ในไฟล์ -wal ไม่ใช่ในไฟล์หลัก
// สำเนาที่ได้จะขาดข้อมูลล่าสุดไปเงียบๆ และรู้ตัวตอนกู้คืนแล้วเท่านั้น
// ต้องใช้ db.backup() ซึ่งเรียก online backup API ของ SQLite ที่จัดการ WAL ให้ถูกต้อง
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

// เก็บสำเนาไว้ข้างไฟล์ฐานข้อมูลจริง (userData) — ผู้ใช้คัดลอกทั้งโฟลเดอร์ไปไว้ไดรฟ์อื่น
// หรือ USB ได้ในทีเดียว ซึ่งคือสิ่งที่ควรทำจริงๆ เพราะสำเนาที่อยู่ดิสก์เดียวกับต้นฉบับ
// ไม่รอดถ้าดิสก์พัง
//
// 🔴 **ตอนพัฒนาใช้คนละโฟลเดอร์กับตัวจริง** ด้วยเหตุผลเดียวกับที่ resolveDbPath() ใน
// database.js แยก dormy-dev.sqlite ออกจาก dormy.sqlite — เครื่องนี้เป็นทั้งเครื่องพัฒนา
// และเครื่องที่รันแอปจริง ถ้าใช้โฟลเดอร์เดียวกัน สำเนาของข้อมูลทดสอบจะไปนั่งปนอยู่ใน
// รายการเดียวกับสำเนาของข้อมูลหอจริง หน้าตาเหมือนกันทุกประการ (ชื่อไฟล์เป็นวันเวลาล้วน
// ไม่มีอะไรบอกที่มา) แล้ววันหนึ่งจะมีคนกดกู้คืนผิดใบ ทับข้อมูลหอจริงด้วยข้อมูลทดสอบ
//
// ตัวเลือกนี้เป็น argument ไม่ใช่การอ่าน app.isPackaged เอง เพราะโมดูลใน db/ ห้ามรู้จัก
// electron (ชุดทดสอบรันใต้ ELECTRON_RUN_AS_NODE) — ผู้เรียกฝั่ง handlers เป็นคนตัดสิน
export function resolveBackupDir(userDataPath, { isDev = false } = {}) {
  return path.join(userDataPath, isDev ? 'backups-dev' : 'backups')
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ชื่อไฟล์เรียงตามเวลาได้เองเมื่อเรียงตามตัวอักษร (YYYY-MM-DD_HHmmss)
// อ่านออกด้วยตาโดยไม่ต้องเปิดโปรแกรมอะไร
// ใบที่สองขึ้นไปในวินาทีเดียวกันได้เลขต่อท้าย (-2, -3) — ดู reserveBackupFile()
function buildFileName(now = new Date(), sequence = 1) {
  const pad = (n) => String(n).padStart(2, '0')
  return [
    'dormy-',
    now.getFullYear(),
    '-',
    pad(now.getMonth() + 1),
    '-',
    pad(now.getDate()),
    '_',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
    sequence > 1 ? `-${sequence}` : '',
    '.sqlite'
  ].join('')
}

// 🔴 จองชื่อไฟล์ด้วยการสร้างไฟล์เปล่าแบบ exclusive ('wx') ไม่ใช่เช็ก existsSync ก่อน
// ชื่อไฟล์ละเอียดแค่ระดับวินาที เดิมสำรองสองใบในวินาทีเดียวกันแล้ว db.backup() เขียนทับ
// ใบแรกเงียบๆ — เกิดได้จริงตอนกู้คืน ที่ระบบสร้าง "สำรองอัตโนมัติก่อนกู้คืน" ตามหลังใบที่
// ผู้ใช้เพิ่งกดสร้าง และการเช็ก existsSync ไม่พอ เพราะ db.backup() เป็น async ถ้ากดสร้าง
// รัวๆ ทุกคำขอจะเห็นว่าชื่อยังว่างแล้วเลือกชื่อเดียวกันหมด ส่วน 'wx' ให้ระบบปฏิบัติการ
// ตัดสินว่าใครได้ชื่อไป ชนเมื่อไหร่ได้ EEXIST แล้วขยับไปเลขถัดไป
// (db.backup() เขียนลงไฟล์เปล่าที่จองไว้ได้ปกติ — ไฟล์ขนาด 0 ไบต์คือฐานข้อมูลว่าง)
function reserveBackupFile(dir, now) {
  for (let sequence = 1; ; sequence++) {
    const fileName = buildFileName(now, sequence)
    try {
      fs.closeSync(fs.openSync(path.join(dir, fileName), 'wx'))
      return fileName
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }
  }
}

// ------------------------------------------------------------------
// สร้างสำเนา
// ------------------------------------------------------------------
// db.backup() เป็น async — คืน Promise ที่ resolve เมื่อคัดลอกครบทุกหน้า
// now มีไว้ให้ชุดทดสอบกำหนดเวลาเองได้ — แอปไม่ต้องส่งมา
export async function createBackup(db, userDataPath, { label, isDev = false, now = new Date() } = {}) {
  const dir = ensureDir(resolveBackupDir(userDataPath, { isDev }))
  const fileName = reserveBackupFile(dir, now)
  const target = path.join(dir, fileName)

  try {
    await db.backup(target)
  } catch (err) {
    // สำรองไม่สำเร็จ = อย่าทิ้งไฟล์ที่จองไว้ (เปล่าหรือครึ่งๆ กลางๆ) ให้โผล่ในรายการ
    // เพราะหน้าตาเหมือนไฟล์สำรองปกติ แล้ววันหนึ่งจะมีคนกดกู้คืนจากมัน
    fs.rmSync(target, { force: true })
    throw err
  }

  // บันทึกป้ายกำกับไว้ในไฟล์ข้างๆ ไม่ยัดลงชื่อไฟล์ — ชื่อไฟล์ต้องเรียงตามเวลาได้เสมอ
  // และผู้ใช้พิมพ์อักษรที่ใช้เป็นชื่อไฟล์ไม่ได้ลงไปได้
  if (label) {
    fs.writeFileSync(`${target}.txt`, String(label).trim(), 'utf-8')
  }

  return describeBackup(dir, fileName)
}

// ------------------------------------------------------------------
// อ่านรายการ
// ------------------------------------------------------------------
export function listBackups(userDataPath, { isDev = false } = {}) {
  const dir = resolveBackupDir(userDataPath, { isDev })
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.sqlite'))
    .map((name) => describeBackup(dir, name))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function describeBackup(dir, fileName) {
  const full = path.join(dir, fileName)
  const stat = fs.statSync(full)
  const labelFile = `${full}.txt`

  return {
    fileName,
    path: full,
    sizeBytes: stat.size,
    createdAt: stat.mtime.toISOString(),
    label: fs.existsSync(labelFile) ? fs.readFileSync(labelFile, 'utf-8') : null
  }
}

// ------------------------------------------------------------------
// ตรวจว่าไฟล์ใช้กู้คืนได้จริง
// ------------------------------------------------------------------
// เปิดอ่านแบบ read-only แล้วดูว่ามีตาราง _migrations กับ apartments อยู่จริงไหม
// กันการเอาไฟล์อะไรก็ไม่รู้มาทับฐานข้อมูลจริงแล้วพังทั้งระบบ
// knownMigrations = ชื่อไฟล์ migration ทั้งหมดที่แอปเวอร์ชันนี้มี (จาก migrationsDir)
// ส่งเข้ามาเพื่อกันการกู้คืนไฟล์ที่มาจากแอป "รุ่นใหม่กว่า" — ดูเหตุผลด้านล่าง
export function inspectBackup(filePath, knownMigrations = null) {
  if (!fs.existsSync(filePath)) throw new Error('ไม่พบไฟล์สำรองที่ระบุ')

  let probe
  try {
    probe = new Database(filePath, { readonly: true })
    const tables = new Set(
      probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
    )
    if (!tables.has('_migrations') || !tables.has('apartments')) {
      throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของ Dormy Manager')
    }

    const applied = probe.prepare('SELECT name FROM _migrations ORDER BY name').all().map((r) => r.name)
    const apartments = probe.prepare('SELECT COUNT(*) AS n FROM apartments').get().n

    // *** กันการกู้คืนไฟล์จากแอปรุ่นใหม่กว่า ***
    //
    // migration runner เดินไปข้างหน้าอย่างเดียว ไม่มีทางย้อนกลับ ถ้าไฟล์สำรองผ่าน
    // migration ที่แอปรุ่นนี้ยังไม่มีไฟล์ให้รู้จัก แปลว่าสคีมาข้างในใหม่กว่าที่โค้ดนี้เข้าใจ
    // — กู้คืนไปแล้วจะ "เปิดได้แต่ทำงานเพี้ยน" ซึ่งอันตรายกว่าพังตรงๆ เพราะไม่มีใครสังเกต
    //
    // เกิดได้จริงตอนมีแอปหลายรุ่นในมือ: อัปเดตแอป → สำรอง → ย้อนกลับไปใช้รุ่นเก่า → กู้คืน
    if (knownMigrations) {
      const known = new Set(knownMigrations)
      const unknown = applied.filter((name) => !known.has(name))
      if (unknown.length > 0) {
        throw new Error(
          `ไฟล์สำรองนี้มาจากโปรแกรมรุ่นใหม่กว่าที่ใช้อยู่ (มีการอัปเดตฐานข้อมูล ${unknown.length} รายการที่รุ่นนี้ยังไม่รู้จัก) — กรุณาอัปเดตโปรแกรมให้เป็นรุ่นล่าสุดก่อนกู้คืน`
        )
      }
    }

    return { migrations: applied.length, appliedMigrations: applied, apartments }
  } catch (err) {
    // ข้อความของ SQLite ("file is not a database") ผู้ใช้อ่านไม่รู้เรื่อง — แต่ข้อความที่เรา
    // ตั้งใจโยนเองต้องผ่านออกไปตามเดิม ไม่ถูกกลบด้วยข้อความรวม
    if (err.message.includes('ไฟล์นี้ไม่ใช่') || err.message.includes('รุ่นใหม่กว่า')) throw err
    throw new Error('เปิดไฟล์สำรองไม่ได้ — ไฟล์อาจเสียหายหรือไม่ใช่ไฟล์ฐานข้อมูล')
  } finally {
    probe?.close()
  }
}

// อ่านรายชื่อไฟล์ migration ที่แอปเวอร์ชันนี้มี — ชุดเดียวกับที่ migrate.js ใช้
export function listKnownMigrations(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) return []
  return fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()
}

// ------------------------------------------------------------------
// กู้คืน
// ------------------------------------------------------------------
// คืนค่าเป็น path ที่ต้องเอาไปทับ ให้ฝั่ง handler เป็นคนปิดฐานข้อมูล/ทับไฟล์/รีสตาร์ตแอป
// เพราะโมดูลนี้ต้องไม่รู้จัก electron (ชุดทดสอบรันใต้ ELECTRON_RUN_AS_NODE ที่ import
// electron ไม่ได้ — กฎเดียวกับ db/*.js ตัวอื่น)
export function prepareRestore(userDataPath, fileName, migrationsDir = null, { isDev = false } = {}) {
  const source = path.join(resolveBackupDir(userDataPath, { isDev }), fileName)
  const info = inspectBackup(source, migrationsDir ? listKnownMigrations(migrationsDir) : null)
  return { source, info }
}

export function deleteBackup(userDataPath, fileName, { isDev = false } = {}) {
  const full = path.join(resolveBackupDir(userDataPath, { isDev }), fileName)
  if (!fs.existsSync(full)) throw new Error('ไม่พบไฟล์สำรองที่ต้องการลบ')

  fs.rmSync(full)
  if (fs.existsSync(`${full}.txt`)) fs.rmSync(`${full}.txt`)
  return { ok: true }
}
