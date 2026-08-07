-- Phase 3 — จดมิเตอร์ → ออกบิล → รับชำระ
--
-- ตาราง meter_batches / meter_readings / invoices / invoice_items / payments ถูกสร้างไว้
-- ตั้งแต่ 001_init.sql (แปลงตรงๆ มาจากสคีมา MySQL เดิม) แต่ยังไม่เคยมีข้อมูลจริงเลย
-- ไฟล์นี้ปรับรูปร่างให้ตรงกับที่สำรวจหน้าจริงของต้นแบบมา ก่อนจะเริ่มเขียนโค้ดใช้งาน

-- -----------------------------------------------------
-- 1) ใบจดมิเตอร์ห้ามซ้ำวัน และห้องหนึ่งจดได้ครั้งเดียวต่อใบ
-- -----------------------------------------------------
-- ต้นแบบเก็บ "ใบจดมิเตอร์" หนึ่งใบต่อวันที่จด แล้วไล่กรอกทุกห้องในใบนั้น
-- ถ้าปล่อยให้สร้างซ้ำวันได้ จะมีสองใบของวันเดียวกันให้เลือกตอนออกบิล แล้วไม่มีใครรู้ว่าใบไหนจริง
CREATE UNIQUE INDEX idx_meter_batches_unique ON meter_batches (apartment_id, reading_date);
CREATE UNIQUE INDEX idx_meter_readings_unique ON meter_readings (meter_batch_id, room_id);

-- -----------------------------------------------------
-- 2) invoices — แยกบิลรายเดือนออกจากใบแจ้งหนี้ทั่วไป
-- -----------------------------------------------------
-- ต้นแบบมีสองทาง: "บิลรายเดือน" (ออกยกล็อตจากใบจดมิเตอร์) กับ "ใบแจ้งหนี้ทั่วไป"
-- (ออกใบเดี่ยวเมื่อไหร่ก็ได้ กี่ใบก็ได้) ทั้งสองอยู่ตารางเดียวกัน แต่กติกาต่างกัน
-- จึงต้องมีคอลัมน์บอกชนิด ไม่งั้นเขียนกฎ "ห้ามออกบิลเดือนเดิมซ้ำ" ไม่ได้เลย
ALTER TABLE invoices ADD COLUMN invoice_type TEXT NOT NULL DEFAULT 'monthly';

-- บิลรายเดือนใบไหนมาจากการจดมิเตอร์รอบไหน — ต้องรู้ เพราะใบแจ้งหนี้ต้องพิมพ์เลขมิเตอร์
-- ก่อน/หลังลงไปด้วย ("ค่าน้ำ/water : 98 หน่วย (2 - 100)") และเพื่อกันออกบิลจากรอบเดิมซ้ำ
-- ใบแจ้งหนี้ทั่วไปไม่มีมิเตอร์ จึงปล่อย NULL ได้
ALTER TABLE invoices ADD COLUMN meter_batch_id INTEGER REFERENCES meter_batches (batch_id);

-- ยกเลิกบิลแล้วต้องรู้ว่าใครยกเลิกเมื่อไหร่ — บิลที่หายไปเฉยๆ ตรวจสอบย้อนหลังไม่ได้
ALTER TABLE invoices ADD COLUMN cancelled_at TEXT;

CREATE UNIQUE INDEX idx_invoices_number ON invoices (invoice_number);
CREATE INDEX idx_invoices_meter_batch ON invoices (meter_batch_id);
CREATE INDEX idx_invoices_billing_month ON invoices (billing_month);

-- หนึ่งสัญญา = หนึ่งบิลรายเดือนต่อเดือน ที่ยังไม่ถูกยกเลิก
-- เป็น partial index เพราะใบแจ้งหนี้ทั่วไปออกซ้ำเดือนได้ไม่จำกัด และบิลที่ยกเลิกแล้ว
-- ต้องไม่บล็อกการออกบิลใหม่ของเดือนเดียวกัน
CREATE UNIQUE INDEX idx_invoices_one_per_month
  ON invoices (contract_id, billing_month)
  WHERE invoice_type = 'monthly' AND status <> 'cancelled';

-- -----------------------------------------------------
-- 3) payments — รื้อใหม่ทั้งตาราง
-- -----------------------------------------------------
-- ของเดิมผูกกับ invoice_item_id ซึ่งผิดสองชั้น:
--   ก) หน้าจอรับเงินของต้นแบบรับเป็น "ยอดเดียวต่อทั้งใบ" ไม่ได้จ่ายรายบรรทัด
--   ข) รายงานใบเสร็จมีคอลัมน์ประเภทที่เป็น "สัญญา" ได้ = ใบเสร็จเงินประกัน/เงินล่วงหน้า
--      ตอนทำสัญญา ซึ่งไม่มีใบแจ้งหนี้อยู่เบื้องหลังเลย
--
-- SQLite เปลี่ยนชนิด/ลบคอลัมน์ตรงๆ ไม่ได้ ต้องสร้างใหม่/คัดลอก/เปลี่ยนชื่อ
-- ตารางเดิมยังว่าง (Phase 3 ยังไม่เริ่ม) จึงไม่ต้องคัดลอกข้อมูล แต่คงลำดับขั้นไว้ให้ครบ
DROP INDEX IF EXISTS idx_payments_invoice_item;
DROP INDEX IF EXISTS idx_payments_created_by;
DROP TABLE payments;

-- payment_method allowed: 'cash' | 'transfer' | 'other'
CREATE TABLE payments (
  payment_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id       INTEGER,
  contract_id      INTEGER,
  receipt_number   TEXT NOT NULL,
  payment_date     TEXT NOT NULL,
  -- ติดลบได้ = การคืนเงิน (ต้นแบบแสดง -1,000.00 ในรายงานใบเสร็จ)
  amount_cents     INTEGER NOT NULL,
  vat_amount_cents INTEGER NOT NULL DEFAULT 0,
  payment_method   TEXT NOT NULL,
  remark           TEXT,
  created_by       INTEGER NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT,
  -- ใบเสร็จหนึ่งใบอ้างอิงต้นทางได้ทางเดียวเท่านั้น ไม่ใช่ทั้งคู่ และไม่ใช่ไม่มีเลย
  -- (ใบเสร็จลอยๆ ที่ไม่รู้ว่ารับเงินค่าอะไร คือใบเสร็จที่กระทบยอดไม่ได้)
  CHECK ((invoice_id IS NOT NULL) <> (contract_id IS NOT NULL)),
  FOREIGN KEY (invoice_id) REFERENCES invoices (invoice_id),
  FOREIGN KEY (contract_id) REFERENCES contracts (contract_id),
  FOREIGN KEY (created_by) REFERENCES users (user_id)
);
CREATE UNIQUE INDEX idx_payments_receipt_number ON payments (receipt_number);
CREATE INDEX idx_payments_invoice ON payments (invoice_id);
CREATE INDEX idx_payments_contract ON payments (contract_id);
CREATE INDEX idx_payments_created_by ON payments (created_by);
CREATE INDEX idx_payments_date ON payments (payment_date);

-- -----------------------------------------------------
-- 4) เลขที่เอกสาร
-- -----------------------------------------------------
-- ต้นแบบเดินเลขเป็น I2025030018 / R2025030010 = ตัวอักษร + YYYYMM + ลำดับ 4 หลัก
--
-- ทำไมต้องมีตารางนับ แทนที่จะ SELECT MAX(...) + 1 ตอนออกเอกสาร:
-- บิลลบได้ (ต้นแบบมีปุ่มลบบนใบแจ้งหนี้) ถ้าไล่จากเลขสูงสุดที่มีอยู่ พอลบใบท้ายสุดทิ้ง
-- ใบถัดไปจะได้เลขเดิมซ้ำ = เอกสารการเงินสองใบคนละฉบับถือเลขเดียวกัน ตรวจย้อนหลังไม่ได้
-- ตัวนับเดินหน้าอย่างเดียว ไม่ถอยตามการลบ
--
-- doc_type allowed: 'invoice' | 'receipt'
-- period format: 'YYYYMM'
CREATE TABLE document_counters (
  apartment_id  INTEGER NOT NULL,
  doc_type      TEXT NOT NULL,
  period        TEXT NOT NULL,
  last_seq      INTEGER NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (apartment_id, doc_type, period),
  FOREIGN KEY (apartment_id) REFERENCES apartments (apartment_id)
);
