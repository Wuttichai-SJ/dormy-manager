// Hand-rolled migration runner (no ORM). Runs once at startup, before any db access.
// Migration files: numbered, immutable once shipped (001_init.sql, 002_...).
// The user's local _migrations table is the only record of what has been applied.
import fs from 'fs'
import path from 'path'

export function runMigrations(db, migrationsDir) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `)

  // หา migration ไม่เจอ = ต้องดังทันที ห้ามเงียบ
  // ถ้าปล่อยผ่าน แอปจะเปิดฐานข้อมูล "เปล่า" ที่ไม่มีตารางสักตาราง แล้วดูเหมือนทำงานปกติ
  // จนกว่าจะมีคนกดใช้งานจริง — เคสที่จะเจอคือตอนแพ็กเป็น .exe แล้วลืมคัดโฟลเดอร์
  // migrations ไปด้วย (ยังไม่ได้ตั้ง extraResources — งาน Phase 4)
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`ไม่พบโฟลเดอร์ migrations ที่ ${migrationsDir}`)
  }

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((r) => r.name)
  )
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort() // 001_, 002_... sort naturally

  if (files.length === 0) {
    throw new Error(`โฟลเดอร์ migrations ว่างเปล่า: ${migrationsDir}`)
  }

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    // One file = one transaction; a failure here must stop startup, not silently continue.
    const applyOne = db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(
        file,
        new Date().toISOString()
      )
    })
    applyOne()
  }
}
