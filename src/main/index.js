import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import { getDatabase } from './database.js'
import { logInfo, logError, getLogPath } from './logger.js'
import { registerAuthHandlers } from './handlers/authHandlers.js'

// ตาข่ายชั้นสุดท้าย: อะไรที่หลุดจาก try/catch ทั้งหมดต้องถูกบันทึกไว้ ไม่ใช่หายเงียบ
process.on('uncaughtException', (err) => logError('uncaughtException', err))
process.on('unhandledRejection', (err) => logError('unhandledRejection', err))

// ต้องถือ reference ระดับโมดูลไว้ ห้ามเก็บไว้ในตัวแปร local อย่างเดียว
// ไม่งั้น JS garbage-collect ออบเจกต์หน้าต่างทิ้งได้ → หน้าต่างถูกทำลาย →
// window-all-closed → app.quit() แบบไม่มี error อะไรเลย และเพราะ GC ไม่แน่นอน
// อาการจะเป็นแบบ "บางทีเปิดติด บางทีไม่ขึ้นเลย" ซึ่งหลอกมากเวลาไล่บั๊ก
let mainWindow = null

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
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
  logInfo('ลงทะเบียน IPC ของระบบเข้าสู่ระบบแล้ว')

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
