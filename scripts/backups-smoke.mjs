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
group('กันไฟล์จากแอปรุ่นใหม่กว่า')

check('ไฟล์ที่มี migration ที่แอปรุ่นนี้ไม่รู้จัก กู้คืนไม่ได้', () => {
  const list = backups.listBackups(userData)
  // จำลองว่าแอปรุ่นนี้รู้จัก migration น้อยกว่าที่อยู่ในไฟล์สำรอง
  // (= ไฟล์มาจากแอปรุ่นใหม่กว่า) โดยส่งรายการที่รู้จักไปแค่ไฟล์เดียว
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

// แอปรุ่นใหม่กว่ากู้ไฟล์เก่าได้ตามปกติ — migrations ที่ขาดจะถูกรันตอนเปิดไฟล์
check('ไฟล์เก่ากว่า (migration น้อยกว่า) กู้คืนได้', () => {
  const list = backups.listBackups(userData)
  const known = [...backups.listKnownMigrations('src/main/migrations'), '999_ของอนาคต.sql']
  const info = backups.inspectBackup(list[0].path, known)
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
// แยกสำเนาของตอนพัฒนาออกจากของจริง
// -----------------------------------------------------
// เครื่องเดียวเป็นทั้งเครื่องพัฒนาและเครื่องที่รันแอปจริง ถ้าสองโหมดเก็บสำเนาไว้โฟลเดอร์
// เดียวกัน ไฟล์จะหน้าตาเหมือนกันทุกประการ (ชื่อเป็นวันเวลาล้วน) แล้ววันหนึ่งจะมีคน
// กดกู้คืนผิดใบ ทับข้อมูลหอจริงด้วยข้อมูลทดสอบ — ต้องมองไม่เห็นกันเลยถึงจะปลอดภัย
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

// ล้างรายการฝั่งจริงให้ว่างก่อน เพื่อให้ข้อถัดไปชี้ชัดว่าไฟล์ที่เห็น/ไม่เห็น มาจากโฟลเดอร์ไหน
// (ถ้าไม่ล้าง ชื่อไฟล์ที่เป็นวันเวลาระดับวินาทีอาจไปตรงกับใบที่ค้างอยู่ฝั่งจริงพอดี)
for (const b of backups.listBackups(userData)) backups.deleteBackup(userData, b.fileName)

const devBackup = await backups.createBackup(db, userData, { label: 'ของ dev', isDev: true })

// เทียบด้วย path เต็ม ไม่ใช่ fileName — ชื่อไฟล์เป็นวันเวลาระดับวินาที สำเนาสองใบที่สร้าง
// ในวินาทีเดียวกันจึงชื่อซ้ำกันได้ ต่างกันแค่โฟลเดอร์ ซึ่งคือสิ่งที่ข้อนี้กำลังทดสอบพอดี
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

// -----------------------------------------------------
// สำรองสองครั้งในวินาทีเดียวกัน
// -----------------------------------------------------
// ชื่อไฟล์ละเอียดแค่ระดับวินาที เดิมใบที่สองจะเขียนทับใบแรกเงียบๆ ไม่มีคำเตือน
// จุดที่เกิดได้จริงคือตอนกู้คืน: ระบบสร้าง "สำรองอัตโนมัติก่อนกู้คืน" เอง ถ้าตรงกับวินาที
// ที่ผู้ใช้เพิ่งกดสร้างสำรอง ใบของผู้ใช้จะหายไป — หรือกดปุ่มสร้างสองครั้งติดกัน
group('สำรองสองครั้งในวินาทีเดียวกัน ต้องไม่ทับกัน')

// ใช้โฟลเดอร์ใหม่ และส่งเวลาตายตัวเข้าไป ไม่พึ่งว่าเครื่องจะเร็วพอให้ตรงวินาทีเดียวกันเอง
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

// กดสร้างรัวๆ: ทุกคำขอเริ่มก่อนใบไหนเขียนเสร็จ — การเช็ก "มีไฟล์ชื่อนี้หรือยัง" ธรรมดา
// ไม่พอ เพราะ db.backup() เป็น async ทุกคำขอจะเห็นว่ายังว่างแล้วเลือกชื่อเดียวกันหมด
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

// -----------------------------------------------------
cleanup()
fs.rmSync(userData, { recursive: true, force: true })
summarize('การสำรอง/กู้คืนข้อมูลทำงานครบทุกเส้นทาง')
