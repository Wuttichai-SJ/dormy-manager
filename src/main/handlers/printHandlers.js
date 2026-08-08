// IPC ของการพิมพ์และบันทึกเป็น PDF
//
// พิมพ์จาก "หน้าจอจริง" ที่ผู้ใช้กำลังดูอยู่ ไม่ได้สร้างหน้าต่างซ่อนแล้ววาดเอกสารใหม่
// สิ่งที่เห็นบนจอจึงเป็นสิ่งที่ออกมาบนกระดาษเป๊ะๆ และมีที่เดียวที่ต้องดูแลเวลาแก้เอกสาร
//
// การซ่อนเมนู/ปุ่ม/ฟอร์มตอนพิมพ์ทำด้วย `@media print` ใน styles.css ล้วนๆ
// ทั้ง webContents.print() และ printToPDF() ใช้ CSS ชุด print เหมือนกัน จึงได้หน้าตาตรงกัน
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { logError, logInfo } from '../logger.js'

// A4 แนวตั้ง ขอบ 12 มม. — ใบแจ้งหนี้ของหอพักพิมพ์ลงกระดาษ A4 ธรรมดา
// ตัวเลขนี้ต้องตรงกับ @page ใน styles.css ไม่งั้นตัวอย่างบนจอกับไฟล์ PDF จะคนละขนาด
const PAGE = {
  pageSize: 'A4',
  margins: { marginType: 'custom', top: 0.47, bottom: 0.47, left: 0.47, right: 0.47 },
  printBackground: true,
  landscape: false
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return { success: true, data: await fn(payload ?? {}, event) }
    } catch (err) {
      logError(`${channel} ล้มเหลว`, err)
      return { success: false, error: err.message }
    }
  })
}

function windowOf(event) {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) throw new Error('ไม่พบหน้าต่างที่จะพิมพ์')
  return win
}

// ชื่อไฟล์ต้องเอาไปตั้งเป็นชื่อไฟล์จริงได้ — Windows ห้าม \ / : * ? " < > |
// ตัดทิ้งแทนการแทนที่ด้วย _ เพราะเลขที่เอกสารของเราไม่มีอักขระพวกนี้อยู่แล้ว
// (ตัวนี้กันไว้เผื่อชื่อหอที่ผู้ใช้ตั้งเองหลุดเข้ามา)
function safeFileName(name) {
  return String(name ?? 'document').replace(/[\\/:*?"<>|]/g, '').trim() || 'document'
}

// เครื่องพิมพ์เสมือนที่ Windows แถมมา — ไม่ได้ทำให้เกิดกระดาษ
// ใช้เตือนผู้ใช้ว่ายังไม่ได้ต่อเครื่องพิมพ์จริง ไม่ได้ซ่อนออกจากรายการ
// (บางคนตั้งใจใช้ "Microsoft Print to PDF" จริงๆ)
const VIRTUAL_PRINTERS = [
  'Microsoft Print to PDF',
  'Microsoft XPS Document Writer',
  'OneNote',
  'Fax'
]

function isVirtualPrinter(name) {
  return VIRTUAL_PRINTERS.some((v) => String(name).includes(v))
}

export function registerPrintHandlers() {
  // รายชื่อเครื่องพิมพ์ที่ Windows รู้จัก — หน้าจอเอาไปทำกล่องเลือกของเราเอง
  //
  // ทำไมไม่ใช้กล่องของ Windows: Electron บน Windows เปิดกล่องระบบได้ก็จริง แต่มันเป็น
  // ภาษาอังกฤษล้วนในแอปที่เป็นไทยทั้งตัว และขึ้นว่า "This app doesn't support print preview"
  // ซึ่งอ่านแล้วเหมือนแอปพัง ทั้งที่ตัวเอกสารที่จะพิมพ์คือหน้าที่ผู้ใช้มองอยู่ตรงหน้าแล้ว
  handle('print:listPrinters', async (_payload, event) => {
    const printers = await windowOf(event).webContents.getPrintersAsync()
    return printers.map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: Boolean(p.isDefault),
      isVirtual: isVirtualPrinter(p.name)
    }))
  })

  // ตัวอย่างก่อนพิมพ์ — เรนเดอร์เอกสารเป็น PDF แล้วส่งกลับไปให้หน้าจอแสดงในตัวอ่าน PDF
  // ของ Chromium (ตรงกับที่ต้นแบบทำ: กดพิมพ์แล้วเห็นหน้ากระดาษจริงก่อน)
  //
  // สำคัญ: ตัวอย่างนี้มาจาก printToPDF ตัวเดียวกับที่ปุ่ม "บันทึก PDF" ใช้ และตัวเดียวกับ
  // ที่ print() จะเรนเดอร์ ผู้ใช้จึงเห็นสิ่งที่จะออกจากเครื่องพิมพ์จริงๆ ไม่ใช่ของที่คล้ายกัน
  //
  // ส่งเป็น base64 เพราะ Buffer ข้ามสะพาน IPC แล้วกลายเป็น object ที่หน้าจอเอาไปใช้ต่อยาก
  handle('print:preview', async (_payload, event) => {
    const pdf = await windowOf(event).webContents.printToPDF(PAGE)
    return { base64: pdf.toString('base64') }
  })

  // ส่งเข้าเครื่องพิมพ์ที่ผู้ใช้เลือกจากกล่องของเรา จึงพิมพ์เงียบได้ (ไม่เปิดกล่องซ้อนอีกชั้น)
  handle('print:document', async ({ deviceName, copies }, event) => {
    const win = windowOf(event)
    if (!deviceName) throw new Error('กรุณาเลือกเครื่องพิมพ์')

    const count = Number(copies ?? 1)
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      throw new Error('จำนวนชุดต้องเป็นตัวเลข 1-20')
    }

    const done = await new Promise((resolve) => {
      win.webContents.print(
        { ...PAGE, silent: true, deviceName, copies: count },
        (success, reason) => resolve({ success, reason })
      )
    })

    if (!done.success) {
      throw new Error(`พิมพ์ไม่สำเร็จ: ${done.reason || 'เครื่องพิมพ์ไม่ตอบสนอง'}`)
    }

    logInfo(`ส่งเอกสารเข้าเครื่องพิมพ์ ${deviceName} จำนวน ${count} ชุด`)
    return { cancelled: false }
  })

  // บันทึกเป็น PDF — ให้ผู้ใช้เลือกที่เก็บเอง ตั้งชื่อไฟล์ให้ล่วงหน้าเป็นเลขที่เอกสาร
  // เพื่อให้ส่งต่อทางไลน์/แชตแล้วผู้เช่ารู้ทันทีว่าเป็นบิลใบไหน
  handle('print:savePdf', async ({ fileName }, event) => {
    const win = windowOf(event)
    const suggested = `${safeFileName(fileName)}.pdf`

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'บันทึกใบแจ้งหนี้เป็น PDF',
      defaultPath: path.join(app.getPath('downloads'), suggested),
      filters: [{ name: 'ไฟล์ PDF', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return { cancelled: true }

    const pdf = await win.webContents.printToPDF(PAGE)
    fs.writeFileSync(filePath, pdf)
    logInfo(`บันทึก PDF: ${filePath}`)

    return { cancelled: false, filePath }
  })

  // เปิดโฟลเดอร์ที่เก็บไฟล์แล้วเลือกไฟล์นั้นไว้ให้ — ผู้ใช้จะได้ลากไปแนบในไลน์ได้ทันที
  // ไม่เปิดตัวไฟล์เอง เพราะเป้าหมายคือ "ส่งต่อ" ไม่ใช่ "อ่าน"
  handle('print:revealPdf', ({ filePath }) => {
    if (!filePath) throw new Error('ไม่ทราบตำแหน่งไฟล์')
    shell.showItemInFolder(filePath)
    return { ok: true }
  })
}
