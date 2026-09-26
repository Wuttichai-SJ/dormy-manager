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
      return { success: false, error: err.message, fields: err.fields }
    }
  })
}

// ต้องส่ง event ต่อให้ fn — ใช้หาหน้าต่างที่เปิดกล่องบันทึก
function handleSession(channel, fn) {
  handle(channel, (payload, event) => {
    requireSessionUserId()
    return fn(payload, event)
  })
}

export function registerExportHandlers() {
  handleSession('export:csv', async ({ fileName, columns, rows }, event) => {
    const content = buildCsv(columns, rows)

    // showSaveDialog: ไม่มีหน้าต่างให้เรียกแบบ (options) — ส่ง undefined เป็นหน้าต่างไม่ได้
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
