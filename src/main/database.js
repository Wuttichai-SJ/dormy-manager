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

export function openDatabase(dbPath, migrationsDir = resolveMigrationsDir()) {
  const instance = new Database(dbPath)
  try {
    instance.pragma('journal_mode = WAL')
    instance.pragma('foreign_keys = ON')
    runMigrations(instance, migrationsDir)
    return instance
  } catch (error) {
    instance.close()
    throw error
  }
}

export function getDatabase() {
  if (db) return db
  db = openDatabase(resolveDbPath())
  return db
}

// ใช้ตอนกู้คืน — handler ต้องเรียก getDatabase() ใหม่ทุกครั้ง ห้ามเก็บ instance ไว้
export function closeDatabase() {
  if (!db) return
  db.close()
  db = null
}
