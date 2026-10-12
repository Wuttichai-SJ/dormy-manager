// ไฟล์ migration ที่ปล่อยไปแล้วห้ามแก้ — เพิ่มไฟล์ใหม่เท่านั้น
import fs from 'fs'
import path from 'path'

export function runMigrations(db, migrationsDir) {
  // สร้าง db _migrations ถ้ามีไม่ต้องสร้าง
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )
  `) // เก็บ id - name - applied_at

  // หาโฟลเดอร์ migration ไม่เจอต้อง error ทันที
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`ไม่พบโฟลเดอร์ migrations ที่ ${migrationsDir}`)
  }

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((r) => r.name)
    // เตรียมคำสั่ง prepare -> เอาทุกแถวที่ได้มา -> map เรียงแค่ name จากตาราง _migrations
  )

  // หาไฟล์ migration ที่ลงท้ายด้วย .sql
  const files = fs
    .readdirSync(migrationsDir) 
    .filter((f) => f.endsWith('.sql')) // กรองไฟล์ที่ลงท้าย .sql
    .sort() // เรียงลำดับเลขของไฟล์ migration

  // กรณีหาไฟล์ไม่เจอ หรือไม่มีไฟล์
  if (files.length === 0) {
    throw new Error(`โฟลเดอร์ migrations ว่างเปล่า: ${migrationsDir}`)
  }

  // เช็คไฟล์ที่มีอยู่แล้วให้ข้าม
  for (const file of files) { // loop ไฟล์ที่เจอ migrations
    if (applied.has(file)) continue // หากเจอตัวที่ทำไปให้ข้าม
    // ตัวแปร sql ไปอ่านไฟล์ migration
    // migrationDir ตัวอย่าง /src/main/migrations
    // file ตัวอย่าง 001_init.sql
    // path.join -> /src/main/migration/001_init.sql ซึ่งเป็นไฟล์ตัวเต็มเข้าไปอ่านได้ โดยใช้ urf-8 อ่านแบบ string
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')

    const applyOne = db.transaction(() => { // ใช้ transaction เพื่อคุมการทำงานให้ทั้ง exec และ insert into _migration เสร็จพร้อมกัน
      db.exec(sql) // เอาตัวแปร sql ที่ได้เป็น string ไปรัน database execute
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run( // เอาข้อมูลไปใส่ _migrations
        file, // ชื่อไฟล์ที่ filter
        new Date().toISOString() // วันที่
      )
    })
    applyOne() // เรียกใช้งาน
  }
}
