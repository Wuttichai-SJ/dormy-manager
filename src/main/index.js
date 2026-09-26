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

// ตาข่ายชั้นสุดท้าย: อะไรที่หลุดจาก try/catch ทั้งหมดต้องถูกบันทึกไว้ ไม่ใช่หายเงียบ
process.on('uncaughtException', (err) => logError('uncaughtException', err))
process.on('unhandledRejection', (err) => logError('unhandledRejection', err))

// ต้องถือ reference ระดับโมดูลไว้ ห้ามเก็บไว้ในตัวแปร local อย่างเดียว
// ไม่งั้น JS garbage-collect ออบเจกต์หน้าต่างทิ้งได้ → หน้าต่างถูกทำลาย →
// window-all-closed → app.quit() แบบไม่มี error อะไรเลย และเพราะ GC ไม่แน่นอน
// อาการจะเป็นแบบ "บางทีเปิดติด บางทีไม่ขึ้นเลย" ซึ่งหลอกมากเวลาไล่บั๊ก
let mainWindow = null

// เมนูของแอปที่ติดตั้งแล้ว — ตัด View > Toggle Developer Tools ออก
//
// ทำไม: เมนูมาตรฐานที่ Electron ใส่มาให้เองมี View > Toggle Developer Tools ติดมาด้วย
// (และคีย์ลัด Ctrl+Shift+I / F12) คนที่เดินมาที่เครื่องตอนแอปค้างอยู่หน้าเข้าสู่ระบบจึงเปิด
// DevTools แล้วยิง window.electron.invoke(...) ตรงเข้า IPC ได้โดยไม่ต้องรู้รหัสผ่าน
// การ์ด requireSessionUserId ในชั้น handler กันข้อมูลไว้แล้ว แต่ไม่มีเหตุผลที่จะแจกเครื่องมือ
// ให้เขาเริ่มงมหาช่องโหว่ตั้งแต่แรก — สองชั้นนี้เสริมกัน ไม่ใช่ชั้นใดชั้นหนึ่งพอ
//
// 🔴 **ทำเฉพาะตอน app.isPackaged เท่านั้น** ตอน npm run dev ต้องมี DevTools ครบเหมือนเดิม
// เพราะเป็นเครื่องมือหลักในการไล่ปัญหาฝั่งหน้าจอ
//
// 🔴 **ไม่ setApplicationMenu(null)** ถึงแม้จะดูสะอาดกว่า — บน Windows คีย์ลัดแก้ไขข้อความ
// (Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+A / Ctrl+Z) ผูกอยู่กับ role ของเมนู ถ้าลบเมนูทิ้งทั้งอัน
// เสี่ยงที่ช่องกรอกทั้งแอปจะคัดลอก/วางไม่ได้ ซึ่งแย่กว่าปัญหาที่กำลังแก้อยู่มาก
// จึงเหลือเมนู "แก้ไข" ที่มีแต่ role ไว้ แล้วซ่อนแถบเมนูด้วย autoHideMenuBar ในหน้าต่างแทน
// (ซ่อนแล้วคีย์ลัดยังทำงานตามปกติ กด Alt ถึงจะเห็นแถบ และเห็นแค่เมนูแก้ไข ไม่มี DevTools)
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

// ปลายทางยังเป็นหน้าของแอปเองไหม — dev เทียบ origin (http://localhost:xxxx)
// ตอนแพ็กเป็น file:// เทียบ path ของไฟล์ (origin ของ file:// เป็น "null" เทียบกันไม่ได้)
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
    // ซ่อนแถบเมนูตอนแพ็กแล้ว (กด Alt ถึงจะโผล่ และมีแค่เมนู "แก้ไข" — ดู applyPackagedMenu)
    // ตอน dev ปล่อยให้เห็นแถบเมนูมาตรฐานเหมือนเดิม จะได้กด View > Toggle Developer Tools ได้
    autoHideMenuBar: app.isPackaged,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 🔴 **ปิด DevTools ที่ต้นทางตอนแพ็กแล้ว** — การตัดรายการออกจากเมนู (applyPackagedMenu)
      // ปิดแค่ "ทางที่คนกดเจอ" คือรายการเมนูกับคีย์ลัดที่ผูกกับรายการนั้น แต่ไม่ได้ปิดตัว
      // DevTools เอง ถ้าวันหนึ่งมีโค้ดเรียก webContents.openDevTools() (เช่นใส่ไว้ตอนไล่บั๊ก
      // แล้วลืมถอด) หน้าต่างนักพัฒนาก็เปิดได้อยู่ดี ธงนี้ทำให้เรียกยังไงก็ไม่เปิด
      //
      // สองชั้นนี้ทำคนละหน้าที่ ไม่ใช่ของซ้ำกัน: ธงนี้ปิดความสามารถ ส่วนเมนูทำให้ไม่มีปุ่ม
      // ให้คนเห็นตั้งแต่แรก (และทำให้คีย์ลัดไม่ถูกลงทะเบียน)
      //
      // ตอน npm run dev ต้องเป็น true เสมอ ไม่งั้นไล่ปัญหาฝั่งหน้าจอไม่ได้เลย
      devTools: !app.isPackaged,
      // เปิดตัวอ่าน PDF ในตัวของ Chromium — ใช้แสดงตัวอย่างใบแจ้งหนี้ก่อนพิมพ์
      // (Electron ปิดไว้เป็นค่าเริ่มต้น ถ้าไม่เปิด <iframe> ที่ชี้ไปไฟล์ PDF จะกลายเป็น
      // การดาวน์โหลดแทนการแสดงผล) ไม่ได้เปิดปลั๊กอินจากภายนอก ตัวอ่านนี้มากับ Chromium เอง
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

  // หน้าต่างถูกสร้างแบบซ่อนไว้ก่อน (show: false) เพื่อไม่ให้เห็นจอขาววาบตอนเปิด
  // แต่ถ้า ready-to-show ไม่ยิง (renderer โหลดไม่สำเร็จ) หน้าต่างจะซ่อนตลอดกาล =
  // แอปรันอยู่แต่ผู้ใช้ไม่เห็นอะไรเลยและไม่มี error ที่ไหน — กันด้วย fallback timer
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

  // 🔴 หน้าต่างนี้มี preload ที่เข้าถึงฐานข้อมูลได้ — ห้ามโหลดหน้าเว็บอื่นเข้ามาแทนที่
  // และห้ามเปิดหน้าต่างใหม่ (เจอจากรีวิวโค้ด 2026-09-26) แอปไม่มีลิงก์ออกข้างนอกเลย
  // จึงปฏิเสธทั้งหมด · การย้อนกลับไปหน้าเดิมของแอป (เช่น Vite รีโหลดตอน dev) ยังได้ตามปกติ
  win.webContents.setWindowOpenHandler(({ url }) => {
    logError(`บล็อกการเปิดหน้าต่างใหม่: ${url}`)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url, win.webContents.getURL())) return
    event.preventDefault()
    logError(`บล็อกการเปลี่ยนหน้าไปที่: ${url}`)
  })

  // electron-vite sets ELECTRON_RENDERER_URL in dev; load the built file in production.
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  logInfo(`แอปเริ่มทำงาน — electron ${process.versions.electron}, log ที่ ${getLogPath()}`)

  // ฐานข้อมูลเปิดไม่ได้ = ทำอะไรต่อไม่ได้เลย ต้องบอกผู้ใช้ตรงๆ แล้วปิด
  // ห้ามปล่อยให้ throw ลอยเป็น unhandled rejection แล้วเปิดหน้าต่างต่อเหมือนไม่มีอะไรเกิดขึ้น
  // (ผู้ใช้จริงคือเจ้าของหอ ไม่มีใครนั่งดู console ให้)
  try {
    getDatabase() // opens DB + runs migrations before anything else touches it
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

  // Skeleton IPC handler — proves the main<->renderer bridge works.
  ipcMain.handle('app:ping', () => ({ success: true, data: 'pong' }))

  // ต้องลงทะเบียนให้ครบ "ก่อน" สร้างหน้าต่าง ไม่งั้นหน้าจอที่โหลดเร็วกว่าจะยิง
  // auth:status ไปหาช่องที่ยังไม่มีใครรับ แล้วได้ error "No handler registered"
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

  // ต้องตั้งก่อนสร้างหน้าต่าง — หน้าต่างจะหยิบเมนูของแอปไปใช้ตอนถูกสร้าง
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
