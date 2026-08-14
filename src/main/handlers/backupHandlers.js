// IPC ของการสำรอง/กู้คืนข้อมูล
//
// ตัวจัดการนี้ต่างจากตัวอื่นตรงที่แตะไฟล์และวงจรชีวิตของแอปโดยตรง (ปิดฐานข้อมูล ทับไฟล์
// รีสตาร์ต) จึงเป็นที่เดียวที่ import electron ส่วนตรรกะล้วนๆ อยู่ที่ db/backups.js
import fs from 'node:fs'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { closeDatabase, getDatabase, resolveDbPath, resolveMigrationsDir } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { clearSession, requireOwnerUserId } from './authHandlers.js'
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

  // เจ้าของหอเท่านั้น — ไฟล์สำรองคือสำเนาข้อมูลทั้งหอที่ลากออกจากเครื่องไปได้
  // (เดิมเปิดให้พนักงานสร้างได้ด้วยเหตุผลว่า "ยิ่งมีสำเนายิ่งดี" แต่เมนูตั้งค่าทั้งเมนู
  //  เป็นของเจ้าของแล้ว — ผู้ใช้ตัดสินใจ 2026-08-14)
  handle('backup:create', async ({ label }) => {
    requireOwnerUserId()
    const backup = await createBackup(getDatabase(), userData(), { label })
    logInfo(`สร้างไฟล์สำรอง ${backup.fileName} (${backup.sizeBytes} ไบต์)`)
    return backup
  })

  // **เจ้าของหอเท่านั้น** — ไฟล์สำรองคือตาข่ายรองสุดท้ายของทั้งระบบ
  // (สร้างไฟล์สำรองพนักงานทำได้ตามปกติ ยิ่งมีสำเนายิ่งดี)
  handle('backup:delete', ({ fileName }) => {
    requireOwnerUserId()
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
  // *** ไม่รีสตาร์ตแอป ***
  // เคยทำด้วย app.relaunch() + app.exit(0) แล้วพังตอน dev: การ exit ฆ่าโปรเซสแม่ของ
  // electron-vite ไปด้วย เซิร์ฟเวอร์ vite ที่พอร์ต 5173 จึงดับ แอปที่รีสตาร์ตขึ้นมาโหลด
  // หน้าจอไม่ได้ (ERR_CONNECTION_REFUSED) เหลือแต่จอขาว
  //
  // การรีสตาร์ตไม่จำเป็นตั้งแต่แรก — ที่ต้องทำจริงๆ มีแค่ปิดฐานข้อมูลเพื่อให้ทับไฟล์ได้
  // แล้วเปิดใหม่ ส่วนหน้าจอสั่ง reload เอาก็พอ วิธีนี้ทำงานเหมือนกันทั้ง dev และตอนแพ็กแล้ว
  //
  // ลำดับสำคัญมาก:
  //   1) ตรวจว่าไฟล์สำรองใช้ได้จริงก่อน — ถ้าเสียแล้วเราไปทับของจริงไปแล้วคือจบ
  //   2) สำรองของปัจจุบันไว้ก่อนทับ เผื่อกู้ผิดไฟล์จะได้ยังมีทางกลับ
  //   3) ปิดฐานข้อมูล แล้วค่อยทับไฟล์ (Windows ล็อกไฟล์ที่เปิดอยู่ ทับไม่ได้)
  //   4) เปิดฐานข้อมูลใหม่ — migrations จะวิ่งอีกรอบ ไฟล์สำรองจากแอปเวอร์ชันเก่าจึงถูก
  //      อัปเกรดให้เองโดยอัตโนมัติ
  //   5) ล้างเซสชัน + reload หน้าจอ
  //   **เจ้าของหอเท่านั้น** — ทับข้อมูลปัจจุบันทั้งฐาน
  handle('backup:restore', async ({ fileName }) => {
    requireOwnerUserId()
    // ส่ง migrationsDir เข้าไปด้วยเพื่อให้ตรวจได้ว่าไฟล์นี้มาจากแอปรุ่นใหม่กว่าหรือเปล่า
    const { source, info } = prepareRestore(userData(), fileName, resolveMigrationsDir())

    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['ยกเลิก', 'กู้คืนข้อมูล'],
      defaultId: 0,
      cancelId: 0,
      title: 'ยืนยันการกู้คืนข้อมูล',
      message: `กู้คืนจากไฟล์ ${fileName}?`,
      detail:
        `ไฟล์นี้มีข้อมูลหอพัก ${info.apartments} หอ\n\n` +
        'ข้อมูลปัจจุบันทั้งหมดจะถูกแทนที่ ระบบจะสำรองข้อมูลปัจจุบันไว้ให้ก่อนอัตโนมัติ ' +
        'แล้วให้เข้าสู่ระบบใหม่'
    })
    if (response !== 1) return { cancelled: true }

    const safety = await createBackup(getDatabase(), userData(), {
      label: `สำรองอัตโนมัติก่อนกู้คืนจาก ${fileName}`
    })
    logInfo(`สำรองก่อนกู้คืนไว้ที่ ${safety.fileName}`)

    const target = resolveDbPath()
    closeDatabase()

    fs.copyFileSync(source, target)
    // ไฟล์ WAL/SHM ของฐานข้อมูลเดิมต้องหายไปด้วย ไม่งั้น SQLite จะเอา WAL เก่ามาเล่นทับ
    // ไฟล์ใหม่แล้วข้อมูลปนกัน
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(target + suffix)) fs.rmSync(target + suffix)
    }

    // เปิดไฟล์ใหม่ทันทีตรงนี้ ไม่รอให้ handler ตัวถัดไปเป็นคนเปิด — จะได้รู้เดี๋ยวนี้เลย
    // ถ้าไฟล์ที่กู้มาเปิดไม่ขึ้น แทนที่จะไปพังกลางทางตอนผู้ใช้กดอย่างอื่น
    getDatabase()

    // ไฟล์ที่กู้มาอาจมีชุดผู้ใช้คนละชุด — บังคับเข้าสู่ระบบใหม่เสมอ
    clearSession()
    logInfo(`กู้คืนข้อมูลจาก ${fileName} เรียบร้อย`)

    // reload หน้าจอเพื่อให้ทุกหน้าดึงข้อมูลจากไฟล์ใหม่ และเด้งกลับไปหน้าเข้าสู่ระบบ
    for (const win of BrowserWindow.getAllWindows()) win.webContents.reload()

    return { ok: true, apartments: info.apartments }
  })
}
