import path from 'path'
import { app } from 'electron'
import Database from 'better-sqlite3'
import { runMigrations } from './db/migrate.js'

let db = null

// ไฟล์ .sql ไม่ถูก bundle — dev อ่านจาก source, ตัวจริงอ่านจาก resources
export function resolveMigrationsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'migrations')
    : path.join(app.getAppPath(), 'src/main/migrations')
}

// dev กับตัวจริงใช้คนละไฟล์ฐานข้อมูล
export function resolveDbPath() {
  const fileName = app.isPackaged ? 'dormy.sqlite' : 'dormy-dev.sqlite'
  return path.join(app.getPath('userData'), fileName)
}

// ขั้น 2
export function openDatabase(dbPath, migrationsDir = resolveMigrationsDir()) {
  // ใช้ path ไหนเช่น dormy.sqlite หรือ dormy-dev.dqlite 
  // อยูาที่ว่าโปรแกรมเป็น exe แล้ว หรือยังเป็น develop environment
  const instance = new Database(dbPath) // instance = sqlite(dormy.sqlite) สมมติเป็น exe แล้ว
  try {
    instance.pragma('journal_mode = WAL') // เปิดการทำงาน อ่าน เขียน ของ sqlite (Write Ahead Logging)
    instance.pragma('foreign_keys = ON') // เปิด foreing key sqlite
    runMigrations(instance, migrationsDir) // Run migration ที่สร้างไว้ เพื่อให้ database มีข้อมูลพร้อมกับการใช้งาน
    return instance 
  } catch (error) {
    instance.close()
    throw error
  }
}

// ขั้นแรกทำงานตรงนี้ 1
export function getDatabase() {
  if (db) return db
  db = openDatabase(resolveDbPath())
  return db
}

// ใช้ตอนกู้คืน — handler ต้องเรียก getDatabase() ใหม่ทุกครั้ง ห้ามเก็บ instance ไว้
// dormy.sqlite -> ปิด DB -> เอา Backup DB มาแทน -> เปฺิด DB ใหม่
export function closeDatabase() {
  if (!db) return
  db.close()
  db = null
}
