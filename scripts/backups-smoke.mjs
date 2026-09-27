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

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dormy-userdata-'))

apartments.insertApartment(db, {
  nameTh: 'หอทดสอบสำรองข้อมูล',
  addressTh: 'ที่อยู่',
  dueDateDay: 5,
  lateFeePerDay: '0'
})

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

check('ข้อมูลที่เพิ่งเขียนอยู่ในไฟล์สำรองครบ (ไม่ตกค้างใน WAL)', () => {
  const info = backups.inspectBackup(first.path)
  assert(info.apartments === 1, `ควรมี 1 หอในไฟล์สำรอง ได้ ${info.apartments}`)
  assert(info.migrations > 0, `ควรมีประวัติ migration ได้ ${info.migrations}`)
})

group('รายการสำเนา')

apartments.insertApartment(db, {
  nameTh: 'หอที่สอง',
  addressTh: 'ที่อยู่',
  dueDateDay: 5,
  lateFeePerDay: '0'
})
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

group('กันไฟล์จากแอปรุ่นใหม่กว่า')

check('ไฟล์ที่มี migration ที่แอปรุ่นนี้ไม่รู้จัก กู้คืนไม่ได้', () => {
  const list = backups.listBackups(userData)
  throws(
    () => backups.inspectBackup(list[0].path, ['001_init.sql']),
    'รุ่นใหม่กว่า',
    'ควรปฏิเสธไฟล์ที่สคีมาใหม่กว่าโค้ด'
  )
})

check('ไฟล์ที่ migration ครบตามที่แอปรู้จัก กู้คืนได้', () => {
  const list = backups.listBackups(userData)
  const known = backups.listKnownMigrations('src/main/migrations')
  const info = backups.inspectBackup(list[0].path, known)
  assert(info.appliedMigrations.length > 0, 'ควรอ่านรายการ migration ได้')
})

check('ไฟล์เก่ากว่า (migration น้อยกว่า) กู้คืนได้', () => {
  const list = backups.listBackups(userData)
  const known = [...backups.listKnownMigrations('src/main/migrations'), '999_ของอนาคต.sql']
  const info = backups.inspectBackup(list[0].path, known)
  assert(info.apartments === 2, `ได้ ${info.apartments}`)
})

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

group('สำเนาของ dev กับของจริงต้องไม่ปนกัน')

check('คนละโฟลเดอร์กัน', () => {
  const real = backups.resolveBackupDir(userData)
  const dev = backups.resolveBackupDir(userData, { isDev: true })
  assert(real !== dev, `ได้โฟลเดอร์เดียวกัน: ${real}`)
  assert(real.endsWith('backups'), `ของจริงควรลงท้าย backups ได้ ${real}`)
  assert(dev.endsWith('backups-dev'), `ของ dev ควรลงท้าย backups-dev ได้ ${dev}`)
})

check('ไม่ส่งตัวเลือกมา = โหมดจริง (ของเดิมต้องไม่เปลี่ยนพฤติกรรม)', () => {
  assert(
    backups.resolveBackupDir(userData) === backups.resolveBackupDir(userData, { isDev: false }),
    'ค่าเริ่มต้นต้องเท่ากับ isDev: false'
  )
})

for (const b of backups.listBackups(userData)) backups.deleteBackup(userData, b.fileName)

const devBackup = await backups.createBackup(db, userData, { label: 'ของ dev', isDev: true })

check('สำเนาที่สร้างในโหมด dev ไม่โผล่ในรายการของจริง', () => {
  const realList = backups.listBackups(userData)
  assert(realList.length === 0, `ฝั่งจริงควรว่าง แต่เห็น ${realList.length} ใบ`)

  const devList = backups.listBackups(userData, { isDev: true })
  assert(devList.length === 1, `รายการของ dev ควรมี 1 ใบ ได้ ${devList.length}`)
  assert(devList[0].fileName === devBackup.fileName, 'ไฟล์ใน dev ไม่ใช่ใบที่เพิ่งสร้าง')
  assert(devList[0].label === 'ของ dev', `ป้ายกำกับไม่ตามไปด้วย ได้ ${devList[0].label}`)
})

check('กู้คืนข้ามโหมดไม่ได้ — หาไฟล์ของ dev จากฝั่งจริงไม่เจอ', () => {
  throws(
    () => backups.prepareRestore(userData, devBackup.fileName),
    'ไม่พบไฟล์สำรอง',
    'ฝั่งจริงต้องมองไม่เห็นไฟล์ของ dev'
  )
})

check('ลบข้ามโหมดไม่ได้ — ไฟล์ของ dev ต้องยังอยู่', () => {
  throws(
    () => backups.deleteBackup(userData, devBackup.fileName),
    'ไม่พบไฟล์สำรอง',
    'ฝั่งจริงไม่ควรลบไฟล์ของ dev ได้'
  )
  assert(fs.existsSync(devBackup.path), 'ไฟล์ของ dev หายไปทั้งที่ลบจากฝั่งจริง')
})

group('สำรองสองครั้งในวินาทีเดียวกัน ต้องไม่ทับกัน')

const sameSecondDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dormy-backups-samesec-'))
const fixedNow = new Date(2026, 0, 15, 10, 20, 30)

const earlier = await backups.createBackup(db, sameSecondDir, { label: 'ใบแรก', now: fixedNow })
const later = await backups.createBackup(db, sameSecondDir, { label: 'ใบสอง', now: fixedNow })

check('ใบแรกใช้ชื่อปกติ ใบที่สองได้เลขต่อท้าย', () => {
  assert(earlier.fileName === 'dormy-2026-01-15_102030.sqlite', `ใบแรก ${earlier.fileName}`)
  assert(later.fileName === 'dormy-2026-01-15_102030-2.sqlite', `ใบสอง ${later.fileName}`)
})

check('ทั้งสองใบยังอยู่ และป้ายกำกับไม่สลับกัน', () => {
  const list = backups.listBackups(sameSecondDir)
  assert(list.length === 2, `ควรมี 2 ใบ ได้ ${list.length}`)
  const byName = Object.fromEntries(list.map((b) => [b.fileName, b.label]))
  assert(byName[earlier.fileName] === 'ใบแรก', `ป้ายใบแรก ${byName[earlier.fileName]}`)
  assert(byName[later.fileName] === 'ใบสอง', `ป้ายใบสอง ${byName[later.fileName]}`)
})

const rapidNow = new Date(2026, 0, 15, 10, 20, 31)
const rapid = await Promise.all(
  [1, 2, 3].map((n) => backups.createBackup(db, sameSecondDir, { label: `รัว ${n}`, now: rapidNow }))
)

check('สร้างพร้อมกันสามคำขอ ได้สามไฟล์คนละชื่อ ใช้กู้คืนได้ทุกใบ', () => {
  const names = new Set(rapid.map((b) => b.fileName))
  assert(names.size === 3, `ได้ชื่อไม่ซ้ำแค่ ${names.size} ชื่อ: ${[...names].join(', ')}`)
  assert(backups.listBackups(sameSecondDir).length === 5, 'รวมทั้งโฟลเดอร์ควรมี 5 ใบ')
  for (const b of rapid) {
    const info = backups.inspectBackup(b.path)
    assert(info.apartments > 0, `${b.fileName} ไม่มีข้อมูลหอ`)
  }
})

fs.rmSync(sameSecondDir, { recursive: true, force: true })

group('กันชื่อไฟล์ที่หลุดออกนอกโฟลเดอร์สำรอง')

const live = path.join(userData, 'live.sqlite')
fs.writeFileSync(live, 'ข้อมูลจริง')
const guarded = await backups.createBackup(db, userData, { label: 'ทดสอบชื่อไฟล์' })

check('ลบด้วยชื่อ ../ ไม่ได้ และไฟล์ข้างนอกยังอยู่', () => {
  throws(() => backups.deleteBackup(userData, '../live.sqlite'), 'ชื่อไฟล์สำรองไม่ถูกต้อง', 'ควรปฏิเสธ')
  assert(fs.existsSync(live), 'ไฟล์ข้างนอกโฟลเดอร์สำรองถูกลบไปแล้ว')
})

check('ลบด้วย path เต็ม หรือ \\ ของ Windows ไม่ได้', () => {
  throws(() => backups.deleteBackup(userData, live), 'ชื่อไฟล์สำรองไม่ถูกต้อง', 'path เต็มต้องถูกปฏิเสธ')
  throws(() => backups.deleteBackup(userData, '..\\live.sqlite'), 'ชื่อไฟล์สำรองไม่ถูกต้อง', '..\\ ต้องถูกปฏิเสธ')
  assert(fs.existsSync(live), 'ไฟล์ข้างนอกโฟลเดอร์สำรองถูกลบไปแล้ว')
})

check('กู้คืนจากไฟล์นอกโฟลเดอร์สำรองไม่ได้', () => {
  throws(() => backups.prepareRestore(userData, '../live.sqlite'), 'ชื่อไฟล์สำรองไม่ถูกต้อง', 'ควรปฏิเสธ')
})

check('ไฟล์ที่ไม่ใช่ .sqlite ลบไม่ได้ แม้อยู่ในโฟลเดอร์สำรอง', () => {
  throws(() => backups.deleteBackup(userData, `${guarded.fileName}.txt`), 'ชื่อไฟล์สำรองไม่ถูกต้อง', 'ควรปฏิเสธ')
})

check('ชื่อไฟล์ที่ผู้ใช้ตั้งเอง (ไม่ใช่รูปแบบของระบบ) ยังลบได้ตามปกติ', () => {
  const dir = backups.resolveBackupDir(userData)
  fs.copyFileSync(path.join(dir, guarded.fileName), path.join(dir, 'จาก USB.sqlite'))
  backups.deleteBackup(userData, 'จาก USB.sqlite')
  assert(!fs.existsSync(path.join(dir, 'จาก USB.sqlite')), 'ควรลบได้')
})

group('ส่งออกไป USB และนำเข้ากลับมา')

const usb = fs.mkdtempSync(path.join(os.tmpdir(), 'dormy-usb-'))
const toExport = await backups.createBackup(db, userData, { label: 'ส่งออกไป USB' })

check('ส่งออกได้ไฟล์เดียวกันทุกไบต์ พร้อมป้ายกำกับ', () => {
  const dir = backups.resolveBackupDir(userData)
  const out = backups.exportBackup(userData, toExport.fileName, path.join(usb, 'หอ-กันยา'))
  assert(out.filePath.endsWith('.sqlite'), 'ควรเติม .sqlite ให้')
  assert(
    fs.readFileSync(out.filePath).equals(fs.readFileSync(path.join(dir, toExport.fileName))),
    'ไฟล์ที่ส่งออกไม่ตรงกับต้นฉบับ'
  )
  assert(fs.readFileSync(`${out.filePath}.txt`, 'utf-8') === 'ส่งออกไป USB', 'ป้ายกำกับไม่ติดไปด้วย')
})

check('ส่งออกด้วยชื่อที่หลุดนอกโฟลเดอร์สำรองไม่ได้', () => {
  throws(
    () => backups.exportBackup(userData, '../live.sqlite', path.join(usb, 'x.sqlite')),
    'ชื่อไฟล์สำรองไม่ถูกต้อง',
    'ควรปฏิเสธ'
  )
})

check('นำเข้าจาก USB แล้วขึ้นในรายการ กู้คืนได้', () => {
  const imported = backups.importBackup(userData, path.join(usb, 'หอ-กันยา.sqlite'))
  assert(imported.fileName === 'นำเข้า-หอ-กันยา.sqlite', imported.fileName)
  assert(imported.label === 'ส่งออกไป USB', `ป้ายกำกับ: ${imported.label}`)
  assert(backups.listBackups(userData).some((b) => b.fileName === imported.fileName), 'ไม่อยู่ในรายการ')
  const { info } = backups.prepareRestore(userData, imported.fileName)
  assert(info.apartments >= 0, 'ควรตรวจไฟล์ผ่าน')
})

check('นำเข้าไฟล์ชื่อเดิมซ้ำ ได้ชื่อใหม่ ไม่ทับของเดิม', () => {
  const again = backups.importBackup(userData, path.join(usb, 'หอ-กันยา.sqlite'))
  assert(again.fileName === 'นำเข้า-หอ-กันยา-2.sqlite', again.fileName)
})

check('นำเข้าไฟล์ SQLite ที่ไม่ใช่ของโปรแกรมนี้ไม่ได้ และไม่ทิ้งไฟล์ค้าง', () => {
  const before = backups.listBackups(userData).length
  throws(() => backups.importBackup(userData, stranger), 'ไม่ใช่ไฟล์สำรองของ Dormy Manager', 'ควรกัน')
  assert(backups.listBackups(userData).length === before, 'มีไฟล์ค้างในรายการ')
})

check('นำเข้าไฟล์ที่อยู่ในโฟลเดอร์สำรองอยู่แล้วไม่ได้', () => {
  const dir = backups.resolveBackupDir(userData)
  throws(
    () => backups.importBackup(userData, path.join(dir, toExport.fileName)),
    'อยู่ในรายการสำรองอยู่แล้ว',
    'ควรกัน'
  )
})

fs.rmSync(usb, { recursive: true, force: true })

cleanup()
fs.rmSync(userData, { recursive: true, force: true })
summarize('การสำรอง/กู้คืนข้อมูลทำงานครบทุกเส้นทาง')
