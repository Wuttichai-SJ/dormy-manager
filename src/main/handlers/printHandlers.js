// พิมพ์จากหน้าจอที่ผู้ใช้ดูอยู่ · ซ่อนส่วนที่ไม่พิมพ์ด้วย @media print
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { logError, logInfo } from '../logger.js'
import { requireSessionUserId } from './authHandlers.js'

// ต้องตรงกับ @page ใน CSS
const PAGE = {
  pageSize: 'A4',
  margins: { marginType: 'custom', top: 0.47, bottom: 0.47, left: 0.47, right: 0.47 },
  printBackground: true,
  landscape: false
}

// ย่อทีละขั้นจนลงหน้าเดียว ต่ำสุด 0.5
const FIT_SCALES = [1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6, 0.55, 0.5]

// นับ /Type /Page ในไบต์ของ PDF — อ่านไม่ออกคืน 1
function countPdfPages(buffer) {
  const text = buffer.toString('latin1')

  const pageObjects = text.match(/\/Type\s*\/Page[^s]/g)
  if (pageObjects) return pageObjects.length

  const count = text.match(/\/Count\s+(\d+)/)
  if (count) return Number(count[1])

  return 1
}

// maxPages = จำนวนหน้าที่เอกสารควรมี (ใบแจ้งหนี้ = 1)
async function renderFittedPdf(win, maxPages = 1) {
  const budget = Math.max(1, Number(maxPages) || 1)
  let last = null
  for (const scale of FIT_SCALES) {
    const pdf = await win.webContents.printToPDF({ ...PAGE, scale })
    last = { pdf, scale }
    if (countPdfPages(pdf) <= budget) return last
  }
  return last
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return { success: true, data: await fn(payload ?? {}, event) }
    } catch (err) {
      logError(`${channel} ล้มเหลว`, err)
      return { success: false, error: err.message, fields: err.fields }
    }
  })
}

function handleSession(channel, fn) {
  handle(channel, (payload, event) => {
    requireSessionUserId()
    return fn(payload, event)
  })
}

function windowOf(event) {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) throw new Error('ไม่พบหน้าต่างที่จะพิมพ์')
  return win
}

function safeFileName(name) {
  return String(name ?? 'document').replace(/[\\/:*?"<>|]/g, '').trim() || 'document'
}

// เครื่องพิมพ์เสมือน — ใช้เตือน ไม่ซ่อน
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
  handleSession('print:listPrinters', async (_payload, event) => {
    const printers = await windowOf(event).webContents.getPrintersAsync()
    return printers.map((p) => ({
      name: p.name,
      displayName: p.displayName || p.name,
      isDefault: Boolean(p.isDefault),
      isVirtual: isVirtualPrinter(p.name)
    }))
  })

  handleSession('print:preview', async ({ maxPages }, event) => {
    const { pdf, scale } = await renderFittedPdf(windowOf(event), maxPages)
    return { base64: pdf.toString('base64'), scale }
  })

  handleSession('print:document', async ({ deviceName, copies, maxPages }, event) => {
    const win = windowOf(event)
    if (!deviceName) throw new Error('กรุณาเลือกเครื่องพิมพ์')

    const count = Number(copies ?? 1)
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      throw new Error('จำนวนชุดต้องเป็นตัวเลข 1-20')
    }

    const { scale } = await renderFittedPdf(win, maxPages)

    const done = await new Promise((resolve) => {
      win.webContents.print(
        { ...PAGE, silent: true, deviceName, copies: count, scaleFactor: scale * 100 },
        (success, reason) => resolve({ success, reason })
      )
    })

    if (!done.success) {
      throw new Error(`พิมพ์ไม่สำเร็จ: ${done.reason || 'เครื่องพิมพ์ไม่ตอบสนอง'}`)
    }

    logInfo(`ส่งเอกสารเข้าเครื่องพิมพ์ ${deviceName} จำนวน ${count} ชุด`)
    return { cancelled: false }
  })

  handleSession('print:savePdf', async ({ fileName, maxPages }, event) => {
    const win = windowOf(event)
    const suggested = `${safeFileName(fileName)}.pdf`

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'บันทึกใบแจ้งหนี้เป็น PDF',
      defaultPath: path.join(app.getPath('downloads'), suggested),
      filters: [{ name: 'ไฟล์ PDF', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return { cancelled: true }

    const { pdf, scale } = await renderFittedPdf(win, maxPages)
    fs.writeFileSync(filePath, pdf)
    logInfo(`บันทึก PDF: ${filePath} (ย่อ ${Math.round(scale * 100)}%)`)

    return { cancelled: false, filePath }
  })

  handleSession('print:revealPdf', ({ filePath }) => {
    if (!filePath) throw new Error('ไม่ทราบตำแหน่งไฟล์')
    shell.showItemInFolder(filePath)
    return { ok: true }
  })
}
