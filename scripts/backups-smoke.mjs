// ทดสอบการสำรอง/กู้คืนบนฐานข้อมูลชั่วคราว — รันด้วย: npm run test:backups
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  assert,
  check,
  ensureElectronRuntime,
  group,
  openTempDatabase,
  summarize,
  throws
} from './lib/harness.mjs'

ensureElectronRuntime(import.meta.url)

const Database = (await import('better-sqlite3')).default
const apartments = await import('../src/main/db/apartments.js')
const backups = await import('../src/main/db/backups.js')

const { db, cleanup } = await openTempDatabase('dormy-backups')

// โฟลเดอร์ userData จำลอง — ของจริงคือ app.getPath('userData')
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dormy-userdata-'))

apartments.insertApartment(db, {
  nameTh: 'หอทดสอบสำรองข้อมูล',
  addressTh: 'ที่อยู่',
  dueDateDay: 5,
  lateFeePerDay: '0'
})

// -----------------------------------------------------
group('สร้างสำเนา')

const first = await backups.createBackup(db, userData, { label: 'ก่อนทดลอง' })

check('ได้ไฟล์สำรองที่มีขนาดจริง', () => {
  assert(fs.existsSync(first.path), 'ไม่พบไฟล์ที่สร้าง')
  assert(first.sizeBytes > 0, `ขนาด ${first.sizeBytes}`)
})

check('ชื่อไฟล์เรียงตามเวลาได้ด้วยการเรียงตัวอักษร', () => {
  assert(/^dormy-\d{4}-\d{2}-\d{2}_\d{6}\.sqlite$/.test(first.fileName), first.fileName)
})

check('ป้ายกำกับถูกเก็บไว้และอ่านกลับมาได้', () => {
  assert(first.label === 'ก่อนทดลอง', `ได้ ${first.label}`)
})

// จุดสำคัญที่สุดของโมดูลนี้: WAL ต้องถูกรวมเข้าไฟล์สำเนาแล้ว
// ถ้าใช้ fs.copyFile ธรรมดา ข้อมูลที่เพิ่งเขียนจะยังค้างใน -wal แล้วสำเนาจะขาดหอนี้ไป
check('ข้อมูลที่เพิ่งเขียนอยู่ในไฟล์สำรองครบ (ไม่ตกค้างใน WAL)', () => {
  const info = backups.inspectBackup(first.path)
  assert(info.apartments === 1, `ควรมี 1 หอในไฟล์สำรอง ได้ ${info.apartments}`)
  assert(info.migrations > 0, `ควรมีประวัติ migration ได้ ${info.migrations}`)
})

// -----------------------------------------------------
group('รายการสำเนา')

// งานที่ต้อง await ทำนอก check() — harness.check เป็น synchronous
// ถ้าส่ง async function เข้าไป มันจะได้ Promise กลับมาแล้วนับว่าผ่านทันทีโดยไม่รอผล
apartments.insertApartment(db, {
  nameTh: 'หอที่สอง',
  addressTh: 'ที่อยู่',
  dueDateDay: 5,
  lateFeePerDay: '0'
})
// ชื่อไฟล์ละเอียดถึงวินาที — หน่วงเล็กน้อยกันชนกันเองในเครื่องที่เร็วมาก
await new Promise((resolve) => setTimeout(resolve, 1100))
await backups.createBackup(db, userData)

check('เขียนข้อมูลเพิ่มแล้วสำรองใหม่ ได้สองไฟล์ ใหม่สุดอยู่บน', () => {
  const list = backups.listBackups(userData)
  assert(list.length === 2, `ได้ ${list.length} ไฟล์`)
  assert(list[0].createdAt >= list[1].createdAt, 'ไฟล์ใหม่สุดต้องอยู่บนสุด')
})

check('สำเนาใบใหม่มีข้อมูลที่เพิ่มทีหลังด้วย ส่วนใบเก่าไม่มี', () => {
  const list = backups.listBackups(userData)
  assert(backups.inspectBackup(list[0].path).apartments === 2, 'ใบใหม่ควรมี 2 หอ')
  assert(backups.inspectBackup(list[1].path).apartments === 1, 'ใบเก่าต้องไม่เปลี่ยนตาม')
})

// -----------------------------------------------------
group('ตรวจไฟล์ก่อนกู้คืน')

check('ไฟล์ที่ไม่ใช่ฐานข้อมูล กู้คืนไม่ได้', () => {
  const junk = path.join(userData, 'junk.sqlite')
  fs.writeFileSync(junk, 'this is not a database', 'utf-8')
  throws(() => backups.inspectBackup(junk), 'เปิดไฟล์สำรองไม่ได้', 'ควรกันไฟล์ขยะ')
})

const stranger = path.join(userData, 'stranger.sqlite')
const strangerDb = new Database(stranger)
strangerDb.exec('CREATE TABLE something (id INTEGER)')
strangerDb.close()

check('ฐานข้อมูล SQLite ที่ไม่ใช่ของแอปนี้ กู้คืนไม่ได้', () => {
  throws(() => backups.inspectBackup(stranger), 'ไม่ใช่ไฟล์สำรองของ Dormy Manager', 'ควรกัน')
})

check('ไฟล์ที่ไม่มีอยู่ ต้องแจ้งเตือน', () => {
  throws(() => backups.inspectBackup(path.join(userData, 'ghost.sqlite')), 'ไม่พบไฟล์สำรอง', 'ควรแจ้ง')
})

check('prepareRestore คืน path และสรุปข้อมูลในไฟล์', () => {
  const list = backups.listBackups(userData)
  const { source, info } = backups.prepareRestore(userData, list[0].fileName)
  assert(source.endsWith(list[0].fileName), source)
  assert(info.apartments === 2, `ได้ ${info.apartments}`)
})

// -----------------------------------------------------
group('ลบสำเนา')

check('ลบไฟล์สำรองได้ พร้อมไฟล์ป้ายกำกับ', () => {
  const before = backups.listBackups(userData).length
  backups.deleteBackup(userData, first.fileName)

  assert(backups.listBackups(userData).length === before - 1, 'จำนวนไม่ลดลง')
  assert(!fs.existsSync(first.path), 'ไฟล์ยังอยู่')
  assert(!fs.existsSync(`${first.path}.txt`), 'ไฟล์ป้ายกำกับยังอยู่')
})

check('ลบไฟล์ที่ไม่มีอยู่ ต้องแจ้งเตือน', () => {
  throws(() => backups.deleteBackup(userData, 'ghost.sqlite'), 'ไม่พบไฟล์สำรอง', 'ควรแจ้ง')
})

// -----------------------------------------------------
cleanup()
fs.rmSync(userData, { recursive: true, force: true })
summarize('การสำรอง/กู้คืนข้อมูลทำงานครบทุกเส้นทาง')
