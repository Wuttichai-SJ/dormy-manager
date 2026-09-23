// IPC ของการส่งออกตาราง — ใช้ได้กับทุกรายงาน ไม่ผูกกับรายงานใดรายงานหนึ่ง
// ตรรกะการสร้างไฟล์อยู่ที่ ../csv.js เพื่อให้ทดสอบได้โดยไม่ต้องมี electron
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { buildCsv, safeFileName } from '../csv.js'
import { logError, logInfo } from '../logger.js'
import { requireSessionUserId } from './authHandlers.js'

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

// ช่องที่ห่อด้วยตัวนี้ต้องเข้าสู่ระบบก่อน — เหตุผลเต็มอยู่เหนือ requireSessionUserId()
// ใน authHandlers.js
//
// 🔴 ต้องส่ง event ต่อไปให้ fn ด้วย — handle() ของไฟล์นี้เรียก fn(payload, event) และช่อง
// ในไฟล์นี้ใช้ event หาหน้าต่างที่จะพิมพ์/เปิดกล่องบันทึก ถ้าลืมส่งต่อจะพังเป็น "ไม่พบหน้าต่าง"
// (printHandlers.js กับ imageHandlers.js ใช้ตัวห่อรูปเดียวกันด้วยเหตุผลเดียวกันนี้)
function handleSession(channel, fn) {
  handle(channel, (payload, event) => {
    requireSessionUserId()
    return fn(payload, event)
  })
}

export function registerExportHandlers() {
  handleSession('export:csv', async ({ fileName, columns, rows }, event) => {
    // สร้างเนื้อไฟล์ก่อนเปิดกล่องบันทึก — ถ้าข้อมูลมีปัญหา ผู้ใช้จะได้ไม่ต้องเลือกที่เก็บ
    // เสร็จแล้วค่อยมาเจอ error
    const content = buildCsv(columns, rows)

    // showSaveDialog มีสองรูปแบบ: (options) กับ (window, options) — ส่ง undefined เป็น
    // พารามิเตอร์แรกไม่ได้ เพราะ Electron จะนับว่ามีสองอาร์กิวเมนต์แล้วแปลง undefined
    // เป็นหน้าต่างไม่สำเร็จ ต้องเลือกเรียกคนละรูปแบบไปเลย
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'ส่งออกเป็นไฟล์ Excel (CSV)',
      defaultPath: path.join(app.getPath('downloads'), `${safeFileName(fileName)}.csv`),
      filters: [{ name: 'ไฟล์ CSV (เปิดด้วย Excel ได้)', extensions: ['csv'] }]
    }
    const { canceled, filePath } = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (canceled || !filePath) return { cancelled: true }

    fs.writeFileSync(filePath, content, 'utf8')
    logInfo(`ส่งออก CSV: ${filePath} (${rows.length} แถว)`)

    return { cancelled: false, filePath, rowCount: rows.length }
  })

  handleSession('export:reveal', ({ filePath }) => {
    if (!filePath) throw new Error('ไม่ทราบตำแหน่งไฟล์')
    shell.showItemInFolder(filePath)
    return { ok: true }
  })
}
