// IPC ของการส่งออกตาราง — ใช้ได้กับทุกรายงาน ไม่ผูกกับรายงานใดรายงานหนึ่ง
//
// **ส่งออกเป็น CSV ไม่ใช่ .xlsx** ตามนโยบาย dependency ขั้นต่ำ — ไฟล์ .xlsx จริงต้องพึ่ง
// ไลบรารีอย่าง exceljs ซึ่งเป็นภาระอีกตัวที่ต้องดูแลไป 20 ปี ส่วน CSV เขียนเองได้ในไม่กี่บรรทัด
// และ Excel เปิดได้ตรงๆ (ดับเบิลคลิกไฟล์แล้วขึ้นเป็นตารางเลย)
//
// **ต้องมี BOM ของ UTF-8 นำหน้าไฟล์เสมอ** ไม่งั้น Excel บน Windows จะเดารหัสอักขระเป็น
// ANSI แล้วภาษาไทยกลายเป็นตัวยึกยือทั้งไฟล์ — นี่คือเหตุผลเดียวที่คนบ่นว่า "export
// ภาษาไทยแล้วอ่านไม่ออก" และแก้ได้ด้วยสามไบต์
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { logError, logInfo } from '../logger.js'

const UTF8_BOM = '﻿'

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

// ครอบด้วยเครื่องหมายคำพูดเมื่อจำเป็น และคูณ " เป็น "" ตามกติกาของ CSV
// ครอบทุกช่องไปเลยง่ายกว่าและไม่ผิด — ตัวเลขที่อยู่ในเครื่องหมายคำพูด Excel ก็ยังอ่านเป็นตัวเลข
function toCsvCell(value) {
  if (value === null || value === undefined) return '""'
  return `"${String(value).replace(/"/g, '""')}"`
}

function safeFileName(name) {
  return String(name ?? 'export').replace(/[\\/:*?"<>|]/g, '').trim() || 'export'
}

export function registerExportHandlers() {
  // columns = [{ key, label }] · rows = อาร์เรย์ของ object
  // หน้าจอเป็นคนบอกว่าจะส่งออกคอลัมน์ไหนด้วยชื่ออะไร เพราะหัวตารางในไฟล์ควรตรงกับที่เห็นบนจอ
  handle('export:csv', async ({ fileName, columns, rows }, event) => {
    if (!Array.isArray(columns) || columns.length === 0) throw new Error('ไม่ได้ระบุคอลัมน์')
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('ไม่มีข้อมูลให้ส่งออก')

    const win = BrowserWindow.fromWebContents(event.sender)
    const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined, {
      title: 'ส่งออกเป็นไฟล์ Excel (CSV)',
      defaultPath: path.join(app.getPath('downloads'), `${safeFileName(fileName)}.csv`),
      filters: [{ name: 'ไฟล์ CSV (เปิดด้วย Excel ได้)', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return { cancelled: true }

    const lines = [columns.map((c) => toCsvCell(c.label)).join(',')]
    for (const row of rows) {
      lines.push(columns.map((c) => toCsvCell(row[c.key])).join(','))
    }

    // \r\n เพราะ Excel บน Windows คาดหวังแบบนั้น
    fs.writeFileSync(filePath, UTF8_BOM + lines.join('\r\n') + '\r\n', 'utf8')
    logInfo(`ส่งออก CSV: ${filePath} (${rows.length} แถว)`)

    return { cancelled: false, filePath, rowCount: rows.length }
  })

  handle('export:reveal', ({ filePath }) => {
    if (!filePath) throw new Error('ไม่ทราบตำแหน่งไฟล์')
    shell.showItemInFolder(filePath)
    return { ok: true }
  })
}
