-- 009_tenants_optional_id_card.sql
-- IMMUTABLE once shipped. Further changes go in 010_*.sql.
--
-- เลขบัตรประชาชนของผู้เช่า: จาก "บังคับกรอก" เป็น "ไม่บังคับ แต่ห้ามซ้ำ"
--
-- เหตุผล: หอนักศึกษามีผู้เช่าที่ยังไม่มีบัตร (เด็กต่างชาติ / พ่อแม่เซ็นแทน / ยังไม่ได้เอามา
-- วันทำสัญญา) ถ้าบังคับตั้งแต่แรก เจ้าหน้าที่จะกรอกเลขมั่วเพื่อให้ผ่าน แล้วข้อมูลเสียถาวร
-- ปล่อยว่างไว้ก่อนแล้วค่อยเติมทีหลังดีกว่า — แต่ถ้ากรอกมาแล้วต้องไม่ซ้ำกับคนอื่นเด็ดขาด
-- เพราะเป็นตัวกันไม่ให้สร้างผู้เช่าคนเดิมซ้ำสองระเบียน
--
-- SQLite เปลี่ยน NOT NULL ของคอลัมน์ที่มีอยู่ไม่ได้ (ไม่มี ALTER COLUMN) ต้องสร้างตารางใหม่
-- คัดลอกข้อมูล ลบตัวเก่า แล้วเปลี่ยนชื่อ — เขียนออกมาเต็มๆ ตรงนี้ ไม่พึ่งเครื่องมือ generate
--
-- หมายเหตุเรื่อง UNIQUE กับ NULL: SQLite ถือว่า NULL แต่ละตัวไม่เท่ากัน ผู้เช่าหลายคนจึง
-- เว้นเลขบัตรว่างพร้อมกันได้ โดยที่ UNIQUE ยังกันเลขที่กรอกจริงไม่ให้ซ้ำอยู่
--
-- foreign_keys ถูกเปิดไว้ที่ระดับ connection (database.js) — PRAGMA foreign_keys เป็น no-op
-- ระหว่างอยู่ใน transaction อยู่แล้ว และ migrate.js ห่อทุกไฟล์ไว้ใน transaction เดียว
-- ตอนนี้ยังไม่มีตารางไหนอ้าง tenants ที่มีข้อมูลจริง (contracts ยังว่าง) จึงปลอดภัย

CREATE TABLE tenants_new (
  tenant_id               INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name              TEXT NOT NULL,
  last_name               TEXT NOT NULL,
  phone                   TEXT NOT NULL UNIQUE,
  -- ต่างจากเดิมตรงนี้ที่เดียว: ไม่มี NOT NULL แล้ว แต่ยังคง UNIQUE ไว้
  id_card_no              TEXT UNIQUE,
  address                 TEXT,
  emergency_contact_name  TEXT,
  emergency_relation      TEXT,
  emergency_phone         TEXT,
  note                    TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT
);

INSERT INTO tenants_new (
  tenant_id, first_name, last_name, phone, id_card_no, address,
  emergency_contact_name, emergency_relation, emergency_phone, note,
  created_at, updated_at
)
SELECT
  tenant_id, first_name, last_name, phone, id_card_no, address,
  emergency_contact_name, emergency_relation, emergency_phone, note,
  created_at, updated_at
FROM tenants;

DROP TABLE tenants;

ALTER TABLE tenants_new RENAME TO tenants;

-- ค้นหาผู้เช่าด้วยชื่อคือสิ่งที่ทำบ่อยที่สุดในหน้าผู้เช่าและตอนสร้างสัญญา
CREATE INDEX idx_tenants_name ON tenants (first_name, last_name);
