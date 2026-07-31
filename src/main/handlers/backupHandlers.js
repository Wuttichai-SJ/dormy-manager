// IPC ของการสำรอง/กู้คืนข้อมูล
//
// ตัวจัดการนี้ต่างจากตัวอื่นตรงที่แตะไฟล์และวงจรชีวิตของแอปโดยตรง (ปิดฐานข้อมูล ทับไฟล์
// รีสตาร์ต) จึงเป็นที่เดียวที่ import electron ส่วนตรรกะล้วนๆ อยู่ที่ db/backups.js
import fs from 'node:fs'
import { app, dialog, ipcMain, shell } from 'electron'
import { getDatabase, resolveDbPath } from '../database.js'
import { logError, logInfo } from '../logger.js'
import {
  createBackup,
  deleteBackup,
  inspectBackup,
  listBackups,
  prepareRestore,
  resolveBackupDir
} from '../db/backups.js'

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { success: true, data: await fn(payload ?? {}) }
    } catch (err) {
      logError(`${channel} ล้มเหลว`, err)
      return { success: false, error: err.message }
    }
  })
}

const userData = () => app.getPath('userData')

export function registerBackupHandlers() {
  handle('backup:list', () => ({
    directory: resolveBackupDir(userData()),
    backups: listBackups(userData())
  }))

  handle('backup:create', async ({ label }) => {
    const backup = await createBackup(getDatabase(), userData(), { label })
    logInfo(`สร้างไฟล์สำรอง ${backup.fileName} (${backup.sizeBytes} ไบต์)`)
    return backup
  })

  handle('backup:delete', ({ fileName }) => {
    const result = deleteBackup(userData(), fileName)
    logInfo(`ลบไฟล์สำรอง ${fileName}`)
    return result
  })

  // เปิดโฟลเดอร์สำรองใน File Explorer — ผู้ใช้จะได้คัดลอกไปไดรฟ์อื่น/USB เองได้
  // สำเนาที่อยู่ดิสก์เดียวกับต้นฉบับไม่รอดถ้าดิสก์พัง จึงต้องชวนให้เอาออกไปข้างนอก
  handle('backup:reveal', () => {
    const dir = resolveBackupDir(userData())
    fs.mkdirSync(dir, { recursive: true })
    shell.openPath(dir)
    return { ok: true }
  })

  // กู้คืน = เรื่องที่ย้อนกลับไม่ได้ ต้องถามยืนยันด้วยกล่องของระบบก่อนเสมอ
  //
  // ลำดับสำคัญมาก:
  //   1) ตรวจว่าไฟล์สำรองใช้ได้จริงก่อน — ถ้าเสียแล้วเราไปทับของจริงไปแล้วคือจบ
  //   2) สำรองของปัจจุบันไว้ก่อนทับ เผื่อกู้ผิดไฟล์จะได้ยังมีทางกลับ
  //   3) ปิดฐานข้อมูล แล้วค่อยทับไฟล์ (Windows ล็อกไฟล์ที่เปิดอยู่ ทับไม่ได้)
  //   4) รีสตาร์ตแอป — ทั้งแอปถือ instance ฐานข้อมูลตัวเดียวไว้ในหน่วยความจำ
  //      การเปิดใหม่ระหว่างทางจะทำให้หน้าจอที่เปิดค้างอยู่ถือข้อมูลเก่าปนใหม่
  handle('backup:restore', async ({ fileName }) => {
    const { source, info } = prepareRestore(userData(), fileName)

    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['ยกเลิก', 'กู้คืนและรีสตาร์ต'],
      defaultId: 0,
      cancelId: 0,
      title: 'ยืนยันการกู้คืนข้อมูล',
      message: `กู้คืนจากไฟล์ ${fileName}?`,
      detail:
        `ไฟล์นี้มีข้อมูลหอพัก ${info.apartments} หอ\n\n` +
        'ข้อมูลปัจจุบันทั้งหมดจะถูกแทนที่ ระบบจะสำรองข้อมูลปัจจุบันไว้ให้ก่อนอัตโนมัติ ' +
        'แล้วปิดและเปิดโปรแกรมใหม่'
    })
    if (response !== 1) return { cancelled: true }

    const safety = await createBackup(getDatabase(), userData(), {
      label: `สำรองอัตโนมัติก่อนกู้คืนจาก ${fileName}`
    })
    logInfo(`สำรองก่อนกู้คืนไว้ที่ ${safety.fileName}`)

    const target = resolveDbPath()
    getDatabase().close()

    fs.copyFileSync(source, target)
    // ไฟล์ WAL/SHM ของฐานข้อมูลเดิมต้องหายไปด้วย ไม่งั้น SQLite จะเอา WAL เก่ามาเล่นทับ
    // ไฟล์ใหม่แล้วข้อมูลปนกัน
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(target + suffix)) fs.rmSync(target + suffix)
    }

    logInfo(`กู้คืนข้อมูลจาก ${fileName} แล้ว กำลังรีสตาร์ต`)
    app.relaunch()
    app.exit(0)
    return { restarting: true }
  })
}
