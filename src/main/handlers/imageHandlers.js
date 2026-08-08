// IPC ของรูปภาพ — ตอนนี้ใช้กับ QR รับเงินของหอพักอย่างเดียว
//
// **ผู้ใช้เลือกไฟล์ผ่านกล่องของระบบฝั่ง main แล้ว main อ่านไฟล์เอง** ไม่ได้ให้หน้าจอ
// อ่านไฟล์แล้วส่งไบต์ข้ามสะพานมา — รูป 3 MB ที่แปลงเป็น array ธรรมดาเพื่อข้าม IPC
// จะบวมเป็นสิบเท่าและช้า อีกทั้งหน้าจอไม่ต้องมีสิทธิ์แตะไฟล์ในเครื่องเลย
import fs from 'node:fs'
import path from 'node:path'
import { dialog, ipcMain } from 'electron'
import { getDatabase } from '../database.js'
import { logError, logInfo } from '../logger.js'
import {
  ALLOWED_MIME_TYPES,
  MAX_IMAGE_BYTES,
  deleteOrphanImages,
  getImageDataUrl,
  insertImage
} from '../db/images.js'

// นามสกุลไฟล์ → mime type ที่ตาราง images ยอมรับ
// อ่านจากนามสกุลก็พอสำหรับรูปที่ผู้ใช้เลือกเองจากเครื่องตัวเอง ไม่ใช่ไฟล์ที่รับจากภายนอก
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
      return { success: false, error: err.message }
    }
  })
}

export function registerImageHandlers() {
  // อัปโหลด QR ของหอ — เลือกไฟล์ → เก็บลงตาราง images → ผูกกับหอ → เก็บกวาดรูปเก่า
  handle('image:uploadQr', async ({ apartmentId }) => {
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
      // รูปเก่าที่เพิ่งถูกปลดออกจากหอจะกลายเป็นรูปกำพร้า เก็บกวาดทันทีในธุรกรรมเดียวกัน
      // ไม่งั้นไฟล์ฐานข้อมูลจะบวมขึ้นทุกครั้งที่เปลี่ยน QR
      deleteOrphanImages(db)
      return image.imageId
    })

    const imageId = run()
    logInfo(`อัปโหลด QR ของหอ ${apartmentId} (image_id ${imageId}, ${bytes.length} ไบต์)`)
    return { cancelled: false, imageId, dataUrl: getImageDataUrl(db, imageId) }
  })

  handle('image:getQr', ({ apartmentId }) => {
    const db = getDatabase()
    const row = db
      .prepare('SELECT qr_code_image_id FROM apartments WHERE apartment_id = ?')
      .get(apartmentId)
    if (!row) throw new Error('ไม่พบหอพัก')
    return { imageId: row.qr_code_image_id, dataUrl: getImageDataUrl(db, row.qr_code_image_id) }
  })

  handle('image:removeQr', ({ apartmentId }) => {
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

  // รูปสำหรับแสดงบนใบแจ้งหนี้ — คืนเป็น data URL ไม่ใช่ไบต์ดิบ
  handle('image:getDataUrl', ({ imageId }) => ({
    dataUrl: getImageDataUrl(getDatabase(), imageId)
  }))
}
