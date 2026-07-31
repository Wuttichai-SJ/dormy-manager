-- 010_contract_tenants.sql
-- IMMUTABLE once shipped. Further changes go in 011_*.sql.
--
-- หนึ่งสัญญามีผู้เช่าได้หลายคน
--
-- เดิม contracts.tenant_id เป็นคอลัมน์เดียว = หนึ่งสัญญาหนึ่งคน ซึ่งไม่พอสำหรับหอนักศึกษา
-- ที่ห้องหนึ่งอยู่กัน 2 คนเป็นเรื่องปกติ ต้นแบบก็รองรับ ("กรณีมีผู้เช่าหลายคนสามารถเพิ่ม
-- ข้อมูลผู้เช่าท่านอื่นเพิ่มได้") ยืนยันจากหน้าจริง 2026-07-31
--
-- *** ตัดคอลัมน์ contracts.tenant_id ทิ้ง ไม่เก็บไว้เป็น "ผู้เช่าหลัก" ควบคู่กัน ***
-- ถ้าเก็บทั้งสองที่ ทุกครั้งที่เพิ่ม/ลบ/สลับผู้เช่าหลักต้องเขียนสองที่ให้ตรงกัน วันหนึ่ง
-- จะไม่ตรง แล้วไม่มีใครรู้ว่าจะเชื่ออันไหน — ให้ contract_tenants.is_primary เป็นคำตอบ
-- เดียวไปเลย
--
-- ทำตอนนี้เพราะยังไม่มีโค้ดไหนเขียนลงตาราง contracts เลย (โมดูลสัญญายังไม่ได้สร้าง)
-- ข้อมูลจึงว่างเปล่า การคัดลอกเป็น no-op — ถ้าปล่อยไว้จนมีสัญญาจริงแล้วค่อยรื้อจะเจ็บกว่านี้มาก

CREATE TABLE contract_tenants (
  contract_tenant_id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id        INTEGER NOT NULL,
  tenant_id          INTEGER NOT NULL,
  -- ผู้เช่าหลัก = คนที่ชื่อขึ้นใบแจ้งหนี้และเป็นคู่สัญญา มีได้หนึ่งคนต่อสัญญา
  -- (บังคับ "หนึ่งคน" ที่ฝั่ง JS ตอนเขียน SQLite ไม่มี partial unique index ในทุกเวอร์ชัน)
  is_primary         INTEGER NOT NULL DEFAULT 0,
  note               TEXT,
  created_at         TEXT NOT NULL,
  UNIQUE (contract_id, tenant_id),
  FOREIGN KEY (contract_id) REFERENCES contracts (contract_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id)
);

CREATE INDEX idx_contract_tenants_tenant ON contract_tenants (tenant_id);

-- สร้างตาราง contracts ใหม่โดยไม่มี tenant_id (SQLite ไม่มี DROP COLUMN ในเวอร์ชันที่
-- รับประกันได้ จึงใช้วิธีสร้างใหม่/คัดลอก/ลบเก่า/เปลี่ยนชื่อ ตามที่ SKILL.md กำหนด)
-- คอลัมน์ที่เหลือคงเดิมทั้งหมด รวมของที่ 004_deposit_refund_policy.sql เพิ่มไว้
CREATE TABLE contracts_new (
  contract_id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id                      INTEGER NOT NULL,
  rent_type                    TEXT NOT NULL,
  start_date                   TEXT NOT NULL,
  end_date                     TEXT,
  rent_amount_cents            INTEGER NOT NULL,
  deposit_amount_cents         INTEGER NOT NULL,
  deposit_payment_method       TEXT NOT NULL,
  booking_fee_cents            INTEGER NOT NULL,
  booking_receipt_no           TEXT,
  advance_payment_amount_cents INTEGER NOT NULL,
  water_meter_start            DECIMAL(10,2) NOT NULL,
  electric_meter_start         DECIMAL(10,2) NOT NULL,
  note                         TEXT,
  status                       TEXT NOT NULL,
  created_at                   TEXT NOT NULL,
  updated_at                   TEXT,
  -- จาก 004_deposit_refund_policy.sql — snapshot กฎคืนเงินประกัน ณ วันทำสัญญา
  term_months                  INTEGER,
  deposit_refund_policy        TEXT NOT NULL DEFAULT 'on_full_term',
  deposit_min_stay_months      INTEGER,
  deposit_notice_days          INTEGER NOT NULL DEFAULT 15,
  previous_contract_id         INTEGER REFERENCES contracts (contract_id),
  is_deposit_carried_over      INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (room_id) REFERENCES rooms (room_id)
);

INSERT INTO contracts_new (
  contract_id, room_id, rent_type, start_date, end_date, rent_amount_cents,
  deposit_amount_cents, deposit_payment_method, booking_fee_cents, booking_receipt_no,
  advance_payment_amount_cents, water_meter_start, electric_meter_start, note, status,
  created_at, updated_at, term_months, deposit_refund_policy, deposit_min_stay_months,
  deposit_notice_days, previous_contract_id, is_deposit_carried_over
)
SELECT
  contract_id, room_id, rent_type, start_date, end_date, rent_amount_cents,
  deposit_amount_cents, deposit_payment_method, booking_fee_cents, booking_receipt_no,
  advance_payment_amount_cents, water_meter_start, electric_meter_start, note, status,
  created_at, updated_at, term_months, deposit_refund_policy, deposit_min_stay_months,
  deposit_notice_days, previous_contract_id, is_deposit_carried_over
FROM contracts;

-- ผู้เช่าเดิมของแต่ละสัญญา (ถ้ามี) ย้ายมาเป็นผู้เช่าหลักในตารางใหม่
-- ตอนนี้ยังไม่มีสัญญาสักใบ คำสั่งนี้จึงไม่ทำอะไร แต่เขียนไว้ให้ถูกต้องตามหลัก
INSERT INTO contract_tenants (contract_id, tenant_id, is_primary, created_at)
SELECT contract_id, tenant_id, 1, created_at FROM contracts;

DROP TABLE contracts;

ALTER TABLE contracts_new RENAME TO contracts;

-- หาสัญญาของห้องหนึ่งคือคำถามที่ถามบ่อยที่สุด (หน้ารายละเอียดห้องถามทุกครั้งที่เปิด)
CREATE INDEX idx_contracts_room_status ON contracts (room_id, status);
