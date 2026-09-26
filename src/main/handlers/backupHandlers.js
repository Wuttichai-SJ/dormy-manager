import fs from 'node:fs'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { closeDatabase, getDatabase, resolveDbPath, resolveMigrationsDir } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { clearSession, requireOwnerUserId, requireSessionUserId } from './authHandlers.js'
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
      return { success: false, error: err.message, fields: err.fields }
    }
  })
}

function handleSession(channel, fn) {
  handle(channel, (payload) => {
    requireSessionUserId()
    return fn(payload)
  })
}

const userData = () => app.getPath('userData')

// โมดูลใน db/ ห้ามรู้จัก electron — ชั้นนี้บอกว่า dev หรือไม่
const backupOpts = () => ({ isDev: !app.isPackaged })

export function registerBackupHandlers() {
  handleSession('backup:list', () => ({
    directory: resolveBackupDir(userData(), backupOpts()),
    backups: listBackups(userData(), backupOpts())
  }))

  // เฉพาะเจ้าของหอ
  handle('backup:create', async ({ label }) => {
    requireOwnerUserId()
    const backup = await createBackup(getDatabase(), userData(), { label, ...backupOpts() })
    logInfo(`สร้างไฟล์สำรอง ${backup.fileName} (${backup.sizeBytes} ไบต์)`)
    return backup
  })

  // เฉพาะเจ้าของหอ
  handle('backup:delete', ({ fileName }) => {
    requireOwnerUserId()
    const result = deleteBackup(userData(), fileName, backupOpts())
    logInfo(`ลบไฟล์สำรอง ${fileName}`)
    return result
  })

  handleSession('backup:reveal', () => {
    const dir = resolveBackupDir(userData(), backupOpts())
    fs.mkdirSync(dir, { recursive: true })
    shell.openPath(dir)
    return { ok: true }
  })

  // ไม่รีสตาร์ตแอป (ทำให้ vite ตอน dev ดับ) · ลำดับ: ตรวจไฟล์ → สำรองของเดิม → ปิด DB → ทับ → เปิดใหม่ → reload
  handle('backup:restore', async ({ fileName }) => {
    requireOwnerUserId()
    const { source, info } = prepareRestore(
      userData(),
      fileName,
      resolveMigrationsDir(),
      backupOpts()
    )

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
      label: `สำรองอัตโนมัติก่อนกู้คืนจาก ${fileName}`,
      ...backupOpts()
    })
    logInfo(`สำรองก่อนกู้คืนไว้ที่ ${safety.fileName}`)

    const target = resolveDbPath()
    closeDatabase()

    fs.copyFileSync(source, target)
    // ลบ WAL/SHM เดิมด้วย ไม่งั้น SQLite เล่น WAL เก่าทับไฟล์ใหม่
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(target + suffix)) fs.rmSync(target + suffix)
    }

    getDatabase()

    // ไฟล์ที่กู้มาอาจมีผู้ใช้คนละชุด — ต้องเข้าสู่ระบบใหม่
    clearSession()
    logInfo(`กู้คืนข้อมูลจาก ${fileName} เรียบร้อย`)

    for (const win of BrowserWindow.getAllWindows()) win.webContents.reload()

    return { ok: true, apartments: info.apartments }
  })
}
