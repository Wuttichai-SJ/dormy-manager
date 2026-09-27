import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { closeDatabase, getDatabase, resolveDbPath, resolveMigrationsDir } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { clearSession, requireOwnerUserId, requireSessionUserId } from './authHandlers.js'
import {
  assertFreshDatabase,
  createBackup,
  deleteBackup,
  exportBackup,
  importBackup,
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

// ปิด DB → ทับไฟล์ → ลบ WAL/SHM เดิม (ไม่งั้น SQLite เล่น WAL เก่าทับ) → เปิดใหม่ (รัน migration)
function replaceDatabase(source) {
  const target = resolveDbPath()
  closeDatabase()
  fs.copyFileSync(source, target)
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(target + suffix)) fs.rmSync(target + suffix)
  }
  getDatabase()
}

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

  // เฉพาะเจ้าของหอ — ไฟล์สำรองคือข้อมูลทั้งหอที่ออกจากเครื่องไปได้
  handle('backup:export', async ({ fileName }) => {
    requireOwnerUserId()
    const win = BrowserWindow.getFocusedWindow()
    const options = {
      title: 'ส่งออกไฟล์สำรอง',
      defaultPath: path.join(app.getPath('documents'), String(fileName ?? 'ไฟล์สำรอง.sqlite')),
      filters: [{ name: 'ไฟล์สำรอง Dormy Manager', extensions: ['sqlite'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { cancelled: true }

    const exported = exportBackup(userData(), fileName, result.filePath, backupOpts())
    logInfo(`ส่งออกไฟล์สำรอง ${fileName} ไปที่ ${exported.filePath}`)
    return exported
  })

  // เฉพาะเจ้าของหอ
  handle('backup:import', async () => {
    requireOwnerUserId()
    const win = BrowserWindow.getFocusedWindow()
    const options = {
      title: 'นำเข้าไฟล์สำรอง',
      properties: ['openFile'],
      filters: [{ name: 'ไฟล์สำรอง Dormy Manager', extensions: ['sqlite'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true }

    const imported = importBackup(userData(), result.filePaths[0], resolveMigrationsDir(), backupOpts())
    logInfo(`นำเข้าไฟล์สำรอง ${result.filePaths[0]} เป็น ${imported.fileName}`)
    return imported
  })

  // เครื่องใหม่ที่ยังไม่มีบัญชี: กู้คืนจากหน้าลงทะเบียนได้โดยไม่ต้องสร้างบัญชีชั่วคราว
  // ไม่ต้องล็อกอิน เพราะฐานข้อมูลว่าง ไม่มีอะไรให้ทับ · ไฟล์ถูกเก็บเข้ารายการสำรองด้วย
  handle('backup:restoreFirstRun', async () => {
    assertFreshDatabase(getDatabase())
    const win = BrowserWindow.getFocusedWindow()
    const options = {
      title: 'เลือกไฟล์สำรองจากเครื่องเดิม',
      properties: ['openFile'],
      filters: [{ name: 'ไฟล์สำรอง Dormy Manager', extensions: ['sqlite'] }]
    }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return { cancelled: true }

    const imported = importBackup(userData(), picked.filePaths[0], resolveMigrationsDir(), backupOpts())
    const confirm = {
      type: 'question',
      buttons: ['ยกเลิก', 'กู้คืนข้อมูล'],
      defaultId: 1,
      cancelId: 0,
      title: 'กู้คืนข้อมูลจากไฟล์สำรอง',
      message: 'กู้คืนข้อมูลจากไฟล์นี้?',
      detail:
        `ไฟล์นี้มีข้อมูลหอพัก ${imported.apartments} หอ · บัญชีผู้ใช้ ${imported.users} บัญชี\n\n` +
        'หลังกู้คืน ให้เข้าสู่ระบบด้วยบัญชีเดิมจากเครื่องเก่า'
    }
    const { response } = win ? await dialog.showMessageBox(win, confirm) : await dialog.showMessageBox(confirm)
    if (response !== 1) {
      deleteBackup(userData(), imported.fileName, backupOpts())
      return { cancelled: true }
    }

    assertFreshDatabase(getDatabase())
    replaceDatabase(imported.path)
    clearSession()
    logInfo(`กู้คืนข้อมูลครั้งแรกจาก ${picked.filePaths[0]}`)
    return { ok: true, apartments: imported.apartments, users: imported.users }
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

    replaceDatabase(source)

    // ไฟล์ที่กู้มาอาจมีผู้ใช้คนละชุด — ต้องเข้าสู่ระบบใหม่
    clearSession()
    logInfo(`กู้คืนข้อมูลจาก ${fileName} เรียบร้อย`)

    for (const win of BrowserWindow.getAllWindows()) win.webContents.reload()

    return { ok: true, apartments: info.apartments }
  })
}
