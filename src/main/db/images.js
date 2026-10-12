// ไม่รับ svg — ฝังสคริปต์ได้
export const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

// 3 MB ต่อรูป — กันไฟล์ฐานข้อมูลบวม
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024 // ----> หาค่า Byte จะได้ 1024 byte * 1024 kb * 3mb
// === 3,145,728 ไบต์ 

export function validateImageInput({ mimeType, bytes }) { // ดัก error ไฟล์ใหญ่
  const errors = []

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    errors.push('รองรับเฉพาะไฟล์รูปภาพ png, jpg, webp และ gif')
  }
  if (!bytes || bytes.length === 0) {
    errors.push('ไฟล์รูปภาพว่างเปล่า')
  } else if (bytes.length > MAX_IMAGE_BYTES) {
    const mb = (bytes.length / 1024 / 1024).toFixed(1) // tofix คืนค่าเป้น string แสดงทศนิยม 1 ตำแหน่งปัดเลขขึ้น
    errors.push(`ไฟล์ใหญ่เกินไป (${mb} MB) — รับได้ไม่เกิน 3 MB`)
  }

  return errors
}

export function insertImage(db, { mimeType, bytes }) { // ตรวจรูป → แปลงข้อมูลให้เป็น Buffer → บันทึกลง Database → ส่ง ID ของรูปกลับมา
  const errors = validateImageInput({ mimeType, bytes })
  if (errors.length > 0) throw new Error(errors.join('\n'))

  /// ผ่านการตรวจจะแปลง byte เป้น buffer
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes) // check ถ้า byte เป็น buffer  แล้วใช้ค่าเดิม ถ้าไม่เปลี่ยนเป็น buffer
  const result = db
    .prepare(
      `INSERT INTO images (mime_type, byte_size, bytes, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(mimeType, buffer.length, buffer, new Date().toISOString())

  return { imageId: result.lastInsertRowid, mimeType, byteSize: buffer.length }
          // ID ของ ตัวล่าสุด --- ประเภทรูป ---- ขนาด byte
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

// ให้หน้าเว็ปเรียกใช้ภาพ
export function getImageDataUrl(db, imageId) {
  if (!imageId) return null
  const row = db.prepare('SELECT mime_type, bytes FROM images WHERE image_id = ?').get(imageId)
  if (!row) return null
  return `data:${row.mime_type};base64,${row.bytes.toString('base64')}` 
                                        // แปลง buffer เป้น base64
                                        // data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...
}

// เรียกหลังปลดรูปออกจากเจ้าของเสมอ
export function deleteOrphanImages(db) {
  const result = db
    .prepare( // รวบรวมรูปที่มีคนใช้อยู่
      `DELETE FROM images
        WHERE image_id NOT IN (SELECT qr_code_image_id FROM apartments WHERE qr_code_image_id IS NOT NULL) 
          AND image_id NOT IN (SELECT image_id FROM maintenance_request_images)`
    )
    .run() // ลบรูปที่ไม่มีคนใช้แล้่ว
  return { deleted: result.changes }                                                       // is not null = มีค่าอยู่จริงไม่ใช่ NULL
}
