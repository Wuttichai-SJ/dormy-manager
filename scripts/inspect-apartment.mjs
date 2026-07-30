// เครื่องมือช่วยดู/ลบหอพักในฐานข้อมูลจริงของเครื่องนี้ ใช้ตอนที่หน้าจอลบให้ไม่ได้
//
//   node scripts/inspect-apartment.mjs                   → รายชื่อหอทั้งหมด + จำนวนของที่ผูกอยู่
//   node scripts/inspect-apartment.mjs --delete-id <id>  → ลบหอนั้นพร้อมชั้น/ห้อง/ค่าบริการที่ผูกไว้
//   เติม --prod เพื่อทำกับ dormy.sqlite (ฐานข้อมูลจริง) แทน dormy-dev.sqlite
//
// เขียนผลลงไฟล์ scripts/.inspect-out.txt ด้วย เพราะ Electron บน Windows เป็น GUI subsystem
// stdout ไม่โผล่ที่เทอร์มินัล (ดู README) — ลบไฟล์ก่อนรันใหม่ทุกครั้ง ไม่งั้นอ่านผลเก่า
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureElectronRuntime } from './lib/harness.mjs'

ensureElectronRuntime(import.meta.url)

const Database = (await import('better-sqlite3')).default

const dir = path.dirname(fileURLToPath(import.meta.url))
const outFile = path.join(dir, '.inspect-out.txt')
const lines = []
const say = (line) => lines.push(line)

// ฐานข้อมูลของโหมด dev แยกจากของจริงคนละไฟล์ (ดู src/main/database.js)
const appData = process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData/Roaming')
const dbFile = path.join(appData, 'dormy-manager', process.argv.includes('--prod') ? 'dormy.sqlite' : 'dormy-dev.sqlite')

say(`ฐานข้อมูล: ${dbFile}`)
const db = new Database(dbFile)
db.pragma('foreign_keys = ON')

const rows = db
  .prepare(
    `SELECT a.apartment_id AS id, a.name_th AS name,
       (SELECT COUNT(*) FROM floors f WHERE f.apartment_id = a.apartment_id) AS floors,
       (SELECT COUNT(*) FROM rooms r JOIN floors f ON f.floor_id = r.floor_id
         WHERE f.apartment_id = a.apartment_id) AS rooms,
       (SELECT COUNT(*) FROM apartment_services s WHERE s.apartment_id = a.apartment_id) AS services,
       (SELECT COUNT(*) FROM apartment_bank_accounts b WHERE b.apartment_id = a.apartment_id) AS banks
     FROM apartments a ORDER BY a.display_order, a.apartment_id`
  )
  .all()

say('')
say('id  | ชื่อหอ                | ชั้น | ห้อง | ค่าบริการ | บัญชี')
for (const r of rows) {
  say(`${String(r.id).padEnd(3)} | ${r.name.padEnd(20)} | ${String(r.floors).padEnd(3)} | ${String(r.rooms).padEnd(4)} | ${String(r.services).padEnd(8)} | ${r.banks}`)
}

// รับเป็น id เท่านั้น ไม่รับชื่อ — ชื่อภาษาไทยที่ส่งผ่าน argv บน Windows เพี้ยนได้
// (cmd/PowerShell ส่งมาคนละ code page) แล้วจะกลายเป็น "ไม่พบหอ" ทั้งที่มีอยู่
const deleteAt = process.argv.indexOf('--delete-id')
if (deleteAt !== -1) {
  const target = Number(process.argv[deleteAt + 1])
  const row = rows.find((r) => r.id === target)
  if (!row) {
    say('')
    say(`!! ไม่พบหอ id ${target}`)
  } else {
    // ลบจากใบไปหาราก เพราะ FK เปิดอยู่ — ห้องต้องไปก่อนชั้น ชั้นต้องไปก่อนหอ
    const run = db.transaction(() => {
      const floorIds = db
        .prepare('SELECT floor_id FROM floors WHERE apartment_id = ?')
        .all(row.id)
        .map((f) => f.floor_id)

      for (const floorId of floorIds) {
        const roomIds = db.prepare('SELECT room_id FROM rooms WHERE floor_id = ?').all(floorId).map((r) => r.room_id)
        for (const roomId of roomIds) {
          db.prepare('DELETE FROM room_services WHERE room_id = ?').run(roomId)
          db.prepare('DELETE FROM room_utility_settings WHERE room_id = ?').run(roomId)
        }
        db.prepare('DELETE FROM rooms WHERE floor_id = ?').run(floorId)
      }

      db.prepare('DELETE FROM floors WHERE apartment_id = ?').run(row.id)
      db.prepare('DELETE FROM apartment_utility_defaults WHERE apartment_id = ?').run(row.id)
      db.prepare('DELETE FROM apartment_services WHERE apartment_id = ?').run(row.id)
      db.prepare('DELETE FROM apartment_bank_accounts WHERE apartment_id = ?').run(row.id)
      db.prepare('DELETE FROM users_apartments WHERE apartment_id = ?').run(row.id)
      db.prepare('DELETE FROM apartments WHERE apartment_id = ?').run(row.id)
    })
    run()
    say('')
    say(`ลบแล้ว: id ${row.id} "${row.name}" (ชั้น ${row.floors} / ห้อง ${row.rooms} / ค่าบริการ ${row.services} / บัญชี ${row.banks})`)
    say('เหลือ: ' + db.prepare('SELECT COUNT(*) AS n FROM apartments').get().n + ' หอ')
  }
}

db.close()
fs.writeFileSync(outFile, lines.join('\n'), 'utf-8')
