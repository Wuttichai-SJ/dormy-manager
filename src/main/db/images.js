// ไม่รับ svg — ฝังสคริปต์ได้
export const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

// 3 MB ต่อรูป — กันไฟล์ฐานข้อมูลบวม
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024

export function validateImageInput({ mimeType, bytes }) {
  const errors = []

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    errors.push('รองรับเฉพาะไฟล์รูปภาพ png, jpg, webp และ gif')
  }
  if (!bytes || bytes.length === 0) {
    errors.push('ไฟล์รูปภาพว่างเปล่า')
  } else if (bytes.length > MAX_IMAGE_BYTES) {
    const mb = (bytes.length / 1024 / 1024).toFixed(1)
    errors.push(`ไฟล์ใหญ่เกินไป (${mb} MB) — รับได้ไม่เกิน 3 MB`)
  }

  return errors
}

export function insertImage(db, { mimeType, bytes }) {
  const errors = validateImageInput({ mimeType, bytes })
  if (errors.length > 0) throw new Error(errors.join('\n'))

  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  const result = db
    .prepare(
      `INSERT INTO images (mime_type, byte_size, bytes, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(mimeType, buffer.length, buffer, new Date().toISOString())

  return { imageId: result.lastInsertRowid, mimeType, byteSize: buffer.length }
}

export function getImageInfo(db, imageId) {
  if (!imageId) return null
  const row = db
    .prepare('SELECT image_id, mime_type, byte_size, created_at FROM images WHERE image_id = ?')
    .get(imageId)
  if (!row) return null
  return {
    imageId: row.image_id,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    createdAt: row.created_at
  }
}

export function getImageDataUrl(db, imageId) {
  if (!imageId) return null
  const row = db.prepare('SELECT mime_type, bytes FROM images WHERE image_id = ?').get(imageId)
  if (!row) return null
  return `data:${row.mime_type};base64,${row.bytes.toString('base64')}`
}

// เรียกหลังปลดรูปออกจากเจ้าของเสมอ
export function deleteOrphanImages(db) {
  const result = db
    .prepare(
      `DELETE FROM images
        WHERE image_id NOT IN (SELECT qr_code_image_id FROM apartments WHERE qr_code_image_id IS NOT NULL)
          AND image_id NOT IN (SELECT image_id FROM maintenance_request_images)`
    )
    .run()
  return { deleted: result.changes }
}
