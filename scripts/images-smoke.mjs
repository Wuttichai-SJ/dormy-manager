// ทดสอบการเก็บรูปภาพเป็น BLOB — รันด้วย: npm run test:images
import {
  assert,
  check,
  ensureElectronRuntime,
  group,
  openTempDatabase,
  summarize,
  throws
} from './lib/harness.mjs'

ensureElectronRuntime(import.meta.url)

const apartments = await import('../src/main/db/apartments.js')
const images = await import('../src/main/db/images.js')

const { db, cleanup } = await openTempDatabase('dormy-images')

// PNG 1x1 พิกเซลจริง — เล็กที่สุดที่ยังเป็นไฟล์ png ถูกต้อง
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const apartment = apartments.insertApartment(db, {
  nameTh: 'หอทดสอบรูปภาพ',
  addressTh: 'ที่อยู่',
  dueDateDay: 5,
  lateFeePerDay: '0'
})

// -----------------------------------------------------
group('ตรวจไฟล์')

check('รับเฉพาะชนิดไฟล์รูปภาพที่รองรับ', () => {
  const errors = images.validateImageInput({ mimeType: 'application/pdf', bytes: PNG_1X1 })
  assert(errors.some((e) => e.includes('png, jpg, webp')), errors.join(', '))
})

// svg ฝังสคริปต์ได้ และเราเอารูปไปแสดงในหน้าจอที่มีสะพาน IPC อยู่
check('ไม่รับ svg', () => {
  const errors = images.validateImageInput({ mimeType: 'image/svg+xml', bytes: PNG_1X1 })
  assert(errors.length === 1, errors.join(', '))
})

check('ไฟล์ว่างไม่ผ่าน', () => {
  const errors = images.validateImageInput({ mimeType: 'image/png', bytes: Buffer.alloc(0) })
  assert(errors.some((e) => e.includes('ว่างเปล่า')), errors.join(', '))
})

check('ไฟล์เกิน 3 MB ไม่ผ่าน และบอกขนาดที่ส่งมา', () => {
  const big = Buffer.alloc(images.MAX_IMAGE_BYTES + 1)
  const errors = images.validateImageInput({ mimeType: 'image/png', bytes: big })
  assert(errors.some((e) => e.includes('3 MB')), errors.join(', '))
})

// -----------------------------------------------------
group('เก็บและอ่านกลับ')

const stored = images.insertImage(db, { mimeType: 'image/png', bytes: PNG_1X1 })

check('เก็บแล้วได้ id และขนาดที่ถูกต้อง', () => {
  assert(stored.imageId > 0, `id ${stored.imageId}`)
  assert(stored.byteSize === PNG_1X1.length, `ขนาด ${stored.byteSize}`)
})

// จุดสำคัญ: ไบต์ที่อ่านกลับต้องเท่ากับที่ใส่เข้าไปเป๊ะ ไม่ถูกแปลงเป็นข้อความระหว่างทาง
check('อ่านกลับมาเป็น data URL ที่ถอดกลับได้ตรงไบต์เดิม', () => {
  const url = images.getImageDataUrl(db, stored.imageId)
  assert(url.startsWith('data:image/png;base64,'), url.slice(0, 40))

  const decoded = Buffer.from(url.split(',')[1], 'base64')
  assert(decoded.equals(PNG_1X1), 'ไบต์ที่อ่านกลับไม่ตรงกับต้นฉบับ')
})

check('อ่านข้อมูลประกอบได้โดยไม่ต้องดึงไบต์', () => {
  const info = images.getImageInfo(db, stored.imageId)
  assert(info.mimeType === 'image/png', info.mimeType)
  assert(info.byteSize === PNG_1X1.length, `${info.byteSize}`)
})

// รูปทุกจุดในระบบไม่บังคับ — ส่ง null เข้ามาต้องได้ null กลับ ไม่ใช่ระเบิด
check('id ที่เป็น null คืน null ไม่ใช่ error', () => {
  assert(images.getImageDataUrl(db, null) === null, 'ควรได้ null')
  assert(images.getImageInfo(db, null) === null, 'ควรได้ null')
})

check('id ที่ไม่มีอยู่คืน null', () => {
  assert(images.getImageDataUrl(db, 9999) === null, 'ควรได้ null')
})

check('ไฟล์ที่ไม่ผ่านการตรวจ เก็บไม่ได้', () => {
  throws(
    () => images.insertImage(db, { mimeType: 'text/plain', bytes: PNG_1X1 }),
    'รองรับเฉพาะไฟล์รูปภาพ',
    'ควรกันตั้งแต่ตอนเก็บ'
  )
})

// -----------------------------------------------------
group('ผูกกับหอพัก และเก็บกวาดรูปกำพร้า')

check('QR ของหอเป็นค่าว่างได้ (ไม่บังคับใส่)', () => {
  const row = db
    .prepare('SELECT qr_code_image_id FROM apartments WHERE apartment_id = ?')
    .get(apartment.apartmentId)
  assert(row.qr_code_image_id === null, `ได้ ${row.qr_code_image_id}`)
})

check('ผูก QR เข้ากับหอได้', () => {
  db.prepare('UPDATE apartments SET qr_code_image_id = ? WHERE apartment_id = ?').run(
    stored.imageId,
    apartment.apartmentId
  )
  const row = db
    .prepare('SELECT qr_code_image_id FROM apartments WHERE apartment_id = ?')
    .get(apartment.apartmentId)
  assert(row.qr_code_image_id === stored.imageId, `ได้ ${row.qr_code_image_id}`)
})

check('รูปที่ยังมีเจ้าของ ไม่ถูกเก็บกวาดทิ้ง', () => {
  const result = images.deleteOrphanImages(db)
  assert(result.deleted === 0, `ลบไป ${result.deleted} รูปทั้งที่ยังมีคนใช้`)
  assert(images.getImageInfo(db, stored.imageId) !== null, 'รูปหายไปทั้งที่ยังใช้อยู่')
})

// เปลี่ยน QR ใหม่แล้วไบต์ของใบเก่าต้องไม่ค้างอยู่ในไฟล์ฐานข้อมูลตลอดไป
check('รูปที่ไม่มีเจ้าของแล้ว ถูกเก็บกวาดทิ้ง', () => {
  const replacement = images.insertImage(db, { mimeType: 'image/png', bytes: PNG_1X1 })
  db.prepare('UPDATE apartments SET qr_code_image_id = ? WHERE apartment_id = ?').run(
    replacement.imageId,
    apartment.apartmentId
  )

  const result = images.deleteOrphanImages(db)
  assert(result.deleted === 1, `ควรลบรูปเก่า 1 ใบ ลบไป ${result.deleted}`)
  assert(images.getImageInfo(db, stored.imageId) === null, 'รูปเก่าควรหายไปแล้ว')
  assert(images.getImageInfo(db, replacement.imageId) !== null, 'รูปใหม่ต้องยังอยู่')
})

// -----------------------------------------------------
cleanup()
summarize('การเก็บรูปภาพเป็น BLOB ทำงานครบทุกเส้นทาง')
