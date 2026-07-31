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
export function resolveBackupDir(userDataPath) {
  return path.join(userDataPath, 'backups')
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ชื่อไฟล์เรียงตามเวลาได้เองเมื่อเรียงตามตัวอักษร (YYYY-MM-DD_HHmm)
// อ่านออกด้วยตาโดยไม่ต้องเปิดโปรแกรมอะไร
function buildFileName(now = new Date()) {
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
    '.sqlite'
  ].join('')
}

// ------------------------------------------------------------------
// สร้างสำเนา
// ------------------------------------------------------------------
// db.backup() เป็น async — คืน Promise ที่ resolve เมื่อคัดลอกครบทุกหน้า
export async function createBackup(db, userDataPath, { label } = {}) {
  const dir = ensureDir(resolveBackupDir(userDataPath))
  const fileName = buildFileName()
  const target = path.join(dir, fileName)

  await db.backup(target)

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
export function listBackups(userDataPath) {
  const dir = resolveBackupDir(userDataPath)
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
export function inspectBackup(filePath) {
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

    const applied = probe.prepare('SELECT COUNT(*) AS n FROM _migrations').get().n
    const apartments = probe.prepare('SELECT COUNT(*) AS n FROM apartments').get().n
    return { migrations: applied, apartments }
  } catch (err) {
    // ข้อความของ SQLite ("file is not a database") ผู้ใช้อ่านไม่รู้เรื่อง
    if (err.message.includes('ไฟล์นี้ไม่ใช่')) throw err
    throw new Error('เปิดไฟล์สำรองไม่ได้ — ไฟล์อาจเสียหายหรือไม่ใช่ไฟล์ฐานข้อมูล')
  } finally {
    probe?.close()
  }
}

// ------------------------------------------------------------------
// กู้คืน
// ------------------------------------------------------------------
// คืนค่าเป็น path ที่ต้องเอาไปทับ ให้ฝั่ง handler เป็นคนปิดฐานข้อมูล/ทับไฟล์/รีสตาร์ตแอป
// เพราะโมดูลนี้ต้องไม่รู้จัก electron (ชุดทดสอบรันใต้ ELECTRON_RUN_AS_NODE ที่ import
// electron ไม่ได้ — กฎเดียวกับ db/*.js ตัวอื่น)
export function prepareRestore(userDataPath, fileName) {
  const source = path.join(resolveBackupDir(userDataPath), fileName)
  const info = inspectBackup(source)
  return { source, info }
}

export function deleteBackup(userDataPath, fileName) {
  const full = path.join(resolveBackupDir(userDataPath), fileName)
  if (!fs.existsSync(full)) throw new Error('ไม่พบไฟล์สำรองที่ต้องการลบ')

  fs.rmSync(full)
  if (fs.existsSync(`${full}.txt`)) fs.rmSync(`${full}.txt`)
  return { ok: true }
}
