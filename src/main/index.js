import { app, BrowserWindow, Menu, ipcMain, dialog } from 'electron'
import path from 'path'
import { getDatabase } from './database.js'
import { logInfo, logError, getLogPath } from './logger.js'
import { registerAuthHandlers } from './handlers/authHandlers.js'
import { registerUserHandlers } from './handlers/userHandlers.js'
import { registerApartmentHandlers } from './handlers/apartmentHandlers.js'
import { registerApartmentServiceHandlers } from './handlers/apartmentServiceHandlers.js'
import { registerUtilityHandlers } from './handlers/utilityHandlers.js'
import { registerBankAccountHandlers } from './handlers/bankAccountHandlers.js'
import { registerRoomHandlers } from './handlers/roomHandlers.js'
import { registerTenantHandlers } from './handlers/tenantHandlers.js'
import { registerContractHandlers } from './handlers/contractHandlers.js'
import { registerBookingHandlers } from './handlers/bookingHandlers.js'
import { registerBackupHandlers } from './handlers/backupHandlers.js'
import { registerMeterHandlers } from './handlers/meterHandlers.js'
import { registerInvoiceHandlers } from './handlers/invoiceHandlers.js'
import { registerPaymentHandlers } from './handlers/paymentHandlers.js'
import { registerTerminationHandlers } from './handlers/terminationHandlers.js'
import { registerMaintenanceHandlers } from './handlers/maintenanceHandlers.js'
import { registerDashboardHandlers } from './handlers/dashboardHandlers.js'
import { registerPrintHandlers } from './handlers/printHandlers.js'
import { registerImageHandlers } from './handlers/imageHandlers.js'
import { registerExportHandlers } from './handlers/exportHandlers.js'

process.on('uncaughtException', (err) => logError('uncaughtException', err))
process.on('unhandledRejection', (err) => logError('unhandledRejection', err))

// ต้องถือ reference ระดับโมดูล ไม่งั้นหน้าต่างโดน GC แล้วแอปปิดเอง
let mainWindow = null

// ตอนแพ็ก: ตัด DevTools ออกจากเมนู แต่เก็บเมนูแก้ไขไว้ (คีย์ลัด copy/paste ผูกกับ role)
function applyPackagedMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'แก้ไข',
        submenu: [
          { role: 'undo', label: 'เลิกทำ' },
          { role: 'redo', label: 'ทำซ้ำ' },
          { type: 'separator' },
          { role: 'cut', label: 'ตัด' },
          { role: 'copy', label: 'คัดลอก' },
          { role: 'paste', label: 'วาง' },
          { role: 'delete', label: 'ลบ' },
          { type: 'separator' },
          { role: 'selectAll', label: 'เลือกทั้งหมด' }
        ]
      }
    ])
  )
}

function isAppUrl(target, current) {
  try {
    const next = new URL(target)
    const now = new URL(current)
    if (next.protocol === 'file:') return now.protocol === 'file:' && next.pathname === now.pathname
    return next.origin === now.origin
  } catch {
    return false
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: app.isPackaged,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // ปิด DevTools ตอนแพ็ก
      devTools: !app.isPackaged,
      // เปิดตัวอ่าน PDF ในตัวของ Chromium สำหรับตัวอย่างก่อนพิมพ์
      plugins: true
    }
  })

  mainWindow = win
  logInfo('สร้างหน้าต่างแล้ว')

  win.on('close', () => logInfo('ได้รับคำสั่งปิดหน้าต่าง (close)'))

  win.on('closed', () => {
    logInfo('หน้าต่างถูกปิด')
    mainWindow = null
  })

  win.webContents.on('render-process-gone', (_e, details) =>
    logError(`renderer ตาย: ${details.reason} (exitCode ${details.exitCode})`)
  )

  // กันหน้าต่างซ่อนค้างถ้า ready-to-show ไม่ยิง
  const fallbackShow = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      logError('ready-to-show ไม่ยิงใน 5 วินาที — บังคับเปิดหน้าต่างเพื่อให้เห็นว่าพังตรงไหน')
      win.show()
    }
  }, 5000)

  win.once('ready-to-show', () => {
    clearTimeout(fallbackShow)
    win.show()
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logError(`โหลดหน้าจอไม่สำเร็จ: ${errorDescription} (${errorCode}) — ${validatedURL}`)
  })

  // ห้ามเปิดหน้าต่างใหม่และห้ามไปหน้าที่ไม่ใช่ของแอป — preload เข้าถึงฐานข้อมูลได้
  win.webContents.setWindowOpenHandler(({ url }) => {
    logError(`บล็อกการเปิดหน้าต่างใหม่: ${url}`)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url, win.webContents.getURL())) return
    event.preventDefault()
    logError(`บล็อกการเปลี่ยนหน้าไปที่: ${url}`)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// เปิดได้ทีละโปรแกรม — กันสองโปรเซสเขียนฐานข้อมูลเดียวกัน · เปิดซ้ำ = ดึงหน้าต่างเดิมขึ้นมา
// เฉพาะตอนแพ็ก: lock ผูกกับโฟลเดอร์ userData ซึ่ง dev ใช้ร่วมกับตัวจริง
const isOnlyInstance = !app.isPackaged || app.requestSingleInstanceLock()
if (!isOnlyInstance) {
  logInfo('มีโปรแกรมเปิดอยู่แล้ว — ปิดตัวที่เปิดซ้ำ')
  app.quit()
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.whenReady().then(() => {
  if (!isOnlyInstance) return
  logInfo(`แอปเริ่มทำงาน — electron ${process.versions.electron}, log ที่ ${getLogPath()}`)

  try {
    getDatabase()
  } catch (err) {
    logError('เปิดฐานข้อมูลไม่สำเร็จ', err)
    dialog.showErrorBox(
      'เปิดฐานข้อมูลไม่สำเร็จ',
      `ระบบเริ่มทำงานไม่ได้เพราะเปิดฐานข้อมูลไม่สำเร็จ\n\n${err.message}\n\n` +
        'กรุณาติดต่อผู้ดูแลระบบ และอย่าลบไฟล์ฐานข้อมูลเอง'
    )
    app.quit()
    return
  }

  ipcMain.handle('app:ping', () => ({ success: true, data: 'pong' }))

  // ลงทะเบียน handler ให้ครบก่อนสร้างหน้าต่าง
  registerAuthHandlers()
  registerUserHandlers()
  registerApartmentHandlers()
  registerApartmentServiceHandlers()
  registerUtilityHandlers()
  registerBankAccountHandlers()
  registerRoomHandlers()
  registerTenantHandlers()
  registerContractHandlers()
  registerBookingHandlers()
  registerBackupHandlers()
  registerMeterHandlers()
  registerInvoiceHandlers()
  registerPaymentHandlers()
  registerTerminationHandlers()
  registerMaintenanceHandlers()
  registerDashboardHandlers()
  registerPrintHandlers()
  registerImageHandlers()
  registerExportHandlers()
  logInfo('ลงทะเบียน IPC ของระบบเข้าสู่ระบบและโมดูลหอพักแล้ว')

  if (app.isPackaged) applyPackagedMenu()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => logInfo('before-quit — มีคนสั่งให้แอปเลิกทำงาน'))

app.on('window-all-closed', () => {
  logInfo('ปิดหน้าต่างครบทุกบาน — จบการทำงาน')
  if (process.platform !== 'darwin') app.quit()
})
