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

export function registerPrintHandlers() {
  // ส่งเข้าเครื่องพิมพ์ — เปิดกล่องเลือกเครื่องพิมพ์ของ Windows ให้ผู้ใช้เลือกเอง
  // ไม่พิมพ์เงียบ เพราะหอพักอาจมีหลายเครื่องพิมพ์ และผู้ใช้ต้องเลือกจำนวนชุดได้
  handle('print:document', async (_payload, event) => {
    const win = windowOf(event)
    const done = await new Promise((resolve) => {
      win.webContents.print({ ...PAGE, silent: false }, (success, reason) => {
        // reason = 'cancelled' เมื่อผู้ใช้กดยกเลิกในกล่องเลือกเครื่องพิมพ์ ไม่ใช่ความผิดพลาด
        if (!success && reason && reason !== 'cancelled') {
          resolve({ ok: false, reason })
          return
        }
        resolve({ ok: success, cancelled: !success })
      })
    })

    if (done.ok === false && done.reason) throw new Error(`พิมพ์ไม่สำเร็จ: ${done.reason}`)
    if (done.cancelled) return { cancelled: true }

    logInfo('ส่งเอกสารเข้าเครื่องพิมพ์แล้ว')
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
