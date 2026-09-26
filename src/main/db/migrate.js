// ไฟล์ migration ที่ปล่อยไปแล้วห้ามแก้ — เพิ่มไฟล์ใหม่เท่านั้น
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

  // หาโฟลเดอร์ migration ไม่เจอต้อง error ทันที
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`ไม่พบโฟลเดอร์ migrations ที่ ${migrationsDir}`)
  }

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((r) => r.name)
  )
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  if (files.length === 0) {
    throw new Error(`โฟลเดอร์ migrations ว่างเปล่า: ${migrationsDir}`)
  }

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
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
