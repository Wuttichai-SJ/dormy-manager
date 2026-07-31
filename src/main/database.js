// Opens the single-file SQLite database, sets pragmas, and runs migrations.
// Shared instance — every db/*.js module imports getDatabase() from here.
import path from 'path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { runMigrations } from './db/migrate.js'

let db = null

// .sql migration files are NOT bundled by vite, so resolve them from source in dev and
// from the packaged resources in production (see electron-builder extraResources later).
export function resolveMigrationsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'migrations')
    : path.join(app.getAppPath(), 'src/main/migrations')
}

// แยกไฟล์ฐานข้อมูลของ dev ออกจากของจริงคนละไฟล์ โดยตั้งใจ:
// เครื่องนี้เป็นทั้งเครื่องพัฒนาและเครื่องที่รันแอปจริง ถ้าใช้ไฟล์เดียวกัน การกดเล่น
// ทดลองตอน dev จะไปปนกับข้อมูลหอพักจริงโดยไม่มีใครรู้ตัว และล้าง dev ทีก็ลบของจริงทิ้งไปด้วย
// ทั้งสองไฟล์เริ่มต้นจาก "ว่างเปล่า" เหมือนกัน (ไม่มีการ seed ข้อมูลตัวอย่างใดๆ)
export function resolveDbPath() {
  const fileName = app.isPackaged ? 'dormy.sqlite' : 'dormy-dev.sqlite'
  return path.join(app.getPath('userData'), fileName)
}

// เปิดไฟล์ฐานข้อมูลตาม path ที่ระบุ + ตั้ง pragma + รัน migrations
// แยกออกมาเป็นฟังก์ชันเดี่ยวเพื่อให้ชุดทดสอบเปิดฐานข้อมูลชั่วคราวของตัวเองได้
// ด้วยขั้นตอนเดียวกับแอปจริงเป๊ะๆ (ไม่ใช่ทดสอบกับ schema ที่สร้างขึ้นคนละทาง)
export function openDatabase(dbPath, migrationsDir = resolveMigrationsDir()) {
  const instance = new Database(dbPath)
  instance.pragma('journal_mode = WAL') // safer concurrent reads, crash resilience
  instance.pragma('foreign_keys = ON') // SQLite does NOT enforce FKs by default
  runMigrations(instance, migrationsDir)
  return instance
}

export function getDatabase() {
  if (db) return db
  db = openDatabase(resolveDbPath())
  return db
}

// ปิดฐานข้อมูลแล้วลืมมันไป — ครั้งถัดไปที่ getDatabase() ถูกเรียก จะเปิดไฟล์ใหม่ให้เอง
// พร้อมรัน migrations อีกรอบ
//
// ใช้ตอนกู้คืนข้อมูล: ต้องปิดก่อนถึงจะทับไฟล์ได้ (Windows ล็อกไฟล์ที่เปิดอยู่) แล้วพอเปิดใหม่
// ไฟล์สำรองที่มาจากแอปเวอร์ชันเก่ากว่าจะถูกอัปเกรดด้วย migrations ที่ยังไม่เคยรันโดยอัตโนมัติ
//
// ปลอดภัยเพราะทุก handler เรียก getDatabase() ใหม่ทุกครั้งที่ทำงาน ไม่มีใครถือ instance
// เก่าค้างไว้ (ดู handlers/*.js — ห้ามเก็บผลของ getDatabase() ไว้ในตัวแปรระดับโมดูล)
export function closeDatabase() {
  if (!db) return
  db.close()
  db = null
}
