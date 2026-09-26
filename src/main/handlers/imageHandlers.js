// main อ่านไฟล์รูปเอง — ส่ง bytes ข้าม IPC จะบวมมาก
import fs from 'node:fs'
import path from 'node:path'
import { dialog, ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import { requireOwnerUserId, requireSessionUserId } from './authHandlers.js'
import {
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_BYTES,
  deleteOrphanImages,
  getImageDataUrl,
  insertImage
} from '../db/images.js'

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
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

// ต้องส่ง event ต่อให้ fn (ดู exportHandlers.js)
function handleSession(channel, fn) {
  handle(channel, (payload, event) => {
    requireSessionUserId()
    return fn(payload, event)
  })
}

export function registerImageHandlers() {
  // เฉพาะเจ้าของหอ — QR คือปลายทางเงิน · getQr/getDataUrl เปิดไว้ให้พิมพ์บิล
  handle('image:uploadQr', async ({ apartmentId }) => {
    requireOwnerUserId()
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'เลือกรูป QR Code รับเงิน',
      properties: ['openFile'],
      filters: [{ name: 'รูปภาพ', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    })
    if (canceled || filePaths.length === 0) return { cancelled: true }

    const filePath = filePaths[0]
    const mimeType = MIME_BY_EXT[path.extname(filePath).toLowerCase()]
    if (!mimeType) {
      throw new Error(`รองรับเฉพาะไฟล์ ${ALLOWED_MIME_TYPES.join(', ')}`)
    }

    const bytes = fs.readFileSync(filePath)
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new Error(
        `ไฟล์ใหญ่เกินไป (${Math.round(bytes.length / 1024)} KB) ` +
          `จำกัดไม่เกิน ${MAX_IMAGE_BYTES / 1024 / 1024} MB`
      )
    }

    const db = getDatabase()
    const run = db.transaction(() => {
      const image = insertImage(db, { mimeType, bytes })
      db.prepare('UPDATE apartments SET qr_code_image_id = ?, updated_at = ? WHERE apartment_id = ?')
        .run(image.imageId, new Date().toISOString(), apartmentId)
      deleteOrphanImages(db)
      return image.imageId
    })

    const imageId = run()
    logInfo(`อัปโหลด QR ของหอ ${apartmentId} (image_id ${imageId}, ${bytes.length} ไบต์)`)
    return { cancelled: false, imageId, dataUrl: getImageDataUrl(db, imageId) }
  })

  handleSession('image:getQr', ({ apartmentId }) => {
    const db = getDatabase()
    const row = db
      .prepare('SELECT qr_code_image_id FROM apartments WHERE apartment_id = ?')
      .get(apartmentId)
    if (!row) throw new Error('ไม่พบหอพัก')
    return { imageId: row.qr_code_image_id, dataUrl: getImageDataUrl(db, row.qr_code_image_id) }
  })

  handle('image:removeQr', ({ apartmentId }) => {
    requireOwnerUserId()
    const db = getDatabase()
    const run = db.transaction(() => {
      db.prepare('UPDATE apartments SET qr_code_image_id = NULL, updated_at = ? WHERE apartment_id = ?')
        .run(new Date().toISOString(), apartmentId)
      deleteOrphanImages(db)
    })
    run()
    logInfo(`ลบ QR ของหอ ${apartmentId}`)
    return { ok: true }
  })

  handleSession('image:getDataUrl', ({ imageId }) => ({
    dataUrl: getImageDataUrl(getDatabase(), imageId)
  }))
}
