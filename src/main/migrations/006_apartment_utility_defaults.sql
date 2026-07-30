-- 006_apartment_utility_defaults.sql
-- IMMUTABLE once shipped. Further changes go in 007_*.sql.
--
-- วิธีคิดค่าน้ำ/ค่าไฟระดับ "หอ" — เป็นค่าตั้งต้นที่จะถูกคัดลอกลงห้องทุกห้องตอนสร้างห้อง
--
-- ทำไมต้องมีสองชั้น (หอ + ห้อง):
-- ตาราง room_utility_settings ที่มีอยู่แล้วเก็บของ "รายห้อง" ซึ่งจำเป็น เพราะบางห้อง
-- คิดไม่เหมือนชาวบ้าน (ห้องที่มีแอร์คิดค่าไฟแพงกว่า ห้องเจ้าของอยู่เองไม่คิดค่าน้ำ)
-- แต่ถ้ามีแค่ระดับห้อง เจ้าของหอ 40 ห้องต้องตั้งค่าเดิมซ้ำ 40 รอบตั้งแต่วันแรก
-- ตารางนี้จึงเก็บ "ค่าเริ่มต้นของหอ" ไว้ให้ห้องใหม่หยิบไปใช้ แล้วค่อยแก้รายห้องทีหลัง
--
-- โครงคอลัมน์ล้อกับ room_utility_settings ทุกช่อง (ต่างแค่ไม่มี room_id)
-- จะได้คัดลอกข้ามตารางได้ตรงๆ ไม่ต้องแปลงชื่อ
--
-- billing_type ที่รองรับ: 'actual' | 'minimum' | 'flat'
--   actual  = คิดตามหน่วยที่ใช้จริง            ใช้ unit_price
--   minimum = คิดตามหน่วยจริง แต่มีขั้นต่ำ      ใช้ unit_price + min_charge
--   flat    = เหมาจ่ายรายเดือน                ใช้ flat_rate
--
-- *** ขั้นต่ำเป็น "บาท" ไม่ใช่ "จำนวนหน่วย" ***
-- ยืนยันจากหน้าจอจริงของต้นแบบ: ช่องเขียนว่า "ขั้นต่ำเรียกเก็บ" หน่วย "บาท"
-- สูตรคือ max(หน่วยที่ใช้ x ราคาต่อหน่วย, ขั้นต่ำบาท) ไม่ใช่การอัดหน่วยขั้นต่ำ
-- ถ้าทำผิดเป็นขั้นต่ำหน่วย บิลจะเพี้ยนทั้งหอทุกเดือนโดยไม่มีใครทันสังเกต

CREATE TABLE apartment_utility_defaults (
  utility_default_id               INTEGER PRIMARY KEY AUTOINCREMENT,
  apartment_id                     INTEGER NOT NULL UNIQUE,

  is_water_enabled                 INTEGER NOT NULL DEFAULT 1,
  water_billing_type               TEXT    NOT NULL DEFAULT 'actual',
  water_unit_price_cents           INTEGER NOT NULL DEFAULT 0,
  water_min_charge_cents           INTEGER NOT NULL DEFAULT 0,
  water_flat_rate_cents            INTEGER NOT NULL DEFAULT 0,
  show_water_reading_in_invoice    INTEGER NOT NULL DEFAULT 1,

  is_electric_enabled              INTEGER NOT NULL DEFAULT 1,
  electric_billing_type            TEXT    NOT NULL DEFAULT 'actual',
  electric_unit_price_cents        INTEGER NOT NULL DEFAULT 0,
  electric_min_charge_cents        INTEGER NOT NULL DEFAULT 0,
  electric_flat_rate_cents         INTEGER NOT NULL DEFAULT 0,
  show_electric_reading_in_invoice INTEGER NOT NULL DEFAULT 1,

  created_at                       TEXT NOT NULL,
  updated_at                       TEXT,
  FOREIGN KEY (apartment_id) REFERENCES apartments (apartment_id)
);
