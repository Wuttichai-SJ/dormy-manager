// ห้าม copyFile ไฟล์ .sqlite ตรงๆ (WAL) — ใช้ db.backup()
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

// dev ใช้คนละโฟลเดอร์กับตัวจริง — ผู้เรียกฝั่ง handler เป็นคนบอก
export function resolveBackupDir(userDataPath, { isDev = false } = {}) {
  return path.join(userDataPath, isDev ? 'backups-dev' : 'backups')
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

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

// จองชื่อไฟล์ด้วย 'wx' กันสำรองสองใบในวินาทีเดียวกันทับกัน
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

export async function createBackup(db, userDataPath, { label, isDev = false, now = new Date() } = {}) {
  const dir = ensureDir(resolveBackupDir(userDataPath, { isDev }))
  const fileName = reserveBackupFile(dir, now)
  const target = path.join(dir, fileName)

  try {
    await db.backup(target)
  } catch (err) {
    // สำรองไม่สำเร็จ ลบไฟล์ที่จองไว้ทิ้ง
    fs.rmSync(target, { force: true })
    throw err
  }

  // ป้ายกำกับเก็บในไฟล์ .txt ข้างๆ
  if (label) {
    fs.writeFileSync(`${target}.txt`, String(label).trim(), 'utf-8')
  }

  return describeBackup(dir, fileName)
}

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

// ตรวจว่าเป็นไฟล์สำรองจริงก่อนกู้คืน
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

    // ไม่กู้คืนไฟล์จากแอปรุ่นใหม่กว่า (migration ย้อนกลับไม่ได้)
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
    if (err.message.includes('ไฟล์นี้ไม่ใช่') || err.message.includes('รุ่นใหม่กว่า')) throw err
    throw new Error('เปิดไฟล์สำรองไม่ได้ — ไฟล์อาจเสียหายหรือไม่ใช่ไฟล์ฐานข้อมูล')
  } finally {
    probe?.close()
  }
}

export function listKnownMigrations(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) return []
  return fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()
}

// ชื่อไฟล์ต้องชี้ไปไฟล์ .sqlite ในโฟลเดอร์สำรองเท่านั้น
function resolveBackupFile(userDataPath, fileName, { isDev = false } = {}) {
  const dir = path.resolve(resolveBackupDir(userDataPath, { isDev }))
  const name = String(fileName ?? '')
  const plainName =
    name !== '' &&
    name === path.basename(name) &&
    !name.includes('/') &&
    !name.includes('\\') &&
    name !== '.' &&
    name !== '..'
  const full = path.resolve(dir, name)
  if (!plainName || !name.endsWith('.sqlite') || path.dirname(full) !== dir) {
    throw new Error('ชื่อไฟล์สำรองไม่ถูกต้อง')
  }
  return full
}

export function prepareRestore(userDataPath, fileName, migrationsDir = null, { isDev = false } = {}) {
  const source = resolveBackupFile(userDataPath, fileName, { isDev })
  const info = inspectBackup(source, migrationsDir ? listKnownMigrations(migrationsDir) : null)
  return { source, info }
}

export function deleteBackup(userDataPath, fileName, { isDev = false } = {}) {
  const full = resolveBackupFile(userDataPath, fileName, { isDev })
  if (!fs.existsSync(full)) throw new Error('ไม่พบไฟล์สำรองที่ต้องการลบ')

  fs.rmSync(full)
  if (fs.existsSync(`${full}.txt`)) fs.rmSync(`${full}.txt`)
  return { ok: true }
}
