// ตาราง images — รูปภาพเก็บเป็น BLOB ในฐานข้อมูล (ดู 011_images_as_blobs.sql)
//
// รูปทุกใบในระบบผ่านที่นี่ที่เดียว: QR รับเงินของหอ และรูปงานแจ้งซ่อม
// ทุกจุดที่ใช้รูป "ไม่บังคับ" ทั้งหมด — NULL = ยังไม่ได้ใส่ ระบบต้องทำงานต่อได้ตามปกติ

// ชนิดไฟล์ที่รับ — จำกัดไว้เท่าที่เบราว์เซอร์ของ Electron แสดงได้แน่นอน
// ไม่รับ svg เพราะ svg ฝังสคริปต์ได้ แล้วเราเอาไปแสดงใน renderer ที่มีสะพาน IPC อยู่
export const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

// 3 MB ต่อรูป — เท่าที่ต้นแบบกำหนดไว้ในหน้าอัปโหลดโลโก้
//
// ทำไมต้องจำกัด: ฐานข้อมูลทั้งระบบอยู่ในไฟล์เดียวที่ถูกคัดลอกทั้งไฟล์ตอนสำรอง
// รูปจากกล้องมือถือใบละ 5-8 MB ถ้าปล่อยให้ใส่ตามใจ แจ้งซ่อม 200 งานก็ทำให้ไฟล์
// ฐานข้อมูลบวมเป็นหลาย GB แล้วการสำรองจะช้าจนคนเลิกสำรอง
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

// รับ Buffer/Uint8Array มาเก็บ คืน id ที่เอาไปผูกกับเจ้าของรูป
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

// อ่านเฉพาะข้อมูลประกอบ ไม่ดึงตัวไบต์ — ใช้ตอนอยากรู้แค่ว่า "มีรูปไหม ใหญ่แค่ไหน"
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

// ดึงรูปออกมาเป็น data URL ให้ <img src> ใช้ได้ตรงๆ
//
// ส่งเป็น data URL แทนที่จะส่ง Buffer ดิบข้ามสะพาน IPC เพราะ Buffer ที่ข้ามไปฝั่ง renderer
// จะกลายเป็น Uint8Array ที่ต้องแปลงเป็น blob URL เองแล้วต้องคอยเรียก revokeObjectURL
// ไม่งั้นหน่วยความจำรั่ว — data URL จบในตัว ไม่มีอะไรต้องเก็บกวาด
export function getImageDataUrl(db, imageId) {
  if (!imageId) return null
  const row = db.prepare('SELECT mime_type, bytes FROM images WHERE image_id = ?').get(imageId)
  if (!row) return null
  return `data:${row.mime_type};base64,${row.bytes.toString('base64')}`
}

// ลบรูปที่ไม่มีใครอ้างถึงแล้ว
//
// เรียกหลังจากปลดรูปออกจากเจ้าของเสมอ (เปลี่ยน QR ใหม่ / ลบงานแจ้งซ่อม) ไม่งั้นไบต์เก่า
// จะค้างอยู่ในไฟล์ฐานข้อมูลตลอดไปแล้วไฟล์บวมขึ้นเรื่อยๆ โดยไม่มีใครสังเกต
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
