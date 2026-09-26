// เครื่องมือทดสอบที่ scripts/*-smoke.mjs ใช้ร่วมกัน · ห้าม import better-sqlite3 ที่ระดับบนสุด
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// better-sqlite3 เป็น prebuilt ของ Electron — เรียกตัวเองใหม่ใต้ ELECTRON_RUN_AS_NODE (เรียกเป็นบรรทัดแรกเสมอ)
export function ensureElectronRuntime(metaUrl) {
  if (process.versions.electron) return

  const electronBin = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
  // ส่ง argv ต่อให้รอบที่รันจริง
  const args = [fileURLToPath(metaUrl), ...process.argv.slice(2)]
  const child = spawnSync(fs.existsSync(electronBin) ? electronBin : 'electron', args, {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  process.exit(child.status ?? 1)
}

let passed = 0
const failures = []

export function group(name) {
  console.log(`\n${name}`)
}

export function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (err) {
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}\n         ${err.message}`)
  }
}

export function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export function throws(fn, expectedPart, message) {
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

export function summarize(label) {
  console.log(`\n${passed} ผ่าน / ${failures.length} ไม่ผ่าน`)
  if (failures.length > 0) {
    console.log('\nรายการที่ไม่ผ่าน:')
    for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
    process.exit(1)
  }
  console.log(`${label}\n`)
}

// ฐานข้อมูลชั่วคราว — รัน migration ชุดเดียวกับแอปจริง
export async function openTempDatabase(prefix) {
  const { default: Database } = await import('better-sqlite3')
  const { runMigrations } = await import('../../src/main/db/migrate.js')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  const dbPath = path.join(dir, 'test.sqlite')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db, path.join(projectRoot, 'src/main/migrations'))

  console.log(`\nฐานข้อมูลทดสอบ: ${dbPath}`)
  return {
    db,
    cleanup() {
      db.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}
