// ชุดเครื่องมือทดสอบขนาดจิ๋วที่สคริปต์ scripts/*-smoke.mjs ใช้ร่วมกัน
//
// ไม่ได้ลง test framework โดยตั้งใจ (นโยบาย dependency: ทุกแพ็กเกจคือภาระ 20 ปี)
// ไฟล์นี้มีแค่สิ่งที่จำเป็นจริง: เรียกตัวเองใหม่ใต้ Electron, assert, และฐานข้อมูลชั่วคราว
//
// ห้าม import better-sqlite3 ที่ระดับบนสุดของไฟล์นี้ — ต้องรอให้ ensureElectronRuntime()
// สลับไปรันใต้ Electron ก่อน ไม่งั้น node เปล่าจะพยายามโหลด .node ที่ผิด ABI แล้วพังทันที
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// better-sqlite3 ในโปรเจกต์นี้เป็นไฟล์ prebuilt สำหรับ ABI ของ Electron (ดู .npmrc)
// node ปกติจึงโหลดไม่ได้ — สคริปต์เลยเรียกตัวเองใหม่ในโหมด ELECTRON_RUN_AS_NODE
// เรียกเป็นบรรทัดแรกของสคริปต์เสมอ ก่อน import อะไรที่แตะฐานข้อมูล
export function ensureElectronRuntime(metaUrl) {
  if (process.versions.electron) return

  const electronBin = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
  // ต้องส่ง argv ต่อให้รอบที่รันจริงด้วย ไม่งั้นสคริปต์ที่รับตัวเลือกบรรทัดคำสั่ง
  // (เช่น inspect-apartment.mjs --delete-id 3) จะเห็น argv ว่าง แล้วทำงานเงียบๆ ไม่ครบ
  const args = [fileURLToPath(metaUrl), ...process.argv.slice(2)]
  const child = spawnSync(fs.existsSync(electronBin) ? electronBin : 'electron', args, {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  process.exit(child.status ?? 1)
}

// -----------------------------------------------------
// assert
// -----------------------------------------------------
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

// สรุปผลแล้วตั้ง exit code ให้ CI/คนรันเห็นชัดว่าผ่านหรือไม่ผ่าน
export function summarize(label) {
  console.log(`\n${passed} ผ่าน / ${failures.length} ไม่ผ่าน`)
  if (failures.length > 0) {
    console.log('\nรายการที่ไม่ผ่าน:')
    for (const f of failures) console.log(`  - ${f.name}: ${f.message}`)
    process.exit(1)
  }
  console.log(`${label}\n`)
}

// -----------------------------------------------------
// ฐานข้อมูลชั่วคราว
// -----------------------------------------------------
// เปิดไฟล์ใหม่ในโฟลเดอร์ temp แล้วรัน migration ชุดเดียวกับแอปจริงเป๊ะๆ
// (ไม่ได้สร้าง schema ขึ้นมาเองคนละทาง ไม่งั้นเทสต์ผ่านแต่ของจริงพัง)
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
