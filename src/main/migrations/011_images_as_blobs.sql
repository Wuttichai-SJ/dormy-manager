-- 011_images_as_blobs.sql
-- IMMUTABLE once shipped. Further changes go in 012_*.sql.
--
-- เก็บรูปภาพไว้ "ในฐานข้อมูล" ไม่ใช่เป็นไฟล์ในโฟลเดอร์แล้วเก็บแค่ path
--
-- เหตุผล: การสำรองข้อมูลคัดลอกเฉพาะไฟล์ .sqlite (ดู db/backups.js) ถ้ารูปเป็นไฟล์แยก
-- ไฟล์สำรองจะไม่มีรูปติดไปด้วย พอกู้คืนแล้ว path ในฐานข้อมูลจะชี้ไปที่ไฟล์ที่ไม่มีอยู่จริง
-- QR รับเงินหายจากใบแจ้งหนี้ และรูปแจ้งซ่อมหายทั้งหมดโดยไม่มีอะไรเตือน
--
-- ตรงกับหลักการของโปรเจกต์นี้ด้วย: ทุกอย่างอยู่ในไฟล์เดียว ย้ายเครื่องคือคัดลอกไฟล์เดียว
--
-- *** ทำไมต้องเป็นตารางกลาง ไม่ใช่คอลัมน์ BLOB บนตารางที่ใช้ ***
-- SQLite อ่านทั้งแถวเวลา SELECT — ถ้าเอา BLOB ไปแปะบน apartments คำสั่ง `SELECT a.*`
-- ในหน้ารายการหอพัก (db/apartments.js) จะลากรูป QR ของทุกหอขึ้นมาด้วยทุกครั้งที่เปิดหน้า
-- ทั้งที่ไม่ได้ใช้ แยกออกมาแล้วรูปจะถูกอ่านเฉพาะตอนที่ขอดูจริงๆ
--
-- และงานแจ้งซ่อมหนึ่งงานมีรูปได้หลายรูป (ก่อนซ่อม/หลังซ่อม) คอลัมน์เดียวเก็บไม่ได้อยู่แล้ว

CREATE TABLE images (
  image_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  -- เก็บ mime ไว้ด้วยเพื่อส่งกลับไปให้หน้าจอทำเป็น data URL ได้ตรงชนิด
  -- (image/png, image/jpeg, ...) ไม่ต้องเดาจากไบต์
  mime_type  TEXT NOT NULL,
  byte_size  INTEGER NOT NULL,
  bytes      BLOB NOT NULL,
  created_at TEXT NOT NULL
);

-- QR รับเงินของหอ — ไม่บังคับ (NULL = ยังไม่ได้อัปโหลด ใบแจ้งหนี้ก็ยังออกได้ แค่ไม่มี QR)
--
-- คอลัมน์เดิม apartments.qr_code_image (TEXT เก็บ path) เลิกใช้แล้วตั้งแต่ migration นี้
-- ไม่ลบทิ้งเพราะ SQLite ต้องสร้างตารางใหม่ทั้งใบเพื่อลบคอลัมน์เดียว ซึ่งไม่คุ้มความเสี่ยง
-- กับข้อมูลหอจริงที่มีอยู่แล้ว — ไม่เคยมีโค้ดไหนเขียนค่าลงคอลัมน์นั้นเลย ปล่อยว่างไว้ตลอด
ALTER TABLE apartments ADD COLUMN qr_code_image_id INTEGER REFERENCES images (image_id);

-- รูปของงานแจ้งซ่อม — หนึ่งงานมีได้หลายรูป และไม่บังคับว่าต้องมี
-- แจ้งซ่อมทางโทรศัพท์แล้วเจ้าหน้าที่พิมพ์ให้ ก็ไม่มีรูป
CREATE TABLE maintenance_request_images (
  maintenance_id INTEGER NOT NULL,
  image_id       INTEGER NOT NULL,
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (maintenance_id, image_id),
  FOREIGN KEY (maintenance_id) REFERENCES maintenance_requests (maintenance_id),
  FOREIGN KEY (image_id) REFERENCES images (image_id)
);

CREATE INDEX idx_maintenance_images ON maintenance_request_images (maintenance_id, display_order);
